# dsh-plugin-github

给 **DeepSeek Harness** 的智能体提供 GitHub 访问能力的插件：搜索仓库 / 代码 / issues / 用户、读取仓库文件与元信息、**根据任务类型**推荐合适的 GitHub 资源，并能**把本地项目发布到 GitHub**。

## 提供的能力（4 个模型工具）

| 工具 | 作用 |
| --- | --- |
| `github_search` | 搜索 GitHub：`type` 可选 `repositories` / `code` / `issues` / `users`，支持 `language`、`sort`、`perPage`。 |
| `github_fetch` | 读取仓库概览（星标、语言、License、Topics、主页）+ README（省略 `path`），或读取具体文件 / 目录（设置 `path`，可选 `ref` 指定分支/tag/commit）。 |
| `github_catalog` | **按任务类型选资源**：用一句话描述任务（中英文均可），返回与该领域匹配的精选仓库列表；也支持显式 `category`，或裸调用浏览全部分类。 |
| `github_push` | **发布本地项目**：把 `path` 指向本地目录，自动 `git init`（如需）、提交、在仓库不存在时创建公开/私有仓库，并推送到 `main`。提交者使用下方配置的默认身份。需要 `GITHUB_TOKEN`。 |

## 工作原理

- 通过原生 `fetch` 调用 GitHub REST API（`https://api.github.com`），零第三方运行时依赖。
- 可选 `GITHUB_TOKEN`（个人访问令牌）用于提升速率限制；未配置时也能匿名使用（限流较低）。
- 内置一个**精选目录**（`lib/catalog.js`）：12 个任务领域（前端、后端、机器学习、爬虫、DevOps、文档、CLI、移动、安全、测试、可视化、自动化）各映射若干高星且活跃维护的仓库。`github_catalog` 先做关键词匹配给出短名单，再用 `github_fetch` / `github_search` 深入。
- 内置**发布能力**（`lib/push.js`）：`github_push` 调用本地 `git`（init → add → commit → push）与 GitHub REST API（仓库不存在时自动创建），使用已配置的 `GITHUB_TOKEN`；提交会以配置的默认身份（`authorName` / `authorEmail`）署名。

## 目录结构

```
dsh-plugin-github/
├── cordis.patch.yml      # bundle patch 层：插入插件条目（含 config）
├── config.example.yml    # 基本配置块的参考文档
├── package.json          # 声明 dsh.bundle.patch
├── lib/
│   ├── index.js          # 注册 4 个工具 + 系统提示词段落
│   ├── github.js         # GitHub REST API 客户端 + 格式化（零外部依赖，可单测）
│   ├── catalog.js        # 任务类型 → 精选仓储目录 + 匹配逻辑（零外部依赖，可单测）
│   └── push.js           # 把本地目录发布到 GitHub（git + REST，零外部依赖）
├── install.ps1           # 一键安装脚本（直接写入 profile）
└── test-smoke.mjs        # 冒烟测试（校验 schema 编译 + 工具注册 + catalog 端到端）
```

## 安装

推荐用脚本一键安装（会先备份 `package.json`）：

```powershell
cd dsh-plugin-github
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

脚本会：

1. 把插件复制到 `%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-plugin-github\`；
2. 在 profile 的 `package.json` 里加入 `dependencies["dsh-plugin-github"]` 和 `dsh.profile.bundles` 里的 `"dsh-plugin-github"`。

你也可以用官方 CLI（若 `dsh` 命令在 PATH 上）：

```powershell
dsh plugin --profile web add .\dsh-plugin-github
```

**安装后需要重载/重启 DeepSeek Harness**，新工具才会出现在智能体的工具列表里。

## 配置

插件从 `cordis.patch.yml` 里条目上的 `config:` 块读取基本配置（完整键表见 `config.example.yml`）：

```yaml
config:
  authorName: 'ohGGBob'                                        # 默认提交者姓名
  authorEmail: '255260321+ohGGBob@users.noreply.github.com'    # 默认提交者邮箱
  tokenEnv: 'GITHUB_TOKEN'                                     # 凭证「引用名」
```

- **作者身份** —— `authorName` / `authorEmail` 是普通（非机密）值。`github_push` 通过 `git -c user.name=… -c user.email=…` 逐次提交注入，因此发布不依赖全局 git 身份；留空则回退到全局 git 配置。
- **密钥绝不会写进配置**。`tokenEnv` 只是「引用名」（默认 `GITHUB_TOKEN`）：真正的密钥存放在 DSH 凭证域（`~/.dsh/.credentials.yaml`，或系统环境变量 `GITHUB_TOKEN` / `GH_TOKEN`），在操作时解析。模型与任何界面都只能看到名字、看不到值。

该 token 能为 `github_search` / `github_fetch` / `github_catalog` 提升速率限制（不配置也能匿名使用：核心 60 次/小时，搜索 10 次/分钟），而 `github_push` **必须**配置。

## 开发与自测

```powershell
cd dsh-plugin-github
node test-smoke.mjs
```

冒烟测试用一个假的 `ctx` 调用 `apply()`，确保四个工具的 parameter/output schema 都能通过 DSH 的 JSON Schema 子集校验，并端到端跑通 `github_catalog`（无需网络）。