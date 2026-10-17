import type { z } from "zod";

export class AgentError extends Error {}

export type Effort = "low" | "medium" | "high";
/** `models` lists the concrete models that served the calls (Gemini may fall back along a chain). */
export type Usage = { input: number; output: number; models?: string[] };

/** Provider-neutral tool definition (ATK MCP tools are mapped into this). */
export type ToolSpec = { name: string; description: string; inputSchema: Record<string, unknown> };

export type ToolCallLog = { name: string; input: unknown; ok: boolean; preview: string; ms: number };

export type StructuredOpts<S extends z.ZodType> = {
  system: string;
  user: string;
  schema: S;
  effort?: Effort;
  /** Agent id (news, impact, bull, bear, judge, strategy); providers may pick a model per agent. */
  agent?: string;
};

export type ToolLoopOpts<S extends z.ZodType> = StructuredOpts<S> & {
  tools: ToolSpec[];
  runTool: (name: string, input: Record<string, unknown>) => Promise<string>;
  onToolCall?: (log: ToolCallLog) => void;
  maxTurns?: number;
};

export type Provider = {
  id: "claude" | "gemini";
  label: string;
  model: string;
  structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<{ data: z.infer<S>; usage: Usage }>;
  structuredWithTools<S extends z.ZodType>(opts: ToolLoopOpts<S>): Promise<{ data: z.infer<S>; usage: Usage; toolCalls: ToolCallLog[] }>;
};

/** Runs one tool call and records it; errors become a logged failure, never a thrown one. */
export async function runLoggedTool(
  name: string,
  input: Record<string, unknown>,
  opts: Pick<ToolLoopOpts<z.ZodType>, "runTool" | "onToolCall">,
  toolCalls: ToolCallLog[],
): Promise<{ ok: boolean; output: string }> {
  const started = Date.now();
  try {
    const output = await opts.runTool(name, input);
    const log = { name, input, ok: true, preview: output.slice(0, 400), ms: Date.now() - started };
    toolCalls.push(log);
    opts.onToolCall?.(log);
    return { ok: true, output };
  } catch (e) {
    const output = e instanceof Error ? e.message : String(e);
    const log = { name, input, ok: false, preview: output.slice(0, 400), ms: Date.now() - started };
    toolCalls.push(log);
    opts.onToolCall?.(log);
    return { ok: false, output };
  }
}
