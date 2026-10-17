import type { z } from "zod";
import { claudeProvider } from "./providers/claude.ts";
import { geminiProvider } from "./providers/gemini.ts";
import type { Provider, StructuredOpts, ToolLoopOpts } from "./providers/types.ts";

export { AgentError, type Effort, type ToolCallLog, type ToolSpec, type Usage } from "./providers/types.ts";

/**
 * Model provider selection. AI_PROVIDER=claude|gemini wins; otherwise the first
 * configured key decides (Claude first, then Gemini).
 */

const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const hasGemini = () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

function providerId(): "claude" | "gemini" {
  const forced = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (forced === "claude" || forced === "gemini") return forced;
  if (hasClaude()) return "claude";
  if (hasGemini()) return "gemini";
  return "claude";
}

export function provider(): Provider {
  return providerId() === "gemini" ? geminiProvider() : claudeProvider(process.env.SIGNALMIND_MODEL ?? "claude-opus-5-5");
}

export function aiConfigured(): boolean {
  return providerId() === "gemini" ? hasGemini() : hasClaude();
}

export function aiInfo(): { provider: "claude" | "gemini"; label: string; model: string; configured: boolean } {
  const p = provider();
  return { provider: p.id, label: p.label, model: p.model, configured: aiConfigured() };
}

export function structured<S extends z.ZodType>(opts: StructuredOpts<S>) {
  return provider().structured(opts);
}

export function structuredWithTools<S extends z.ZodType>(opts: ToolLoopOpts<S>) {
  return provider().structuredWithTools(opts);
}
