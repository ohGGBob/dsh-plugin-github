// Unit smoke test for dsh-plugin-github — exercises apply() with a fake ctx
// so defineTool compiles every parameter/output schema (throws on violations).
import { apply } from "./lib/index.js";

const tools = [];
const sections = [];
const ctx = {
  get: () => undefined, // credentials service absent -> env fallback
  tools: { register: (def) => tools.push(def) },
  systemPrompt: { section: (s) => sections.push(s) },
  effect: (fn) => { if (typeof fn === "function") fn(); },
};

apply(ctx, {});

console.log("tools registered:", tools.map((t) => t.name).join(", "));
if (tools.length !== 4) throw new Error(`expected 4 tools, got ${tools.length}`);
for (const t of tools) {
  if (!t.parameters || t.parameters.type !== "object") throw new Error(`${t.name}: bad parameters schema`);
  if (!t.output?.schema) throw new Error(`${t.name}: missing output schema`);
  if (typeof t.execute !== "function") throw new Error(`${t.name}: missing execute`);
  console.log(`  ${t.name}: params=${Object.keys(t.parameters.properties ?? {}).length} props, output schema OK`);
}
const push = tools.find((t) => t.name === "github_push");
if (!push) throw new Error("github_push tool missing");
const pathSchema = push.parameters?.properties?.path;
const requiredList = push.parameters?.required ?? [];
const pathRequired = pathSchema?.required === true || requiredList.includes("path");
if (!pathSchema || pathSchema.type !== "string" || !pathRequired) {
  throw new Error("github_push: `path` must be a required string parameter");
}
console.log("github_push: path=required:string OK, timeoutMs=" + push.timeoutMs);
if (sections.length !== 1 || sections[0].name !== "github:instructions") {
  throw new Error("system prompt section not registered");
}
console.log("system-prompt section:", sections[0].name, "order=", sections[0].order);

// Exercise the no-network catalog tool end-to-end.
const catalog = tools.find((t) => t.name === "github_catalog");
const exec = { signal: new AbortController().signal };
const byTask = await catalog.execute({ task: "帮我做一个抓取网页数据的爬虫" }, exec);
console.log("catalog(task) items:", byTask.items.length, "| first block head:", byTask.items[0].split("\n")[0]);
const byCategory = await catalog.execute({ category: "ml" }, exec);
console.log("catalog(category=ml) head:", byCategory.items[0].split("\n")[0]);
const browse = await catalog.execute({}, exec);
console.log("catalog(browse) items:", browse.items.length);

console.log("SMOKE TEST PASSED");