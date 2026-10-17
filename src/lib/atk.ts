import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * OKX Agent Trade Kit (ATK) MCP client.
 *
 * Spawns the official `okx-trade-mcp` server against OKX TR in read-only,
 * market-only mode (no API key needed, no order tools exposed) and keeps one
 * connection per server process.
 */

export type AtkTool = { name: string; description?: string; inputSchema: Record<string, unknown> };

const ARGS = ["--site", "tr", "--modules", "market", "--read-only", "--no-log"];

type State = { client?: Client; connecting?: Promise<Client>; tools?: AtkTool[]; lastError?: string };
const g = globalThis as unknown as { __signalmindAtk?: State };
const state: State = (g.__signalmindAtk ??= {});

function serverEntry(): string {
  return path.join(process.cwd(), "node_modules", "@okx_ai", "okx-trade-mcp", "dist", "index.js");
}

async function connect(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry(), ...ARGS],
    stderr: "ignore",
  });
  const client = new Client({ name: "signalmind", version: "0.1.0" });
  transport.onclose = () => {
    state.client = undefined;
    state.tools = undefined;
  };
  await client.connect(transport);
  return client;
}

export async function atkClient(): Promise<Client> {
  if (state.client) return state.client;
  state.connecting ??= connect()
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

export async function atkTools(): Promise<AtkTool[]> {
  if (state.tools) return state.tools;
  const client = await atkClient();
  const { tools } = await client.listTools();
  state.tools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));
  return state.tools;
}

export class AtkError extends Error {}

/** Calls an ATK tool and returns its parsed JSON payload. */
export async function atkCall<T = unknown>(name: string, args: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
  const client = await atkClient();
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
  const content = (res.content ?? []) as Array<{ type: string; text?: string }>;
  const text = content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n");
  if (res.isError) throw new AtkError(text || `ATK ${name} hata döndürdü`);
  if (res.structuredContent) return res.structuredContent as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function atkStatus(): { connected: boolean; lastError?: string } {
  return { connected: Boolean(state.client), lastError: state.lastError };
}
