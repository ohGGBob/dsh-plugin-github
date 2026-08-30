/**
 * Curated "task type → GitHub resources" catalog for dsh-plugin-github.
 *
 * Each category maps a task domain to a few well-known, actively maintained
 * repositories, plus keyword lists (Chinese and English) used to match a
 * free-form task description to the most relevant categories. This is the
 * "select GitHub resources by task type" capability: the model describes what
 * it is trying to accomplish and `github_catalog` returns a shortlist, which
 * the model can then drill into with `github_fetch` / `github_search`.
 *
 * This module is intentionally dependency-free (plain data + pure functions)
 * so it is unit-testable in isolation from the host.
 */

/** @typedef {{ repo: string, desc: string, tags: string[] }} CatalogRepo */
/** @typedef {{ category: string, label: string, keywords: string[], repos: CatalogRepo[] }} CatalogCategory */

/** @type {CatalogCategory[]} */
export const TASK_CATALOG = [
  {
    category: "frontend",
    label: "前端 / Web UI",
    keywords: ["前端", "界面", "网页", "web", "react", "vue", "svelte", "angular", "ui", "frontend", "tailwind", "组件", "component", "css", "布局"],
    repos: [
      { repo: "facebook/react", desc: "用于构建用户界面的 JavaScript 库", tags: ["react", "ui"] },
      { repo: "vuejs/vue", desc: "渐进式 JavaScript 框架，上手平缓", tags: ["vue"] },
      { repo: "sveltejs/svelte", desc: "编译型前端框架，运行时更轻", tags: ["svelte"] },
      { repo: "tailwindlabs/tailwindcss", desc: "实用优先的 CSS 框架", tags: ["css", "tailwind"] },
      { repo: "shadcn-ui/ui", desc: "Radix + Tailwind 的可复用组件集合", tags: ["components", "react"] },
    ],
  },
  {
    category: "backend",
    label: "后端 / 服务端",
    keywords: ["后端", "服务端", "接口", "api", "backend", "server", "node", "go", "golang", "java", "spring", "python", "fastapi", "rest", "微服务", "microservice"],
    repos: [
      { repo: "nodejs/node", desc: "Node.js 运行时", tags: ["runtime", "node"] },
      { repo: "fastify/fastify", desc: "高性能、低开销的 Node.js Web 框架", tags: ["node", "http"] },
      { repo: "gin-gonic/gin", desc: "Go 编写的轻量 HTTP Web 框架", tags: ["go", "http"] },
      { repo: "spring-projects/spring-boot", desc: "Java 生态约定优于配置的应用框架", tags: ["java"] },
      { repo: "fastapi/fastapi", desc: "现代、快速（高性能）的 Python Web 框架", tags: ["python", "api"] },
    ],
  },
  {
    category: "ml",
    label: "机器学习 / 数据科学",
    keywords: ["机器学习", "深度学习", "数据科学", "模型", "训练", "推理", "ml", "machine learning", "deep learning", "pytorch", "tensorflow", "transformer", "llm", "大模型", "fine-tune", "微调", "ai"],
    repos: [
      { repo: "pytorch/pytorch", desc: "开源的深度学习框架", tags: ["ml", "framework"] },
      { repo: "huggingface/transformers", desc: "预训练大模型与推理/微调工具集", tags: ["nlp", "llm"] },
      { repo: "scikit-learn/scikit-learn", desc: "Python 机器学习库", tags: ["ml", "python"] },
      { repo: "langchain-ai/langchain", desc: "LLM 应用编排框架", tags: ["llm", "agents"] },
      { repo: "vllm-project/vllm", desc: "高吞吐、低延迟的 LLM 推理引擎", tags: ["llm", "serving"] },
    ],
  },
  {
    category: "crawler",
    label: "爬虫 / 数据采集",
    keywords: ["爬虫", "采集", "抓取", "解析", "爬取", "scraper", "crawl", "spider", "网页抓取", "数据抓取", "大模型爬虫"],
    repos: [
      { repo: "scrapy/scrapy", desc: "Python 快速高层次的网页抓取框架", tags: ["python", "scraper"] },
      { repo: "crawl4ai/Crawl4AI", desc: "面向 LLM 的开源网页抓取与数据提取工具", tags: ["llm", "scraper"] },
      { repo: "apify/crawlee", desc: "Node.js 可靠的网页爬取与浏览器自动化库", tags: ["node", "scraper"] },
      { repo: "projectdiscovery/katana", desc: "下一代爬虫与蜘蛛框架（安全向）", tags: ["go", "crawler"] },
    ],
  },
  {
    category: "devops",
    label: "DevOps / CI-CD / 云原生",
    keywords: ["devops", "ci", "cd", "持续集成", "持续交付", "部署", "容器", "docker", "kubernetes", "k8s", "云原生", "监控", "可观测", "prometheus", "terraform", "ansible"],
    repos: [
      { repo: "docker/compose", desc: "多容器应用编排工具", tags: ["docker"] },
      { repo: "kubernetes/kubernetes", desc: "生产级容器编排平台", tags: ["k8s", "orchestration"] },
      { repo: "prometheus/prometheus", desc: "监控与告警工具包", tags: ["monitoring"] },
      { repo: "hashicorp/terraform", desc: "基础设施即代码", tags: ["iac"] },
      { repo: "ansible/ansible", desc: "无代理的自动化与配置管理", tags: ["automation", "config"] },
    ],
  },
  {
    category: "docs",
    label: "文档 / 知识库 / 静态站点",
    keywords: ["文档", "知识库", "wiki", "博客", "静态站点", "docs", "documentation", "markdown", "站点生成", "知识管理", "rag"],
    repos: [
      { repo: "facebook/docusaurus", desc: "易于维护的开源文档站点生成器", tags: ["react", "docs"] },
      { repo: "vuejs/vitepress", desc: "Vue 驱动的极速静态站点生成器", tags: ["vue", "docs"] },
      { repo: "mkdocs/mkdocs", desc: "面向 Markdown 的项目文档生成器", tags: ["python", "docs"] },
      { repo: "docsifyjs/docsify", desc: "运行时渲染的文档站点，无需构建", tags: ["docs", "spa"] },
    ],
  },
  {
    category: "cli",
    label: "命令行工具",
    keywords: ["命令行", "终端", "cli", "terminal", "shell", "命令工具", "tui", "脚本"],
    repos: [
      { repo: "cli/cli", desc: "GitHub 官方命令行工具（gh）", tags: ["github", "cli"] },
      { repo: "charmbracelet/bubbletea", desc: "Go 编写的强大 TUI 框架", tags: ["go", "tui"] },
      { repo: "spf13/cobra", desc: "Go 应用命令行接口库", tags: ["go", "cli"] },
      { repo: "withfig/autocomplete", desc: "让终端补全无处不在的规范与工具", tags: ["shell", "completion"] },
    ],
  },
  {
    category: "mobile",
    label: "移动 / 跨端",
    keywords: ["移动", "安卓", "ios", "小程序", "跨端", "flutter", "react native", "app", "mobile", "android"],
    repos: [
      { repo: "flutter/flutter", desc: "一套代码构建多端应用的工具包", tags: ["dart", "cross-platform"] },
      { repo: "facebook/react-native", desc: "用 React 构建原生应用", tags: ["react", "mobile"] },
      { repo: "expo/expo", desc: "React Native 开发与构建平台", tags: ["react-native"] },
    ],
  },
  {
    category: "security",
    label: "安全 / 渗透测试",
    keywords: ["安全", "渗透", "漏洞", "扫描", "security", "pentest", "vulnerability", "红队", "漏扫", "src"],
    repos: [
      { repo: "projectdiscovery/nuclei", desc: "基于模板的快速漏洞扫描器", tags: ["go", "scanner"] },
      { repo: "OWASP/owasp-mastg", desc: "移动应用安全测试指南", tags: ["mobile", "testing"] },
      { repo: "gophish/gophish", desc: "开源钓鱼演练平台", tags: ["phishing"] },
      { repo: "aquasecurity/trivy", desc: "容器/依赖/基础设施漏洞扫描器", tags: ["scanner", "containers"] },
    ],
  },
  {
    category: "testing",
    label: "测试 / 质量保障",
    keywords: ["测试", "单元测试", "集成测试", "端到端", "e2e", "自动化测试", "test", "pytest", "jest", "coverage", "测试覆盖率"],
    repos: [
      { repo: "vitest-dev/vitest", desc: "Vite 原生的快速测试框架", tags: ["node", "unit"] },
      { repo: "microsoft/playwright", desc: "可靠的端到端跨浏览器自动化测试", tags: ["e2e", "browser"] },
      { repo: "jestjs/jest", desc: "零配置的 JavaScript 测试框架", tags: ["node", "unit"] },
      { repo: "pytest-dev/pytest", desc: "Python 测试框架", tags: ["python", "unit"] },
    ],
  },
  {
    category: "viz",
    label: "数据可视化 / 图表",
    keywords: ["可视化", "图表", "数据可视化", "chart", "visualization", "dashboard", "大屏", "echarts", "d3", "graph"],
    repos: [
      { repo: "apache/echarts", desc: "功能强大的交互式图表库", tags: ["javascript", "charts"] },
      { repo: "d3/d3", desc: "面向数据驱动的文档的 JavaScript 库", tags: ["javascript", "svg"] },
      { repo: "chartjs/Chart.js", desc: "简单灵活的轻量图表库", tags: ["javascript", "charts"] },
    ],
  },
  {
    category: "automation",
    label: "自动化 / 低代码 / 工作流",
    keywords: ["自动化", "工作流", "低代码", "流程编排", "automation", "workflow", "n8n", "agent", "智能体", "rpa", "集成"],
    repos: [
      { repo: "n8n-io/n8n", desc: "可编排的工作流自动化平台", tags: ["workflow", "automation"] },
      { repo: "langflow-ai/langflow", desc: "可视化的 Agent / RAG 流程编排", tags: ["llm", "low-code"] },
      { repo: "appsmithorg/appsmith", desc: "快速构建管理后台与内部工具", tags: ["low-code", "admin"] },
    ],
  },
];

/** Normalize a Chinese/English task description for keyword matching. */
function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/\s+/g, " ");
}

/**
 * Score each catalog category against a free-form task description.
 * A category matches when the description contains one of its keywords
 * (longer keywords weigh more, so "machine learning" beats the lone "ml").
 *
 * @param {string} task - free-form task description (Chinese or English).
 * @returns {{ category: CatalogCategory, score: number }[]} matches, best first.
 */
export function matchTask(task) {
  const haystack = normalize(task);
  if (haystack.length === 0) return [];
  const scored = [];
  for (const category of TASK_CATALOG) {
    let score = 0;
    for (const keyword of category.keywords) {
      const needle = normalize(keyword);
      if (needle.length > 0 && haystack.includes(needle)) score += needle.length;
    }
    if (score > 0) scored.push({ category, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Resolve an explicit category key (or fuzzy label/name) to a catalog entry.
 * @param {string} value - category key, label, or partial name.
 * @returns {CatalogCategory | undefined}
 */
export function findCategory(value) {
  const needle = normalize(value);
  if (needle.length === 0) return undefined;
  return TASK_CATALOG.find((c) => {
    if (normalize(c.category) === needle) return true;
    if (normalize(c.label).includes(needle)) return true;
    return c.keywords.some((k) => normalize(k) === needle);
  });
}

/** Ordered list of every category key recognized by the catalog. */
export function categoryKeys() {
  return TASK_CATALOG.map((c) => c.category);
}