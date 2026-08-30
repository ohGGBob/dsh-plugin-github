/**
 * GitHub REST API client + markdown formatters for dsh-plugin-github.
 *
 * Talks to https://api.github.com with the native `fetch` (no external client
 * dependency), using an optional bearer token (passed in by the plugin) to
 * raise rate limits. All results are decoded into plain strings before the
 * tool layer turns them into model-facing markdown.
 *
 * Dependency-free (Node built-ins only) so it is unit-testable standalone.
 */

const API_BASE = "https://api.github.com";
const USER_AGENT = "dsh-plugin-github/0.1.0";
const API_VERSION = "2022-11-28";

/** Cap on bytes of a single file we are willing to base64-decode and return. */
const MAX_FILE_BYTES = 200_000;
/** Cap on rendered characters so one fetch cannot flood the model context. */
const MAX_RENDER_CHARS = 120_000;

/** Structured GitHub error with a stable machine-readable `code`. */
export class GitHubError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.code = code;
  }
}

function buildHeaders(token, accept) {
  const headers = {
    "user-agent": USER_AGENT,
    "accept": accept ?? "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function rateLimitMessage(resetEpochSeconds) {
  const when = resetEpochSeconds
    ? new Date(Number(resetEpochSeconds) * 1000).toLocaleTimeString()
    : "later";
  return `GitHub API rate limit exceeded (resets around ${when}). Configure a GITHUB_TOKEN (Settings → Models / credentials, or the GITHUB_TOKEN environment variable) to raise the limit, or retry shortly.`;
}

/** Perform one GET request against the GitHub REST API and surface clean errors. */
async function ghRequest(path, { token, signal, accept } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      redirect: "follow",
      headers: buildHeaders(token, accept),
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw new GitHubError("GitHub request aborted", 0, "ABORTED");
    throw new GitHubError(`GitHub request failed: ${error?.message ?? String(error)}`, 0, "NETWORK");
  }
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new GitHubError(rateLimitMessage(response.headers.get("x-ratelimit-reset")), 403, "RATE_LIMITED");
  }
  if (response.status === 404) {
    throw new GitHubError(`GitHub resource not found (HTTP 404) for ${path}`, 404, "NOT_FOUND");
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      if (body?.message) detail = ` — ${body.message}`;
    } catch {
      /* ignore unparseable error bodies */
    }
    throw new GitHubError(`GitHub API error (HTTP ${response.status})${detail}`, response.status, "API_ERROR");
  }
  return response;
}

/** Decode GitHub's base64 file `content`, returning the UTF-8 text. */
function decodeBase64(content) {
  const cleaned = String(content ?? "").replace(/\s+/g, "");
  return Buffer.from(cleaned, "base64").toString("utf8");
}

/** Clip a rendered string to the model-facing cap with a stable truncation note. */
function clip(text) {
  if (text.length <= MAX_RENDER_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_RENDER_CHARS - 60)}\n\n… (truncated; use a narrower path/query for the full text)`,
    truncated: true,
  };
}

/* ------------------------------------------------------------------ search */

const SEARCH_SORTS = {
  repositories: ["stars", "forks", "help-wanted-issues", "updated"],
  code: ["indexed"],
  issues: ["comments", "created", "updated"],
  users: ["followers", "repositories", "joined"],
};

export function defaultSort(type) {
  const sorts = SEARCH_SORTS[type];
  return sorts ? sorts[0] : undefined;
}

/**
 * Search GitHub (repositories / code / issues / users).
 * @param {{ type: string, query: string, language?: string, sort?: string, perPage?: number, token?: string, signal?: AbortSignal }} input
 * @returns {Promise<{ type: string, totalCount: number, items: string[], truncated: boolean }>}
 */
export async function searchGitHub({ type = "repositories", query, language, sort, perPage = 10, token, signal }) {
  const q = [query.trim(), (type === "repositories" || type === "code") && language ? `language:${language}` : ""]
    .filter((part) => part.length > 0)
    .join(" ");
  const params = new URLSearchParams({ q, per_page: String(perPage) });
  if (sort) params.set("sort", sort);
  const response = await ghRequest(`/search/${type}?${params.toString()}`, { token, signal });
  const data = await response.json();
  const items = formatSearchItems(type, data.items ?? []);
  return {
    type,
    totalCount: data.total_count ?? items.length,
    items,
    truncated: (data.total_count ?? 0) > items.length,
  };
}

function formatSearchItems(type, rawItems) {
  const formatter = {
    repositories: (it) => {
      const stars = it.stargazers_count != null ? ` ⭐${it.stargazers_count}` : "";
      const lang = it.language ? ` · ${it.language}` : "";
      const desc = it.description ? `\n${it.description}` : "";
      return `**${it.full_name}**${stars}${lang}${desc}\n${it.html_url}`;
    },
    code: (it) => `**${it.repository?.full_name ?? "?"}** — \`${it.path}\`\n${it.html_url}`,
    issues: (it) => {
      const state = it.state === "open" ? " 🟢 open" : " 🔴 closed";
      return `**#${it.number} ${it.title}** (${it.repository_url?.split("/repos/")[1] ?? ""})${state}\n${it.html_url}`;
    },
    users: (it) => `**${it.login}** (${it.type ?? "user"})\n${it.html_url}`,
  }[type];
  if (!formatter) return [];
  return rawItems.map(formatter);
}

/* ------------------------------------------------------------------ fetch */

/**
 * Fetch a repo's overview metadata.
 * @returns {Promise<object>}
 */
export async function fetchRepoOverview({ owner, repo, token, signal }) {
  const response = await ghRequest(`/repos/${owner}/${repo}`, { token, signal });
  return response.json();
}

/**
 * Fetch a single path inside a repository (file, directory, or README).
 * A directory is returned as a listing; a file is base64-decoded (subject to
 * {@link MAX_FILE_BYTES}); oversized files yield their raw URL instead.
 *
 * @returns {Promise<{ source: string, content: string[], truncated: boolean }|undefined>} content lines and metadata, or undefined when the path is missing.
 */
export async function fetchRepoPath({ owner, repo, path, ref, token, signal }) {
  const params = new URLSearchParams();
  if (ref) params.set("ref", ref);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await ghRequest(`/repos/${owner}/${repo}/contents/${path}${suffix}`, { token, signal });
  const data = await response.json();
  if (Array.isArray(data)) return formatDirectory(path, data);
  if (data?.type === "file") return formatFile(data);
  return {
    source: `${owner}/${repo}/${path}`,
    content: [`(unsupported entry type: ${data?.type ?? "unknown"})`],
    truncated: false,
  };
}

/**
 * Fetch the canonical README of a repository (raw, decoded).
 * @returns {Promise<{ source: string, content: string[], truncated: boolean }|undefined>}
 */
export async function fetchRepoReadme({ owner, repo, token, signal }) {
  const response = await ghRequest(`/repos/${owner}/${repo}/readme`, {
    token,
    signal,
    accept: "application/vnd.github.raw+json",
  });
  const raw = await response.text();
  const trimmed = raw.replace(/\s+$/, "");
  return {
    source: `${owner}/${repo} README`,
    content: trimmed.length === 0 ? ["(no README content)"] : [trimmed],
    truncated: trimmed.length > MAX_RENDER_CHARS,
  };
}

function formatDirectory(path, entries) {
  const lines = entries.map((entry) => {
    const icon = entry.type === "dir" ? "📁" : entry.type === "file" ? "📄" : "🔗";
    const size = entry.size != null && entry.size > 0 ? ` (${entry.size} B)` : "";
    return `${icon} ${entry.name}${size}`;
  });
  return {
    source: `${path} (directory)`,
    content: lines.length ? lines : ["(empty directory)"],
    truncated: false,
  };
}

function formatFile(entry) {
  const size = entry.size ?? 0;
  if (size > MAX_FILE_BYTES) {
    return {
      source: entry.path,
      content: [
        `File is too large to inline (${size} B > ${MAX_FILE_BYTES} B).`,
        `Raw URL: ${entry.download_url ?? entry.html_url ?? ""}`,
      ],
      truncated: true,
    };
  }
  const text = decodeBase64(entry.content);
  const clipped = clip(text);
  const prefix = clipped.text.length > 0 ? clipped.text.split("\n") : [""];
  return {
    source: entry.path,
    content: prefix,
    truncated: clipped.truncated,
  };
}

/* ------------------------------------------------------------------ helpers exported for the tool layer */

/** Turn a repo-overview payload into a compact markdown block. */
export function formatOverview(overview) {
  const license = overview.license?.spdx_id ?? overview.license?.name ?? "—";
  const topics = Array.isArray(overview.topics) && overview.topics.length ? `\nTopics: ${overview.topics.join(", ")}` : "";
  const homepage = overview.homepage ? `\nHomepage: ${overview.homepage}` : "";
  return [
    `# ${overview.full_name ?? ""}`,
    "",
    overview.description ? `${overview.description}` : "",
    "",
    `⭐ ${overview.stargazers_count ?? 0}  ·  🍴 ${overview.forks_count ?? 0}  ·  ⚠️ ${overview.open_issues_count ?? 0}`,
    `Language: ${overview.language ?? "—"}  ·  License: ${license}  ·  Default branch: ${overview.default_branch ?? "—"}`,
    `Created: ${overview.created_at ?? "—"}  ·  Updated: ${overview.updated_at ?? "—"}`,
    `${topics}${homepage}`,
    "",
    overview.html_url ?? "",
  ].filter((line) => line !== "").join("\n");
}

/** Join content lines into one model-facing string and apply the global cap. */
export function joinContent(source, contentLines, truncated) {
  const text = `${source ? `[${source}]\n\n` : ""}${contentLines.join("\n\n")}`;
  const clipped = clip(text);
  return { text: clipped.text, truncated: truncated || clipped.truncated };
}

export { MAX_RENDER_CHARS, MAX_FILE_BYTES };