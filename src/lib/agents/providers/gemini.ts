import { ApiError, FinishReason, GoogleGenAI, type Content, type GenerateContentResponse, type Part } from "@google/genai";
import { z } from "zod";
import { kvGet, kvSet } from "../../db.ts";
import { AgentError, runLoggedTool, type Provider, type StructuredOpts, type ToolCallLog, type ToolLoopOpts, type Usage } from "./types.ts";

/**
 * Gemini provider tuned for the free tier: each model has its own small daily
 * request quota (20/day at the time of writing) and models are sometimes
 * overloaded (503). Requests walk a chain of Flash models; a model whose daily
 * quota is spent is skipped until its quota resets, so retries never burn quota.
 */

const DEFAULT_CHAIN = ["gemini-flash-latest", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-flash-lite-latest"];

export function geminiChain(): string[] {
  const env = process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL;
  return env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_CHAIN;
}

type State = { client?: GoogleGenAI; exhaustedUntil: Map<string, number> };
const g = globalThis as unknown as { __signalmindGemini?: State };
// Quota exhaustion is persisted so a server restart doesn't re-probe spent models.
const state: State = (g.__signalmindGemini ??= { exhaustedUntil: new Map(Object.entries(loadExhausted())) });

function loadExhausted(): Record<string, number> {
  try {
    return kvGet<Record<string, number>>("gemini_exhausted") ?? {};
  } catch {
    return {};
  }
}

function markExhausted(model: string, until: number): void {
  state.exhaustedUntil.set(model, until);
  try {
    kvSet("gemini_exhausted", Object.fromEntries(state.exhaustedUntil));
  } catch {
    /* persistence is best-effort */
  }
}

function gemini(): GoogleGenAI {
  return (state.client ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY,
    ...(process.env.GEMINI_BASE_URL ? { httpOptions: { baseUrl: process.env.GEMINI_BASE_URL } } : {}),
  }));
}

export function geminiQuotaStatus(): { model: string; exhaustedUntil: number | null }[] {
  const now = Date.now();
  return geminiChain().map((model) => {
    const until = state.exhaustedUntil.get(model);
    return { model, exhaustedUntil: until && until > now ? until : null };
  });
}

/** Zod → JSON Schema restricted to the keywords Gemini's responseJsonSchema accepts. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryDelayMs(message: string): number | null {
  const m = message.match(/retryDelay\\?"?\s*:\s*\\?"(\d+(?:\.\d+)?)s/);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

type Params = Omit<Parameters<GoogleGenAI["models"]["generateContent"]>[0], "model">;

/** Sends one request, walking the model chain on daily-quota exhaustion or overload. */
async function generate(params: Params): Promise<{ res: GenerateContentResponse; model: string }> {
  const chain = geminiChain();
  let lastProblem = "";
  // Overload (503) is usually brief: walk the chain twice with a pause in between.
  for (let round = 0; round < 2; round++) {
    if (round > 0) {
      if (chain.every((m) => (state.exhaustedUntil.get(m) ?? 0) > Date.now())) break;
      await sleep(15_000);
    }
    const hit = await walkChain(chain, params, (p) => (lastProblem = p));
    if (hit) return hit;
  }
  const resets = chain.map((m) => state.exhaustedUntil.get(m) ?? 0);
  if (resets.every((t) => t > Date.now())) {
    const at = new Date(Math.min(...resets)).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    throw new AgentError(`Tüm Gemini modellerinin günlük ücretsiz kotası doldu. İlk kota ${at} civarında açılıyor; ya da ANTHROPIC_API_KEY ekleyin.`);
  }
  throw new AgentError(`Gemini şu an yanıt veremiyor (${lastProblem}). Biraz sonra tekrar deneyin.`);
}

async function walkChain(
  chain: string[],
  params: Params,
  setProblem: (p: string) => void,
): Promise<{ res: GenerateContentResponse; model: string } | null> {
  let lastProblem = "";
  for (const model of chain) {
    const until = state.exhaustedUntil.get(model);
    if (until && until > Date.now()) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return { res: await gemini().models.generateContent({ ...params, model }), model };
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        const msg = e.message ?? "";
        if (e.status === 429 && /PerDay/i.test(msg)) {
          markExhausted(model, Date.now() + (retryDelayMs(msg) ?? 12 * 3_600_000));
          lastProblem = `${model} günlük ücretsiz kotası doldu`;
          break; // next model
        }
        if (e.status === 429) {
          // Per-minute limit: waiting is the right call.
          lastProblem = `${model} dakikalık kota`;
          if (attempt < 2) {
            await sleep(Math.min(65_000, retryDelayMs(msg) ?? 20_000));
            continue;
          }
          break;
        }
        if (e.status === 503 || e.status === 500 || e.status === 504) {
          lastProblem = `${model} şu an çok yoğun`;
          if (attempt === 0) {
            await sleep(3000);
            continue;
          }
          break; // overloaded: try the next model
        }
        if (e.status === 404) {
          lastProblem = `${model} bu hesapta kullanılamıyor`;
          markExhausted(model, Date.now() + 24 * 3_600_000);
          break;
        }
        throw new AgentError(`Gemini hatası (${e.status}): ${msg.slice(0, 200)}`);
      }
    }
    setProblem(lastProblem);
  }
  return null;
}

function usageOf(res: GenerateContentResponse, model: string): Usage {
  const u = res.usageMetadata;
  return { input: u?.promptTokenCount ?? 0, output: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0), models: [model] };
}

function addUsage(total: Usage, u: Usage): void {
  total.input += u.input;
  total.output += u.output;
  total.models = [...new Set([...(total.models ?? []), ...(u.models ?? [])])];
}

function checkFinish(res: GenerateContentResponse): void {
  const reason = res.candidates?.[0]?.finishReason;
  if (!res.candidates?.length) throw new AgentError(`Gemini yanıt üretmedi${res.promptFeedback?.blockReason ? ` (${res.promptFeedback.blockReason})` : ""}`);
  if (reason === FinishReason.MAX_TOKENS) throw new AgentError("Yanıt token sınırında kesildi");
  if (reason === FinishReason.SAFETY || reason === FinishReason.PROHIBITED_CONTENT) throw new AgentError("Gemini güvenlik filtresi yanıtı engelledi");
}

export function geminiProvider(): Provider {
  /** Schema-constrained call; one repair round if the JSON fails validation. */
  async function finalJson<S extends z.ZodType>(system: string, contents: Content[], schema: S, usage: Usage): Promise<z.infer<S>> {
    const config = { systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: jsonSchema(schema), maxOutputTokens: 16000 };
    let history = contents;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { res, model } = await generate({ contents: history, config });
      addUsage(usage, usageOf(res, model));
      checkFinish(res);
      const text = res.text ?? "";
      let problem: string;
      try {
        const parsed = schema.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
        problem = parsed.error.message;
      } catch (e) {
        problem = e instanceof Error ? e.message : String(e);
      }
      history = [
        ...history,
        { role: "model", parts: [{ text }] },
        { role: "user", parts: [{ text: `Yanıt şemaya uymuyor: ${problem.slice(0, 600)}. Aynı içeriği şemaya tam uyan geçerli JSON olarak yeniden ver.` }] },
      ];
    }
    throw new AgentError("Gemini şemaya uygun çıktı üretemedi");
  }

  async function structured<S extends z.ZodType>(opts: StructuredOpts<S>): Promise<{ data: z.infer<S>; usage: Usage }> {
    const usage: Usage = { input: 0, output: 0 };
    const data = await finalJson(opts.system, [{ role: "user", parts: [{ text: opts.user }] }], opts.schema, usage);
    return { data, usage };
  }

  /**
   * Phase 1: free tool loop — Gemini picks ATK tools until it stops calling them.
   * Phase 2: one schema-constrained call over the whole transcript. Splitting the
   * phases avoids depending on JSON-mode + function calling working together.
   */
  async function structuredWithTools<S extends z.ZodType>(opts: ToolLoopOpts<S>): Promise<{ data: z.infer<S>; usage: Usage; toolCalls: ToolCallLog[] }> {
    const usage: Usage = { input: 0, output: 0 };
    const toolCalls: ToolCallLog[] = [];
    const contents: Content[] = [{ role: "user", parts: [{ text: opts.user }] }];
    const tools = [{ functionDeclarations: opts.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }];
    // Each turn costs one request from a small daily quota: keep the loop short.
    const maxTurns = Math.min(opts.maxTurns ?? 8, 4);

    for (let turn = 0; turn < maxTurns - 1; turn++) {
      const { res, model } = await generate({ contents, config: { systemInstruction: opts.system, tools, maxOutputTokens: 16000 } });
      addUsage(usage, usageOf(res, model));
      checkFinish(res);
      const modelContent = res.candidates![0].content;
      const calls = res.functionCalls ?? [];
      if (!modelContent || calls.length === 0) {
        if (modelContent) contents.push(modelContent);
        break;
      }
      // Echo the model turn unchanged so thought signatures survive.
      contents.push(modelContent);
      const parts: Part[] = await Promise.all(
        calls.map(async (c) => {
          const r = await runLoggedTool(c.name ?? "", c.args ?? {}, opts, toolCalls);
          return { functionResponse: { id: c.id, name: c.name, response: r.ok ? { output: r.output } : { error: r.output } } };
        }),
      );
      contents.push({ role: "user", parts });
    }

    contents.push({ role: "user", parts: [{ text: "Araç kullanımı bitti. Topladığın verilere dayanarak nihai yanıtı şimdi şemaya uygun JSON olarak ver." }] });
    const data = await finalJson(opts.system, contents, opts.schema, usage);
    return { data, usage, toolCalls };
  }

  return { id: "gemini", label: "Gemini", model: geminiChain()[0], structured, structuredWithTools };
}
