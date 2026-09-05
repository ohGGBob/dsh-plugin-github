# dsh-plugin-github

A **DeepSeek Harness** plugin that gives agents GitHub access: search repositories / code / issues / users, read repo files and metadata, **discover GitHub resources by task type**, and **publish local projects to GitHub**.

## Capabilities (4 model tools)

| Tool | What it does |
| --- | --- |
| `github_search` | Search GitHub: `type` in `repositories` / `code` / `issues` / `users`, with `language`, `sort`, `perPage` options. |
| `github_fetch` | Read a repo overview (stars, language, license, topics, homepage) + README (omit `path`), or a specific file / directory (set `path`, optionally `ref` for a branch/tag/commit). |
| `github_catalog` | **Pick resources by task type**: describe the task in one sentence (Chinese or English) to get a curated shortlist of relevant repositories; or pass an explicit `category`, or call with no args to browse everything. |
| `github_push` | **Publish a local project**: point `path` at a folder to `git init` (if needed), commit, create a public/private repository (when missing), and push to `main`. Commits under the default commit identity configured below. Requires a `GITHUB_TOKEN`. |

## How it works

- Calls the GitHub REST API (`https://api.github.com`) with native `fetch` — zero runtime dependencies.
- Optional `GITHUB_TOKEN` (personal access token) raises rate limits; anonymous use works too (lower limits).
- Ships a **curated catalog** (`lib/catalog.js`): 12 task domains (frontend, backend, ML, crawler, DevOps, docs, CLI, mobile, security, testing, visualization, automation), each mapping to several well-known, actively maintained repos. `github_catalog` keyword-matches first, then you drill in with `github_fetch` / `github_search`.
- Ships **publishing** (`lib/push.js`): `github_push` drives the local `git` binary (init → add → commit → push) plus the GitHub REST API (create the repository when missing), using the configured `GITHUB_TOKEN`; commits are signed off with the configured default committer identity (`authorName` / `authorEmail`).

## Layout

```
dsh-plugin-github/
├── cordis.patch.yml      # bundle patch layer: inserts the plugin entry (with config)
├── config.example.yml    # documented reference for the basic config block
├── package.json          # declares dsh.bundle.patch
├── lib/
│   ├── index.js          # registers 4 tools + a system-prompt section
│   ├── github.js         # GitHub REST client + formatters (dep-free, testable)
│   ├── catalog.js        # task-type → curated repos + matching (dep-free, testable)
│   └── push.js           # publish a local dir → GitHub (git + REST, dep-free)
├── install.ps1           # one-shot installer (writes into the profile)
└── test-smoke.mjs        # smoke test (schema compile + registration + catalog e2e)
```

## Install

One-shot script (backs up `package.json` first):

```powershell
cd dsh-plugin-github
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The script:

1. copies the plugin to `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-plugin-github\`;
2. adds `dependencies["dsh-plugin-github"]` and `"dsh-plugin-github"` to `dsh.profile.bundles` in the profile's `package.json`.

Or use the official CLI (if `dsh` is on PATH):

```powershell
dsh plugin --profile web add .\dsh-plugin-github
```

**Reload / restart DeepSeek Harness afterwards** for the new tools to appear.

## Configuration

The plugin reads its basic configuration from the `config:` block of the entry in `cordis.patch.yml` (see `config.example.yml` for the full key list):

```yaml
config:
  authorName: 'ohGGBob'                                        # default committer name
  authorEmail: '255260321+ohGGBob@users.noreply.github.com'    # default committer email
  tokenEnv: 'GITHUB_TOKEN'                                     # credential *reference name*
```

- **Author identity** — `authorName` / `authorEmail` are plain (non-secret) values. `github_push` injects them per commit via `git -c user.name=… -c user.email=…`, so a publish never depends on the ambient global git identity. Leave either empty to fall back to the global git config.
- **Token is never placed in the config.** `tokenEnv` is only a *reference name* (default `GITHUB_TOKEN`): the actual secret lives in DSH's credentials store (`~/.dsh/.credentials.yaml`, or the `GITHUB_TOKEN` / `GH_TOKEN` environment variable), and is resolved at operation time. The model and any settings surface only ever see the name, never the value.

The token raises API rate limits for `github_search` / `github_fetch` / `github_catalog` (anonymous use works without it: core 60 req/hr, search 10 req/min), and is **required** for `github_push`.

## Development & self-test

```powershell
cd dsh-plugin-github
node test-smoke.mjs
```

The smoke test calls `apply()` with a fake `ctx`, verifying that all four tools' parameter/output schemas pass DSH's enforced JSON-Schema subset, and runs `github_catalog` end-to-end without network.