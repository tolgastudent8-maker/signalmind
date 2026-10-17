import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDbForTests, db } from "../src/lib/db.ts";
import {
  actualDirection,
  baseRate,
  computeStats,
  coverage,
  evaluateDue,
  gatePrediction,
  allPredictions,
  MIN_EDGE,
  trackRecordMemory,
  type PredictionRow,
} from "../src/lib/scorecard.ts";
import { decodeEntities, parseFeed, sameStory, saveNews, listNews, storyMates } from "../src/lib/news.ts";
import { tagTokens } from "../src/lib/tagging.ts";
import { closedBefore, type Candle } from "../src/lib/market.ts";

const H = 3_600_000;

beforeEach(() => {
  resetDbForTests(":memory:");
  db().prepare(`INSERT INTO news (id, source, title, fetched_at) VALUES ('n1', 'Test', 'Haber', 0)`).run();
  db().prepare(`INSERT INTO analyses (id, news_id, mode, status, as_of, created_at) VALUES ('a1', 'n1', 'live', 'done', 0, 0)`).run();
});

function addPrediction(p: Partial<PredictionRow> & { token: string; direction: string; horizon_h: number; entry_ts: number; entry_price: number }) {
  db()
    .prepare(
      `INSERT INTO predictions (analysis_id, news_id, mode, token, inst_id, direction, confidence, horizon_h, event_type, mechanism, rationale, entry_ts, entry_price, momentum_dir, base_prob)
       VALUES ('a1', 'n1', 'live', ?, ?, ?, ?, ?, 'etf_institutional', 'm', 'r', ?, ?, ?, ?)`,
    )
    .run(p.token, `${p.token}-USDT`, p.direction, p.confidence ?? 0.7, p.horizon_h, p.entry_ts, p.entry_price, p.momentum_dir ?? "flat", p.base_prob ?? null);
}

test("flat band depends on horizon", () => {
  assert.equal(actualDirection(0.003, 1), "flat");
  assert.equal(actualDirection(0.005, 1), "up");
  assert.equal(actualDirection(-0.012, 24), "flat");
  assert.equal(actualDirection(-0.02, 24), "down");
});

test("base rate follows a normal model of the flat band", () => {
  // σ = 0.5%, band 0.4% → P(|z| < 0.8) ≈ 0.576
  const b = baseRate(0.005, 1)!;
  assert.ok(Math.abs(b.flat - 0.5763) < 0.002, String(b.flat));
  assert.ok(Math.abs(b.up + b.down + b.flat - 1) < 1e-9);
  // 24h: σ = 0.5%·√24 ≈ 2.45%, band 1.5% → P(|z| < 0.612) ≈ 0.46
  assert.ok(Math.abs(baseRate(0.005, 24)!.flat - 0.4596) < 0.003);
  assert.equal(baseRate(null, 1), null);
});

test("recording gate: contradictions and calls without edge are abstentions", () => {
  const base = { flat: 0.46, up: 0.27, down: 0.27 };
  // "down 35%" while flat is 46% even with no news → self-contradiction.
  const c = gatePrediction("down", 0.35, base);
  assert.equal(c.record, false);
  assert.equal(!c.record && c.code, "contradiction");
  // "flat 49%" is only 3 points above its 46% base rate → no edge.
  const e = gatePrediction("flat", 0.49, base);
  assert.equal(!e.record && e.code, "no_edge");
  // "flat 55%" (+9) and "up 50%" (+23, above flat's 46%) are recorded.
  assert.deepEqual(gatePrediction("flat", 0.55, base), { record: true });
  assert.deepEqual(gatePrediction("up", 0.5, base), { record: true });
  // Without a base rate there is nothing to compare against.
  assert.deepEqual(gatePrediction("up", 0.2, null), { record: true });
  assert.equal(MIN_EDGE, 0.05);
});

test("skill vs the best simple rule and Brier skill score vs base rates", async () => {
  const now = 100 * H;
  // Two calls that each beat a 0.5 base rate with 0.8 confidence: one right, one wrong.
  addPrediction({ token: "BTC", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100, confidence: 0.8, base_prob: 0.3, momentum_dir: "down" });
  addPrediction({ token: "ETH", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100, confidence: 0.8, base_prob: 0.3, momentum_dir: "flat" });
  addPrediction({ token: "SOL", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100, confidence: 0.8, base_prob: 0.3, momentum_dir: "down" });
  await evaluateDue(now, async (inst) => (inst === "ETH-USDT" ? 99 : 102));
  const s = computeStats(allPredictions());
  assert.equal(s.accuracy, 2 / 3);
  // Best simple rule here is "always up" (2/3); skill is accuracy minus it.
  assert.equal(s.skill.best, "alwaysUp");
  assert.ok(Math.abs(s.skill.vsBest!) < 1e-9);
  // Brier(model) = (0.04+0.64+0.04)/3, Brier(base) = (0.49+0.09+0.49)/3 → BSS ≈ 0.327
  assert.ok(Math.abs(s.bss.value! - (1 - 0.72 / 1.07)) < 1e-9);
  assert.equal(s.bss.n, 3);
});

test("coverage counts recorded predictions against abstentions", () => {
  addPrediction({ token: "BTC", direction: "up", horizon_h: 1, entry_ts: 0, entry_price: 100, base_prob: 0.3 });
  const ins = db().prepare(
    `INSERT INTO abstentions (analysis_id, news_id, mode, token, horizon_h, reason, reason_code, created_at) VALUES ('a1', 'n1', 'live', ?, ?, 'r', ?, 0)`,
  );
  ins.run("BTC", 24, "no_edge");
  ins.run("ETH", 1, "no_edge");
  ins.run("ETH", 24, "not_called");
  const c = coverage();
  assert.equal(c.opportunities, 4);
  assert.equal(c.predicted, 1);
  assert.equal(c.rate, 0.25);
  assert.deepEqual(c.byReason[0], { code: "no_edge", n: 2 });
});

test("evaluateDue scores only predictions whose horizon has passed", async () => {
  const now = 100 * H;
  addPrediction({ token: "BTC", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100 });
  addPrediction({ token: "ETH", direction: "down", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100 });
  addPrediction({ token: "SOL", direction: "up", horizon_h: 24, entry_ts: now - 2 * H, entry_price: 100 }); // not due
  const prices: Record<string, number> = { "BTC-USDT": 101, "ETH-USDT": 101 };
  const r = await evaluateDue(now, async (inst) => prices[inst] ?? null);
  assert.equal(r.evaluated, 2);
  const rows = allPredictions();
  const by = Object.fromEntries(rows.map((x) => [x.token, x]));
  assert.equal(by.BTC.status, "correct");
  assert.equal(by.ETH.status, "wrong");
  assert.equal(by.ETH.actual_dir, "up");
  assert.equal(by.SOL.status, "pending");
});

test("missing exit price stays pending, then becomes nodata after a day", async () => {
  const now = 100 * H;
  addPrediction({ token: "BTC", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100 });
  await evaluateDue(now, async () => null);
  assert.equal(allPredictions()[0].status, "pending");
  await evaluateDue(now + 30 * H, async () => null);
  assert.equal(allPredictions()[0].status, "nodata");
});

test("stats include baselines, Brier and calibration on the same predictions", async () => {
  const now = 100 * H;
  addPrediction({ token: "BTC", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100, confidence: 0.9, momentum_dir: "down" });
  addPrediction({ token: "ETH", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100, confidence: 0.9, momentum_dir: "up" });
  await evaluateDue(now, async (inst) => (inst === "BTC-USDT" ? 102 : 98));
  const s = computeStats(allPredictions());
  assert.equal(s.n, 2);
  assert.equal(s.accuracy, 0.5);
  assert.equal(s.baselines.alwaysUp, 0.5);
  assert.equal(s.baselines.momentum, 0); // BTC went up (momentum said down), ETH went down (momentum said up)
  assert.ok(Math.abs((s.brier ?? 0) - (0.01 + 0.81) / 2) < 1e-9);
  const b = s.calibration.find((x) => x.label === "90-100")!;
  assert.equal(b.n, 2);
  assert.equal(b.hitRate, 0.5);
});

test("track-record memory lists recent misses for the strategy agent", async () => {
  const now = 100 * H;
  addPrediction({ token: "ETH", direction: "up", horizon_h: 1, entry_ts: now - 2 * H, entry_price: 100 });
  await evaluateDue(now, async () => 95);
  const mem = trackRecordMemory("etf_institutional", ["ETH"]);
  assert.match(mem, /Son yanlış tahminler/);
  assert.match(mem, /ETH 1s/);
});

test("backtest snapshot never uses a candle that closes after the news", () => {
  const asOf = Date.UTC(2026, 9, 15, 10, 20); // news at 10:20
  const rows: Candle[] = [8, 9, 10].map((h) => ({ ts: Date.UTC(2026, 9, 15, h), o: 1, h: 1, l: 1, c: h, volQuote: 1 }));
  const kept = closedBefore(rows, asOf).map((c) => new Date(c.ts).getUTCHours());
  // 10:00-11:00 contains post-news prices; 09:00-10:00 is the last fully closed hour.
  assert.deepEqual(kept, [8, 9]);
});

test("same event from different outlets is grouped into one story", () => {
  assert.ok(sameStory("MSCI approves rules that could eject Strategy, Metaplanet from equity indexes", "MSCI adopts index exclusion rules that could oust Strategy"));
  assert.ok(
    sameStory(
      "OpenAI says research model spent another wallet’s testnet ETH without authorization on coding task",
      "OpenAI Model Used Testnet Ethereum Wallet Without Permission to Finish Coding Task",
    ),
  );
  assert.ok(!sameStory("Bitcoin steady near $82,000 after Fed comments", "Circle targets 40 new markets as stablecoin demand grows globally"));
  assert.ok(!sameStory("Under pressure, Ledger unveils plan to turn its crypto hardware wallet into a phone", "What Is a Hardware Wallet? Crypto Cold Storage Explained"));

  const now = Date.now();
  saveNews([
    { id: "s1", source: "CoinDesk", title: "MSCI approves rules that could eject Strategy, Metaplanet from equity indexes", summary: "", url: null, published_at: now - 3 * H, fetched_at: now },
    { id: "s2", source: "Cointelegraph", title: "MSCI adopts index exclusion rules that could oust Strategy", summary: "", url: null, published_at: now - 2 * H, fetched_at: now },
    { id: "s3", source: "Decrypt", title: "Russia will soon ban peer-to-peer bitcoin trading", summary: "", url: null, published_at: now - H, fetched_at: now },
  ]);
  const stories = listNews();
  const msci = stories.find((s) => s.title.startsWith("MSCI approves"))!;
  assert.equal(msci.sources.length, 2);
  assert.deepEqual(storyMates("s2").map((m) => m.id), ["s1"]);
  assert.equal(stories.filter((s) => s.title.includes("MSCI")).length, 1);
});

test("telemetry derives agent latency and tool stats from the event log", async () => {
  const { telemetry, accuracyOverTime } = await import("../src/lib/telemetry.ts");
  const ev = db().prepare(`INSERT INTO events (analysis_id, ts, agent, kind, title, payload_json) VALUES ('a1', ?, ?, ?, 't', ?)`);
  ev.run(1000, "bull", "start", null);
  ev.run(4000, "bull", "done", null);
  ev.run(5000, "strategy", "tool", JSON.stringify({ name: "market_get_ticker", ok: true, ms: 120 }));
  ev.run(5100, "strategy", "tool", JSON.stringify({ name: "market_get_ticker", ok: false, ms: 80 }));
  const t = telemetry();
  const bull = t.agents.find((a) => a.agent === "bull")!;
  assert.equal(bull.runs, 1);
  assert.equal(bull.avgMs, 3000);
  assert.deepEqual(t.tools, [{ name: "market_get_ticker", calls: 2, errors: 1, avgMs: 100 }]);

  addPrediction({ token: "BTC", direction: "up", horizon_h: 1, entry_ts: 0, entry_price: 100 });
  addPrediction({ token: "ETH", direction: "up", horizon_h: 1, entry_ts: H, entry_price: 100 });
  await evaluateDue(10 * H, async (inst) => (inst === "BTC-USDT" ? 101 : 99));
  assert.deepEqual(
    accuracyOverTime().map((p) => p.cumulative),
    [1, 0.5],
  );
});

test("entities are decoded (numeric, hex, named, double-escaped)", () => {
  assert.equal(decodeEntities("Shiba Inu&#8217;da &#x201C;yön&#x201D; &amp; &hellip;"), "Shiba Inu’da “yön” & …");
  const xml = `<rss><channel><item><title>Shiba Inu&amp;#8217;da 798 c&#252;zdan</title><link>https://x.test/c</link></item></channel></rss>`;
  assert.equal(parseFeed(xml, "Coin-Turk")[0].title, "Shiba Inu’da 798 cüzdan");
});

test("the same article is not stored twice when its title re-encodes", () => {
  saveNews([{ id: "u1", source: "X", title: "It's live", summary: "", url: "https://x.test/same", published_at: 1, fetched_at: 1 }]);
  saveNews([{ id: "u2", source: "X", title: "It’s live", summary: "", url: "https://x.test/same", published_at: 1, fetched_at: 2 }]);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM news WHERE url = 'https://x.test/same'").get() as { n: number }).n, 1);
});

test("headline token tagging uses names and explicit tickers, limited to the universe", () => {
  const uni = new Set(["BTC", "ETH", "SOL", "ZEC", "XRP"]);
  assert.deepEqual(tagTokens("Solana ETF approved as Bitcoin steadies", uni).sort(), ["BTC", "SOL"]);
  assert.deepEqual(tagTokens("ZEC jumps 11% as ETF outflows continue", uni), ["ZEC"]); // ETF is not a ticker here
  assert.deepEqual(tagTokens("Tesla shares rally", uni), []);
  assert.deepEqual(tagTokens("Cardano upgrade", uni), []); // ADA not in this universe
});

test("RSS parsing dedupes by content hash and reads dates", () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[SEC approves <b>SOL</b> ETF]]></title><link>https://x.test/a</link><description>&lt;p&gt;Body&lt;/p&gt;</description><pubDate>Wed, 15 Oct 2026 10:20:00 GMT</pubDate></item>
    <item><title>Second</title><link>https://x.test/b</link></item>
  </channel></rss>`;
  const items = parseFeed(xml, "Test", 1);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "SEC approves SOL ETF");
  assert.equal(items[0].summary, "Body");
  assert.equal(items[0].published_at, Date.UTC(2026, 9, 15, 10, 20));
  assert.equal(items[1].published_at, null);
  assert.equal(parseFeed(xml, "Test", 2)[0].id, items[0].id);
});
