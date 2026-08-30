/**
 * dsh-plugin-github — GitHub access for DeepSeek Harness agents.
 *
 * Registers three model-facing tools:
 *
 *   • `github_search`  — search GitHub repositories / code / issues / users;
 *   • `github_fetch`   — fetch a repo's overview + README, or a single file /
 *                        directory listing at a path and ref;
 *   • `github_catalog` — map a task type (free-form description) to a curated
 *                        shortlist of relevant repositories ("select GitHub
 *                        resources by task type").
 *
 * A Cordis plugin: when the package is a profile layer (declares
 * `dsh.bundle.patch`), cordis.patch.yml inserts this row into the launcher
 * composition and the host runner loads this file. All network logic lives in
 * ./github.js and the curated library in ./catalog.js (both dependency-free);
 * this module wires them up as model tools.
 *
 * @module dsh-plugin-github
 */
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import {
  searchGitHub,
  fetchRepoOverview,
  fetchRepoPath,
  fetchRepoReadme,
  formatOverview,
  joinContent,
  defaultSort,
} from "./github.js";
import { TASK_CATALOG, categoryKeys, findCategory, matchTask } from "./catalog.js";

/** Cordis plugin name (registered with the loader). */
const name = "github";

/** Services this plugin must resolve before it applies. */
const inject = ["tools", "systemPrompt"];

/** Composition-row configuration for the plugin entry. */
const Config = z.object({
  /** Order of the model prompt guidance section (web tools sit at 110–111). */
  sectionOrder: z.number().min(0).default(112),
  /** Max catalog categories returned when a task matches (keeps context small). */
  maxCatalogCategories: z.number().min(1).default(3),
  /** Cooperative tool-call timeout budget (ms) attached to each tool. */
  timeoutMs: z.number().min(1000).default(30000),
  /** Credential/env name for the optional GitHub personal access token. */
  tokenEnv: z.string().role("credential-ref").default("GITHUB_TOKEN"),
});

const PROMPT_GUIDANCE = [
  "GitHub access:",
  "- Use the `github_search` tool to find repositories, code, issues, or users on GitHub (set `type` to repositories/code/issues/users; add `language` when searching repositories).",
  "- Use the `github_fetch` tool to read a repository's overview and README (omit `path`), or a specific file/directory (set `path`, optionally `ref` for a branch/tag).",
  "- When a task has a clear domain, try the `github_catalog` tool first (with a `task` description) to get a curated shortlist of relevant repositories, then drill into a match with `github_fetch` or broaden with `github_search`.",
  "- Always cite the repositories/URLs you use as markdown links. A `GITHUB_TOKEN` raises rate limits but is not required.",
].join("\n");

/** One curated repository formatted as a markdown list item. */
function formatCatalogRepo(repo) {
  return `- **${repo.repo}** — ${repo.desc} → https://github.com/${repo.repo}`;
}

/** One catalog category formatted as a markdown block. */
function formatCategory(category) {
  return [`### ${category.category} — ${category.label}`, category.repos.map(formatCatalogRepo).join("\n")].join("\n");
}

/** Render search results as one model-facing markdown block. */
function renderSearch(args, value) {
  const typeLabel = args.type ?? "repositories";
  return [{ type: "text", text: `GitHub search \`${typeLabel}\` — ${value.totalCount} result${value.totalCount === 1 ? "" : "s"}\n\n${value.items.join("\n\n")}` }];
}

/** Render catalog matches (or the full browse list) as markdown. */
function renderCatalog(_args, value) {
  return [{ type: "text", text: value.items.join("\n\n") }];
}

/**
 * Resolve the optional GitHub token for one operation. Prefers the DSH
 * credentials service (referenced env name, default `GITHUB_TOKEN`), then the
 * `GITHUB_TOKEN` / `GH_TOKEN` process environment. Never throws — a missing
 * token just means unauthenticated (lower) rate limits.
 */
async function resolveToken(ctx, tokenEnv) {
  try {
    const credentials = ctx.get("credentials");
    if (credentials) {
      const resolved = await credentials.resolve(credentialRef(tokenEnv ?? "GITHUB_TOKEN"));
      if (resolved?.value) return resolved.value;
    }
  } catch {
    /* credentials unavailable — fall through to environment */
  }
  return process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

function clampInt(value, fallback, min, max) {
  const n = Number.isInteger(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function apply(ctx, config) {
  const resolved = config ?? {};
  const timeoutMs = resolved.timeoutMs ?? 30000;
  const maxCatalogCategories = clampInt(resolved.maxCatalogCategories, 3, 1, 8);

  /* ---- github_search ------------------------------------------------ */
  ctx.tools.register(defineTool({
    name: "github_search",
    description: "Search GitHub for repositories, code, issues, or users. The required `type` selects the search index (repositories/code/issues/users, default repositories); `language` narrows repository search; `sort` and `perPage` control ordering and count. Returns total result count plus formatted markdown items with URLs. Note: `type: \"code\"` requires a GITHUB_TOKEN and at least one qualifier in the query (e.g. `repo:owner/name`, `org:orgname`, `user:username`, or `language:go`).",
    parameters: {
      query: { type: "string", required: true, description: "Search query, e.g. 'web scraper framework'. For code search, include a qualifier such as 'repo:owner/name' or 'language:typescript'." },
      type: { type: "string", enum: ["repositories", "code", "issues", "users"], default: "repositories", description: "Which GitHub search index to query." },
      language: { type: "string", description: "Programming language filter (repositories only), e.g. 'typescript'." },
      sort: { type: "string", description: "Sort key (repositories: stars/forks/help-wanted-issues/updated; issues: comments/created/updated; users: followers/repositories/joined)." },
      perPage: { type: "integer", default: 10, description: "Number of results to return (1–30)." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          totalCount: { type: "integer", required: true },
          truncated: { type: "boolean", required: true },
          items: { type: "array", required: true, items: { type: "string" } },
        },
      },
      render: renderSearch,
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const type = args.type ?? "repositories";
      const language = type === "repositories" || type === "code" ? args.language : undefined;
      const result = await searchGitHub({
        type,
        query: args.query,
        language,
        sort: args.sort ?? defaultSort(type),
        perPage: clampInt(args.perPage, 10, 1, 30),
        token: await resolveToken(ctx, resolved.tokenEnv),
        signal: exec.signal,
      });
      return { totalCount: result.totalCount, items: result.items, truncated: result.truncated };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `GitHub search: ${args.query}`,
      kind: "search",
      rawInput: args.query,
    }),
  }));

  /* ---- github_fetch ------------------------------------------------- */
  ctx.tools.register(defineTool({
    name: "github_fetch",
    description: "Fetch content from a GitHub repository. Omit `path` to get the repo overview (stars, language, license, topics, homepage) plus its README. Set `path` to read a specific file (base64-decoded) or list a directory; set `ref` to pin a branch, tag, or commit. Large files are truncated with a raw URL instead of their full body.",
    parameters: {
      owner: { type: "string", required: true, description: "Repository owner (user or org), e.g. 'facebook'." },
      repo: { type: "string", required: true, description: "Repository name, e.g. 'react'." },
      path: { type: "string", description: "Relative file/directory path inside the repo, e.g. 'package.json'. Omit for overview + README." },
      ref: { type: "string", description: "Branch, tag, or commit SHA, e.g. 'main'." },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          source: { type: "string", required: true },
          content: { type: "string", required: true },
          truncated: { type: "boolean", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.content }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const token = await resolveToken(ctx, resolved.tokenEnv);
      const signal = exec.signal;
      if (!args.path) {
        const [overview, readme] = await Promise.all([
          fetchRepoOverview({ owner: args.owner, repo: args.repo, token, signal }),
          fetchRepoReadme({ owner: args.owner, repo: args.repo, token, signal }),
        ]);
        const readmeText = readme?.content?.join("\n\n") ?? "(no README)";
        const content = `${formatOverview(overview)}\n\n---\n\n## README\n\n${readmeText}`;
        return {
          source: `${args.owner}/${args.repo}`,
          content,
          truncated: readme?.truncated ?? false,
        };
      }
      const fetched = await fetchRepoPath({ owner: args.owner, repo: args.repo, path: args.path, ref: args.ref, token, signal });
      const joined = joinContent(`${args.owner}/${args.repo}/${args.path}`, fetched?.content ?? ["(empty)"], fetched?.truncated ?? false);
      return { source: `${args.owner}/${args.repo}/${args.path}`, content: joined.text, truncated: joined.truncated };
    },
    presentCall: (args) => ({
      card: "generic",
      title: args.path ? `${args.owner}/${args.repo}/${args.path}` : `${args.owner}/${args.repo} overview`,
      kind: "fetch",
      rawInput: `${args.owner}/${args.repo}${args.path ? `/${args.path}` : ""}`,
    }),
  }));

  /* ---- github_catalog ---------------------------------------------- */
  ctx.tools.register(defineTool({
    name: "github_catalog",
    description: "Map a task type to a curated shortlist of relevant GitHub repositories. Describe the task (Chinese or English) in `task`, or pass an explicit `category` key. Returns matched categories with curated repos (owner/name, one-line description, URL); with neither argument it lists every available category. Use it before/alongside `github_search` when the task has a clear domain.",
    parameters: {
      task: { type: "string", description: "Free-form task description to match, e.g. '做一个 React 前端后台' or 'build a crawler'." },
      category: { type: "string", description: `Explicit category key, one of: ${categoryKeys().join(", ")}.` },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: { type: "array", required: true, items: { type: "string" } },
          truncated: { type: "boolean", required: true },
        },
      },
      render: renderCatalog,
    },
    timeoutMs: 5000,
    isConcurrencySafe: () => true,
    async execute(args) {
      if (args.category) {
        const category = findCategory(args.category);
        if (!category) throw new Error(`github_catalog: unknown category "${args.category}". Available: ${categoryKeys().join(", ")}`);
        return { items: [formatCategory(category)], truncated: false };
      }
      if (args.task && args.task.trim().length > 0) {
        const matches = matchTask(args.task).slice(0, maxCatalogCategories);
        if (matches.length > 0) {
          const items = matches.map((m) => formatCategory(m.category));
          items.push(`Tip: use \`github_fetch\` on any repo above for its README/metadata, or \`github_search\` (type: "repositories") to discover more.`);
          return { items, truncated: matchTask(args.task).length > maxCatalogCategories };
        }
      }
      // No match or no task provided: browse the whole catalog.
      const items = TASK_CATALOG.map((category) => formatCategory(category));
      items.push(`Tip: pass a \`task\` description (e.g. "爬虫" / "machine learning") for a focused shortlist, or a \`category\` key.`);
      return { items, truncated: false };
    },
    presentCall: (args) => ({
      card: "generic",
      title: args.task ?? args.category ?? "Browse GitHub catalog",
      kind: "other",
      rawInput: args.task ?? args.category ?? "",
    }),
  }));

  ctx.effect(() => ctx.systemPrompt.section({
    name: "github:instructions",
    order: resolved.sectionOrder ?? 112,
    text: PROMPT_GUIDANCE,
  }), "github.section()");
}

export { Config, PROMPT_GUIDANCE, apply, inject, name };