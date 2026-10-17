import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * OKX Agent Trade Kit (ATK) MCP client.
 *
 * Spawns the official `okx-trade-mcp` server against OKX TR, always read-only,
 * and keeps one connection per module set:
 * - "market": public market data, no API key needed.
 * - "news":   news + sentiment; needs a read-only OKX API key (OKX_API_KEY,
 *             OKX_SECRET_KEY, OKX_PASSPHRASE). Without one every call fails
 *             with AUTH_MISSING, which the agents see and handle.
 */

export type AtkTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
export type AtkModule = "market" | "news";

const argsFor = (module: AtkModule) => ["--site", process.env.OKX_SITE ?? "tr", "--modules", module, "--read-only", "--no-log"];

type State = { client?: Client; connecting?: Promise<Client>; tools?: AtkTool[]; lastError?: string };
const g = globalThis as unknown as { __signalmindAtkByModule?: Partial<Record<AtkModule, State>> };
const states = (g.__signalmindAtkByModule ??= {});
const stateOf = (module: AtkModule): State => (states[module] ??= {});

function serverEntry(): string {
  return path.join(process.cwd(), "node_modules", "@okx_ai", "okx-trade-mcp", "dist", "index.js");
}

export function atkHasCredentials(): boolean {
  return Boolean(process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY && process.env.OKX_PASSPHRASE);
}

async function connect(module: AtkModule): Promise<Client> {
  const state = stateOf(module);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry(), ...argsFor(module)],
    env: { ...(process.env as Record<string, string>) },
    stderr: "ignore",
  });
  const client = new Client({ name: "signalmind", version: "0.2.0" });
  transport.onclose = () => {
    state.client = undefined;
    state.tools = undefined;
  };
  await client.connect(transport);
  return client;
}

export async function atkClient(module: AtkModule = "market"): Promise<Client> {
  const state = stateOf(module);
  if (state.client) return state.client;
  state.connecting ??= connect(module)
    .then((c) => {
      state.client = c;
      state.lastError = undefined;
      return c;
    })
    .catch((e) => {
      state.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    })
    .finally(() => {
      state.connecting = undefined;
    });
  return state.connecting;
}

export async function atkTools(module: AtkModule = "market"): Promise<AtkTool[]> {
  const state = stateOf(module);
  if (state.tools) return state.tools;
  const client = await atkClient(module);
  const { tools } = await client.listTools();
  state.tools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
  return state.tools;
}

export class AtkError extends Error {}

const moduleOf = (tool: string): AtkModule => (tool.startsWith("news_") ? "news" : "market");

/** Calls an ATK tool (module picked from the tool name) and returns its parsed JSON payload. */
export async function atkCall<T = unknown>(name: string, args: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  const client = await atkClient(moduleOf(name));
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
  const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  if (res.isError) throw new AtkError(conciseError(text) || `ATK ${name} hata döndürdü`);
  if (res.structuredContent) return res.structuredContent as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** ATK errors embed a large capabilities dump; keep the part an agent can act on. */
function conciseError(text: string): string {
  try {
    const e = JSON.parse(text) as { type?: string; message?: string; suggestion?: string; capabilities?: { moduleAvailability?: Record<string, { reasonCode?: string }> } };
    const reasons = Object.entries(e.capabilities?.moduleAvailability ?? {})
      .filter(([, v]) => v.reasonCode && v.reasonCode !== "MODULE_FILTERED")
      .map(([k, v]) => `${k}:${v.reasonCode}`);
    return [e.type, e.message, reasons.length ? `(${reasons.join(", ")})` : "", e.suggestion].filter(Boolean).join(" ");
  } catch {
    return text.slice(0, 400);
  }
}

export function atkStatus(): { connected: boolean; lastError?: string; news: { connected: boolean; credentials: boolean; lastError?: string } } {
  const m = stateOf("market");
  const n = stateOf("news");
  return { connected: Boolean(m.client), lastError: m.lastError, news: { connected: Boolean(n.client), credentials: atkHasCredentials(), lastError: n.lastError } };
}
