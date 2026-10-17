import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { AgentError, runLoggedTool, type Provider, type StructuredOpts, type ToolCallLog, type ToolLoopOpts, type Usage } from "./types.ts";

/**
 * Claude provider. Uses the beta Messages endpoint so policy refusals are
 * re-run server-side on Anthropic's recommended fallback model
 * (`fallbacks: "default"`) instead of failing the analysis.
 *
 * Model per agent: CLAUDE_MODEL_<AGENT> (e.g. CLAUDE_MODEL_NEWS=claude-haiku-5-5)
 * overrides the default for that agent only.
 */

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

const g = globalThis as unknown as { __signalmindAnthropic?: Anthropic };
export function anthropic(): Anthropic {
  return (g.__signalmindAnthropic ??= new Anthropic());
}

function checkStop(res: Anthropic.Beta.BetaMessage): void {
  if (res.stop_reason === "refusal") {
    throw new AgentError(`Model isteği yanıtlamadı (${res.stop_details?.category ?? "refusal"})`);
  }
  if (res.stop_reason === "max_tokens") throw new AgentError("Yanıt token sınırında kesildi");
}

function usageOf(res: Anthropic.Beta.BetaMessage): Usage {
  return { input: res.usage.input_tokens, output: res.usage.output_tokens, models: [res.model] };
}

function addUsage(total: Usage, u: Usage): void {
  total.input += u.input;
  total.output += u.output;
  total.models = [...new Set([...(total.models ?? []), ...(u.models ?? [])])];
}

export function claudeProvider(defaultModel: string): Provider {
  const modelFor = (agent?: string) => (agent && process.env[`CLAUDE_MODEL_${agent.toUpperCase()}`]) || defaultModel;

  async function structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<{ data: z.infer<S>; usage: Usage }> {
    const res = await anthropic().beta.messages.parse({
      model: modelFor(opts.agent),
      max_tokens: 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
    });
    checkStop(res);
    if (!res.parsed_output) throw new AgentError("Yapılandırılmış çıktı ayrıştırılamadı");
    return { data: res.parsed_output as z.infer<S>, usage: usageOf(res) };
  }

  /**
   * Tool loop that ends in a structured answer. Claude decides which tools to call
   * (e.g. ATK market tools); we execute them and feed results back until it answers.
   */
  async function structuredWithTools<S extends z.ZodType>(opts: ToolLoopOpts<S>): Promise<{ data: z.infer<S>; usage: Usage; toolCalls: ToolCallLog[] }> {
    const tools: Anthropic.Beta.BetaTool[] = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
    const usage: Usage = { input: 0, output: 0 };
    const toolCalls: ToolCallLog[] = [];
    const maxTurns = opts.maxTurns ?? 8;

    for (let turn = 0; turn < maxTurns; turn++) {
      const last = turn === maxTurns - 1;
      const res = await anthropic().beta.messages.parse({
        model: modelFor(opts.agent),
        max_tokens: 16000,
        system: opts.system,
        messages,
        tools,
        tool_choice: last ? { type: "none" } : { type: "auto" },
        output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
      addUsage(usage, usageOf(res));
      checkStop(res);

      if (res.stop_reason !== "tool_use") {
        if (!res.parsed_output) throw new AgentError("Yapılandırılmış çıktı ayrıştırılamadı");
        return { data: res.parsed_output as z.infer<S>, usage, toolCalls };
      }

      // Echo the assistant turn back unchanged (thinking and fallback blocks included);
      // text blocks are rebuilt so parse-only fields never reach the API.
      const assistantContent = res.content.map((b) =>
        b.type === "text" ? ({ type: "text", text: b.text } as Anthropic.Beta.BetaTextBlockParam) : b,
      ) as Anthropic.Beta.BetaContentBlockParam[];
      messages.push({ role: "assistant", content: assistantContent });

      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      const results = await Promise.all(
        uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
          const r = await runLoggedTool(u.name, (u.input ?? {}) as Record<string, unknown>, opts, toolCalls);
          return { type: "tool_result", tool_use_id: u.id, content: r.output, ...(r.ok ? {} : { is_error: true }) };
        }),
      );
      messages.push({ role: "user", content: results });
    }
    throw new AgentError("Ajan araç döngüsünden çıkamadı");
  }

  return { id: "claude", label: "Claude", model: defaultModel, structured, structuredWithTools };
}
