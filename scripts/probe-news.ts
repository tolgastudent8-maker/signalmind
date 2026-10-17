import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Probes the ATK news module on a given site without credentials:
 * lists news tools and calls a few of them, printing a short excerpt.
 * Usage: node --experimental-strip-types scripts/probe-news.ts [tr|global]
 */

const site = process.argv[2] ?? "tr";
const entry = path.join(process.cwd(), "node_modules", "@okx_ai", "okx-trade-mcp", "dist", "index.js");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry, "--site", site, "--modules", "news", "--read-only", "--no-log"],
  stderr: "ignore",
});
const client = new Client({ name: "probe", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`[${site}] tools:`, tools.map((t) => t.name).join(", "));

const calls: [string, Record<string, unknown>][] = [
  ["news_get_latest", { importance: "low", limit: 3 }],
  ["news_get_by_coin", { coins: "BTC", limit: 2 }],
  ["news_get_coin_sentiment", { coins: "BTC" }],
];
for (const [name, args] of calls) {
  if (!tools.some((t) => t.name === name)) continue;
  try {
    const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 20000 });
    const text = ((res.content ?? []) as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
    console.log(`\n[${site}] ${name} isError=${Boolean(res.isError)}\n${text.slice(0, 1200)}`);
  } catch (e) {
    console.log(`\n[${site}] ${name} threw: ${e instanceof Error ? e.message : e}`);
  }
}
await client.close();
