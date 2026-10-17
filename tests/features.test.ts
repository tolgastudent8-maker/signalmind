import { test } from "node:test";
import assert from "node:assert/strict";
import { basketPremium, tokenPremium, type TokenPremium } from "../src/lib/turkey.ts";
import { normalisedPath, peakMove, valueAt } from "../src/lib/eventstudy.ts";
import { judgeDirection, primaryToken, scoreAnalysis, type AgentRecord } from "../src/lib/agent-record.ts";
import type { Ticker } from "../src/lib/market.ts";
import type { AnalysisResult } from "../src/lib/agents/pipeline.ts";
import type { EventStudy } from "../src/lib/eventstudy.ts";

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const tk = (bid: number, ask: number, last = (bid + ask) / 2, vol = 0): Ticker => ({ instId: "X", last, open24h: last, volQuote24h: vol, high24h: last, low24h: last, bid, ask });

test("TR premium compares the TRY mid with the USDT mid converted at USDT/TRY", () => {
  // USDT 100, USDT/TRY 40 → fair TRY 4000; book mid 4040 → +1%
  assert.ok(close(tokenPremium(tk(4030, 4050), tk(99.9, 100.1), 40)!, 0.01));
  // Falls back to last trade when one side of the book is empty.
  assert.ok(close(tokenPremium(tk(0, 0, 3960), tk(100, 100), 40)!, -0.01));
  assert.equal(tokenPremium(tk(0, 0, 0), tk(100, 100), 40), null);
});

test("basket premium is TRY-volume weighted over liquid pairs only", () => {
  const t = (premium: number, vol: number, liquid: boolean): TokenPremium => ({ symbol: "x", tryMid: 1, usdtMid: 1, premium, tryVol24h: vol, liquid });
  assert.ok(close(basketPremium([t(0.01, 3e6, true), t(-0.01, 1e6, true), t(0.5, 9e9, false)])!, 0.005));
  assert.equal(basketPremium([t(0.5, 10, false)]), null);
});

test("event-study path is normalised to the news price and keyed by minutes after the news", () => {
  const t0 = Date.UTC(2026, 9, 16, 10, 20);
  const bar = 15 * 60_000;
  // Five 15m candles from 10:00, closing at 100, 101, …, 104.
  const rows = Array.from({ length: 5 }, (_, i) => ({ ts: Date.UTC(2026, 9, 16, 10, 0) + i * bar, o: 100, h: 0, l: 0, c: 100 + i, volQuote: 0 }));
  const path = normalisedPath(rows, 100, t0);
  // Candle 10:00–10:15 closes 5 min before the news; 10:15–10:30 closes 10 min after.
  assert.deepEqual(
    path.map((p) => p.m),
    [-5, 10, 25, 40, 55],
  );
  assert.ok(close(path[1].r, 0.01));
  assert.ok(close(valueAt(path, 15)!, 0.01)); // latest point within (0, 15]
  assert.ok(close(valueAt(path, 60)!, 0.04));
  assert.equal(valueAt(path, 240), null); // window hasn't reached +4h
  const pk = peakMove(path)!;
  assert.equal(pk.m, 55);
  assert.ok(close(pk.r, 0.04));
});

function fakeResult(over: Partial<AnalysisResult["impact"]["impacts"][number]>[], winner: "bull" | "bear" | "balanced"): AnalysisResult {
  return {
    impact: { impacts: over.map((o) => ({ token: "SOL", relation: "sector", direction: "up", strength: "low", confidence: 50, mechanism: "", evidence: [], ...o })), market_wide_note: "" },
    verdict: { winner, bull_score: 0, bear_score: 0, decisive_points: [], weak_points: [], reasoning: "" },
  } as unknown as AnalysisResult;
}

test("primary token prefers a direct mention, then confidence; judge maps winner to a direction", () => {
  const r = fakeResult(
    [
      { token: "BTC", relation: "correlation", confidence: 90 },
      { token: "SOL", relation: "direct", confidence: 60 },
    ],
    "bull",
  );
  assert.equal(primaryToken(r), "SOL");
  assert.equal(judgeDirection("bull"), "up");
  assert.equal(judgeDirection("bear"), "down");
  assert.equal(judgeDirection("balanced"), "flat");
});

test("agent record scores Impact Radar per token and the judge on the primary token", () => {
  const r = fakeResult(
    [
      { token: "SOL", relation: "direct", direction: "up" },
      { token: "BTC", relation: "correlation", direction: "flat" },
    ],
    "bear",
  );
  const study: EventStudy = {
    analysisId: "a",
    t0: 0,
    complete: false,
    btc: [],
    tokens: [
      { symbol: "SOL", path: [], at: { 15: 0, 60: 0.02, 240: null, 1440: null }, adjAt: {}, peak: null },
      { symbol: "BTC", path: [], at: { 15: 0, 60: 0.001, 240: null, 1440: null }, adjAt: {}, peak: null },
    ],
  };
  const rec: AgentRecord = {
    impact: { "1h": { n: 0, hits: 0, rate: null }, "24h": { n: 0, hits: 0, rate: null } },
    judge: { "1h": { n: 0, hits: 0, rate: null }, "24h": { n: 0, hits: 0, rate: null } },
    sides: { "1h": { bull: 0, bear: 0, flat: 0 }, "24h": { bull: 0, bear: 0, flat: 0 } },
    analyses: 1,
    studied: 1,
  };
  scoreAnalysis(r, study, rec);
  // SOL +2% (up ✓) and BTC +0.1% (flat ✓) → Impact 2/2; judge said bear on SOL which went up → 0/1.
  assert.deepEqual([rec.impact["1h"].hits, rec.impact["1h"].n], [2, 2]);
  assert.deepEqual([rec.judge["1h"].hits, rec.judge["1h"].n], [0, 1]);
  assert.deepEqual(rec.sides["1h"], { bull: 1, bear: 0, flat: 0 });
  assert.equal(rec.impact["24h"].n, 0); // no 24h data yet
});
