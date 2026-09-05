/**
 * dsh-plugin-github — publish (push) a local project directory to GitHub.
 *
 * Dependency-free (Node built-ins only). It uses the GitHub REST API
 * (https://api.github.com) for account/repository lookup and creation, and the
 * local `git` binary for init / commit / push. Kept testable and independent of
 * the tool layer, mirroring github.js and catalog.js.
 *
 * @module dsh-plugin-github/lib/push
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join, basename } from "node:path";

const API_BASE = "https://api.github.com";
const USER_AGENT = "dsh-plugin-github/0.2.1";

/** Candidate git executables (Windows full paths first, then PATH). */
const GIT_CANDIDATES = [
  process.env.GIT,
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files\\Git\\bin\\git.exe",
  "git",
].filter(Boolean);

/** Locate a usable `git` binary, or null when unavailable. */
export function resolveGit() {
  for (const candidate of GIT_CANDIDATES) {
    if (candidate === "git" || existsSync(candidate)) return candidate;
  }
  return null;
}

/** Remove any token occurrences from external (git) output before surfacing it. */
function scrub(text, token) {
  if (text == null) return "";
  const s = String(text);
  return token ? s.split(token).join("***") : s;
}

/** One GitHub REST API call with classic `token` auth (works for `ghp_*` PATs). */
async function apiJson(token, path, { method = "GET", body } = {}) {
  const headers = {
    authorization: `token ${token}`,
    "user-agent": USER_AGENT,
    accept: "application/vnd.github+json",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new Error(`github_push: GitHub API request failed: ${error?.message ?? String(error)}`);
  }
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** Derive a repository name: explicit override → package.json `name` → dir name. */
export function resolveRepoName(dir, preferred) {
  if (preferred) return String(preferred).replace(/^@[^/]+\//, "").trim();
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) return String(pkg.name).replace(/^@[^/]+\//, "").trim();
    } catch {
      /* ignore invalid package.json */
    }
  }
  return basename(resolve(dir));
}

/** Run a git subcommand, capturing exit status and (scrubbed) output. */
function runGit(git, cwd, args, token) {
  const r = spawnSync(git, args, { cwd, encoding: "utf8" });
  const stdout = scrub(r.stdout, token);
  const stderr = scrub(r.stderr, token);
  return {
    status: r.status ?? (r.error ? 1 : 0),
    error: r.error ? scrub(r.error.message, token) : null,
    stdout,
    stderr,
  };
}

/**
 * Publish a local directory to GitHub.
 *
 * @param {{ token: string, dir: string, repo?: string, private?: boolean,
 *           description?: string, message?: string, dryRun?: boolean,
 *           authorName?: string, authorEmail?: string }} input
 * @returns {Promise<{ owner: string, repo: string, created: boolean,
 *           htmlUrl: string, dryRun: boolean, log: string[] }>}
 */
export async function publishToGitHub({ token, dir, repo: preferredRepo, private: isPrivate, description, message, dryRun, authorName, authorEmail }) {
  const git = resolveGit();
  if (!git) {
    throw new Error("github_push: git not found (checked PATH and C:\\Program Files\\Git\\cmd\\git.exe)");
  }

  const absDir = resolve(dir);
  if (!existsSync(absDir)) throw new Error(`github_push: directory not found: ${absDir}`);
  if (!statSync(absDir).isDirectory()) throw new Error(`github_push: not a directory: ${absDir}`);

  const log = [];

  const me = await apiJson(token, "/user");
  if (me.status !== 200) {
    throw new Error(`github_push: invalid GITHUB_TOKEN (HTTP ${me.status}${me.data?.message ? ` — ${me.data.message}` : ""})`);
  }
  const owner = me.data.login;

  const repo = resolveRepoName(absDir, preferredRepo);
  if (!repo) throw new Error("github_push: could not determine the repository name — pass `repo` explicitly");

  log.push(`owner: ${owner}`);
  log.push(`repo: ${repo}`);
  log.push(`dir: ${absDir}`);
  log.push(`private: ${!!isPrivate}`);

  const existing = await apiJson(token, `/repos/${owner}/${repo}`);
  const exists = existing.status === 200;
  log.push(exists ? "repository already exists — will push only" : "repository missing — will be created");

  if (dryRun) {
    log.push("dry-run: no changes were made");
    return { owner, repo, created: false, htmlUrl: `https://github.com/${owner}/${repo}`, dryRun: true, log };
  }

  let created = false;
  if (!exists) {
    const body = { name: repo, private: !!isPrivate, description: description ?? repo };
    const createdResp = await apiJson(token, "/user/repos", { method: "POST", body });
    if (createdResp.status !== 201 && createdResp.status !== 200) {
      const err = createdResp.data?.message ?? `HTTP ${createdResp.status}`;
      const errs = createdResp.data?.errors ? ` ${JSON.stringify(createdResp.data.errors)}` : "";
      throw new Error(`github_push: creating repository failed: ${err}${errs}`);
    }
    created = true;
    log.push(`created repository: ${createdResp.data.full_name}`);
  }

  if (!existsSync(join(absDir, ".git"))) {
    const init = runGit(git, absDir, ["init", "-b", "main"], token);
    log.push(`[git] init -b main (exit ${init.status})`);
    if (init.error) log.push(`[git] ${init.error}`);
  }

  runGit(git, absDir, ["add", "-A"], token);
  const staged = runGit(git, absDir, ["diff", "--cached", "--quiet"], token);
  if (staged.status === 0) {
    log.push("[git] nothing to commit — skipped commit");
  } else {
    const commitMsg = message || "Initial commit";
    // Inject the committer identity per-commit (never persisted to the target
    // `.git/config`), falling back to the ambient global git identity when a
    // value is left unset.
    const identityArgs = [];
    if (authorName) identityArgs.push("-c", `user.name=${authorName}`);
    if (authorEmail) identityArgs.push("-c", `user.email=${authorEmail}`);
    const commit = runGit(git, absDir, [...identityArgs, "commit", "-m", commitMsg], token);
    log.push(`[git] commit (exit ${commit.status})`);
    if (commit.status !== 0) {
      const detail = [commit.stdout, commit.stderr, commit.error].filter(Boolean).join(" ").slice(0, 600);
      throw new Error(`github_push: commit failed${detail ? ` — ${detail}` : ""} (ensure git user.name / user.email are configured, or set authorName / authorEmail in the plugin config)`);
    }
  }

  const cleanUrl = `https://github.com/${owner}/${repo}.git`;
  const cfgPath = join(absDir, ".git", "config");
  const hasOrigin = existsSync(cfgPath) && /\[remote\s+"origin"\]/.test(readFileSync(cfgPath, "utf8"));
  runGit(git, absDir, hasOrigin ? ["remote", "set-url", "origin", cleanUrl] : ["remote", "add", "origin", cleanUrl], token);
  runGit(git, absDir, ["config", "branch.main.remote", "origin"], token);
  runGit(git, absDir, ["config", "branch.main.merge", "refs/heads/main"], token);

  // Token goes only into the one-off push URL — never written to .git/config.
  const pushUrl = `https://${owner}:${token}@github.com/${owner}/${repo}.git`;
  const push = runGit(git, absDir, ["push", pushUrl, "main"], token);
  log.push(`[git] push main (exit ${push.status})`);
  if (push.status !== 0) {
    const detail = [push.stdout, push.stderr, push.error].filter(Boolean).join(" ").slice(0, 800);
    throw new Error(`github_push: push failed${detail ? ` — ${detail}` : ""}`);
  }

  return {
    owner,
    repo,
    created,
    htmlUrl: `https://github.com/${owner}/${repo}`,
    dryRun: false,
    log,
  };
}