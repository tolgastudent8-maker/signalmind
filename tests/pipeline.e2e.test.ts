/**
 * End-to-end pipeline test without an API key: a local stand-in for the
 * Messages API returns canned, schema-valid answers, while the real Anthropic
 * SDK, real ATK MCP server and real OKX TR market data are exercised.
 * Run with: npm run test:e2e   (needs network)
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Req = { system?: string; messages: { role: string; content: unknown }[]; tools?: { name: string }[]; model?: string; fallbacks?: unknown };
const calls: { agent: string; tools: number; model?: string; fallbacks?: unknown; beta?: string }[] = [];

function agentOf(system = ""): string {
  if (system.includes("News Analyst ajanısın")) return "news";
  if (system.includes("Impact Radar ajanısın")) return "impact";
  if (system.includes("Bull (boğa) ajanısın")) return "bull";
  if (system.includes("Bear (ayı) ajanısın")) return "bear";
  if (system.includes("tarafsız hakemisin")) return "judge";
  return "strategy";
}

const CANNED: Record<string, unknown> = {
  news: {
    headline: "SEC, spot Solana ETF'sini onayladı",
    summary: "Test özeti.",
    event_type: "etf_institutional",
    information_type: "new_information",
    materiality: "high",
    credibility_score: 82,
    credibility_reasons: ["Resmi kaynak"],
    novelty: "new",
    entities: ["SEC", "Solana"],
    key_facts: ["Onay verildi"],
    open_questions: ["İlk gün girişleri"],
  },
  impact: {
    impacts: [
      { token: "SOL", relation: "direct", direction: "up", strength: "high", confidence: 70, mechanism: "ETF → kurumsal talep → SOL alımı", evidence: ["onay"] },
      { token: "BTC", relation: "correlation", direction: "flat", strength: "low", confidence: 55, mechanism: "Sınırlı yayılım", evidence: [] },
      { token: "NOTREAL", relation: "sector", direction: "up", strength: "low", confidence: 40, mechanism: "x", evidence: [] },
    ],
    market_wide_note: "Altcoin ETF beklentisi güçlenir.",
  },
  bull: { thesis: "Kurumsal talep", arguments: [{ claim: "Giriş olur", evidence: "Onay", strength: "high" }], most_affected: ["SOL"], invalidation: "Girişler zayıf kalırsa" },
  bear: { thesis: "Zaten fiyatlandı", arguments: [{ claim: "Beklenen haber", evidence: "Önceki yükseliş", strength: "medium" }], most_affected: ["SOL"], invalidation: "Hacim patlarsa" },
  judge: { winner: "bull", bull_score: 64, bear_score: 41, decisive_points: ["Resmi onay"], weak_points: ["Spekülatif giriş tahmini"], reasoning: "Kanıt boğa lehine." },
  strategy: {
    predictions: [
      // Clearly above any realistic base rate → recorded.
      { token: "SOL", direction: "up", horizon: "1h", confidence: 75, priced_in: "partially", rationale: "r", invalidation: "i" },
      { token: "SOL", direction: "up", horizon: "24h", confidence: 70, priced_in: "partially", rationale: "r", invalidation: "i" },
      { token: "BTC", direction: "flat", horizon: "24h", confidence: 80, priced_in: "unknown", rationale: "r", invalidation: "i" },
      // Below BTC's own 1h flat base rate → the code gate must abstain.
      { token: "BTC", direction: "flat", horizon: "1h", confidence: 30, priced_in: "unknown", rationale: "r", invalidation: "i" },
    ],
    scenarios: [{ name: "Temel", probability: 100, description: "d", signposts: [] }],
    market_context: "c",
    risks: ["r"],
    uncertainty: "u",
    track_record_note: "t",
    stance: "s",
  },
};

function message(content: unknown[], stop: string) {
  return { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } };
}

type GeminiReq = { contents: { role: string; parts: Record<string, unknown>[] }[]; tools?: { functionDeclarations: unknown[] }[]; systemInstruction?: unknown };

/** Stand-in for Gemini's generateContent endpoint. */
function geminiReply(r: GeminiReq) {
  const agent = agentOf(JSON.stringify(r.systemInstruction ?? ""));
  const toolCount = r.tools?.[0]?.functionDeclarations.length ?? 0;
  calls.push({ agent, tools: toolCount });
  const hasToolResult = r.contents.some((c) => c.parts.some((p) => "functionResponse" in p));
  const content =
    agent === "strategy" && toolCount && !hasToolResult
      ? {
          role: "model",
          parts: [
            { functionCall: { id: "fc_1", name: "market_get_ticker", args: { instId: "SOL-USDT" } } },
            { functionCall: { id: "fc_2", name: "market_get_candles", args: { instId: "SOL-USDT", bar: "1H", limit: 3 } } },
          ],
        }
      : agent === "strategy" && toolCount
        ? { role: "model", parts: [{ text: "Veriler toplandı." }] }
        : { role: "model", parts: [{ text: JSON.stringify(CANNED[agent]) }] };
  return { candidates: [{ content, finishReason: "STOP", index: 0 }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.includes(":generateContent")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(geminiReply(JSON.parse(body) as GeminiReq)));
      return;
    }
    const r = JSON.parse(body) as Req;
    const agent = agentOf(typeof r.system === "string" ? r.system : JSON.stringify(r.system));
    calls.push({ agent, tools: r.tools?.length ?? 0, model: r.model, fallbacks: r.fallbacks, beta: String(req.headers["anthropic-beta"] ?? "") });
    const hasToolResult = r.messages.some((m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "tool_result"));
    let out;
    if (agent === "strategy" && r.tools?.length && !hasToolResult) {
      out = message(
        [
          { type: "tool_use", id: "tu_1", name: "market_get_ticker", input: { instId: "SOL-USDT" } },
          { type: "tool_use", id: "tu_2", name: "market_get_indicator", input: { instId: "SOL-USDT", indicator: "rsi", bar: "1H", params: [14] } },
        ],
        "tool_use",
      );
    } else {
      out = message([{ type: "text", text: JSON.stringify(CANNED[agent]) }], "end_turn");
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
});

after(() => {
  server.close();
  setTimeout(() => process.exit(0), 50); // the ATK child process keeps the loop alive
});

test("live analysis runs all agents, calls ATK tools and records predictions", { timeout: 120_000 }, async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.CLAUDE_MODEL_NEWS = "claude-haiku-5-5";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const { resetDbForTests, db } = await import("../src/lib/db.ts");
  resetDbForTests(process.env.E2E_DB ?? ":memory:");
  const { addManualNews } = await import("../src/lib/news.ts");
  const { startAnalysis } = await import("../src/lib/agents/pipeline.ts");
  const { getAnalysis } = await import("../src/lib/queries.ts");

  const news = addManualNews("SEC approves spot Solana ETF", "Test body", Date.now() - 10 * 60_000);
  const id = startAnalysis(news.id, "live");

  let a = getAnalysis(id)!;
  for (let i = 0; i < 200 && a.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    a = getAnalysis(id)!;
  }
  assert.equal(a.status, "done", a.error ?? "");
  assert.deepEqual([...new Set(calls.map((c) => c.agent))].sort(), ["bear", "bull", "impact", "judge", "news", "strategy"]);
  assert.ok(calls.some((c) => c.agent === "strategy" && c.tools === 4), "strategy agent receives the 4 ATK tools");
  assert.ok(calls.every((c) => c.fallbacks === "default" && (c.beta ?? "").includes("server-side-fallback-2026-07-01")), "refusal fallback on every call");
  assert.equal(calls.find((c) => c.agent === "news")?.model, "claude-haiku-5-5", "per-agent model override");
  assert.equal(calls.find((c) => c.agent === "judge")?.model, "claude-opus-5-5", "default model elsewhere");

  const toolEvents = a.events.filter((e) => e.kind === "tool");
  assert.equal(toolEvents.length, 2);
  assert.ok(toolEvents.every((e) => (e.payload as { ok: boolean }).ok), "ATK tool calls succeed against OKX TR");

  assert.deepEqual(a.result?.droppedTokens, ["NOTREAL"]);
  assert.equal(a.predictions.length, 3);
  for (const p of a.predictions) {
    assert.ok(p.entry_price > 0, "entry price comes from the exchange");
    assert.equal(p.status, "pending");
  }
  const sol = a.predictions.find((p) => p.token === "SOL" && p.horizon_h === 1)!;
  assert.equal(sol.confidence, 0.75);
  assert.ok(sol.base_prob !== null && sol.base_prob < 0.75, "base rate stored for the Brier skill score");
  // BTC 1h at 30% is under its own base rate: recorded as an abstention, not a prediction.
  assert.equal(a.abstentions.length, 1);
  assert.equal(a.abstentions[0].token, "BTC");
  assert.equal(a.abstentions[0].horizon_h, 1);
  assert.match(a.abstentions[0].reason_code, /contradiction|no_edge/);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM events WHERE analysis_id = ?").get(id) !== undefined, true);
});

test("backtest uses as-of data, skips live tools and scores elapsed horizons at once", { timeout: 120_000 }, async () => {
  const { addManualNews } = await import("../src/lib/news.ts");
  const { startAnalysis } = await import("../src/lib/agents/pipeline.ts");
  const { getAnalysis } = await import("../src/lib/queries.ts");
  const before = calls.length;

  const publishedAt = Math.floor((Date.now() - 3 * 3_600_000) / 60_000) * 60_000;
  const news = addManualNews("Solana ETF approval (backtest)", "Test body", publishedAt);
  const id = startAnalysis(news.id, "backtest");
  let a = getAnalysis(id)!;
  for (let i = 0; i < 200 && (a.status === "running" || !a.events.some((e) => e.title.startsWith("Geriye dönük test puanlandı"))); i++) {
    await new Promise((r) => setTimeout(r, 300));
    a = getAnalysis(id)!;
  }
  assert.equal(a.status, "done", a.error ?? "");
  assert.equal(a.as_of, publishedAt);
  assert.ok(calls.slice(before).every((c) => c.tools === 0), "no live tools in backtest");
  assert.equal(a.events.filter((e) => e.kind === "tool").length, 0);

  const oneHour = a.predictions.filter((p) => p.horizon_h === 1);
  assert.ok(oneHour.length > 0 && oneHour.every((p) => p.status === "correct" || p.status === "wrong"), "1h predictions scored immediately");
  assert.ok(a.predictions.filter((p) => p.horizon_h === 24).every((p) => p.status === "pending"));
  assert.ok(a.predictions.every((p) => p.entry_ts === publishedAt));
});

test("Gemini provider runs the same pipeline, including the ATK tool loop", { timeout: 120_000 }, async () => {
  process.env.AI_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { addManualNews } = await import("../src/lib/news.ts");
  const { startAnalysis } = await import("../src/lib/agents/pipeline.ts");
  const { getAnalysis } = await import("../src/lib/queries.ts");
  const before = calls.length;

  const news = addManualNews("Solana ETF approval (gemini)", "Test body", Date.now() - 5 * 60_000);
  const id = startAnalysis(news.id, "live");
  let a = getAnalysis(id)!;
  for (let i = 0; i < 200 && a.status === "running"; i++) {
    await new Promise((r) => setTimeout(r, 300));
    a = getAnalysis(id)!;
  }
  assert.equal(a.status, "done", a.error ?? "");
  assert.match(a.result?.model ?? "", /^Gemini/);
  const mine = calls.slice(before);
  assert.deepEqual([...new Set(mine.map((c) => c.agent))].sort(), ["bear", "bull", "impact", "judge", "news", "strategy"]);
  assert.ok(mine.some((c) => c.agent === "strategy" && c.tools === 4), "Gemini strategy call receives the 4 ATK tools");
  const tools = a.events.filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  assert.ok(tools.every((e) => (e.payload as { ok: boolean }).ok));
  assert.equal(a.predictions.length, 3);
});

test("batch backtest runs eligible stories sequentially and skips already-tested ones", { timeout: 180_000 }, async () => {
  const { addManualNews } = await import("../src/lib/news.ts");
  const { startBatch, batchStatus, backtestCandidates } = await import("../src/lib/batch.ts");
  addManualNews("Kraken lists new staking product for Polkadot holders", "b1", Date.now() - 2 * 3_600_000);
  addManualNews("Ripple wins court appeal over XRP institutional sales", "b2", Date.now() - 3 * 3_600_000);
  const eligible = backtestCandidates(20).map((c) => c.title);
  assert.ok(!eligible.some((t) => t.includes("(backtest)")), "already backtested story is excluded");
  assert.ok(!eligible.some((t) => t.includes("(gemini)")), "news younger than 1h is excluded");

  startBatch(2);
  for (let i = 0; i < 300 && batchStatus().active; i++) await new Promise((r) => setTimeout(r, 300));
  const s = batchStatus();
  assert.equal(s.items.length, 2);
  assert.ok(s.items.every((x) => x.status === "done"), JSON.stringify(s.items));
});
