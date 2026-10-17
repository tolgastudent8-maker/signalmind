import { db, kvGet, kvSet } from "./db.ts";
import { candles, priceAt, universe, type Candle } from "./market.ts";
import type { AnalysisResult } from "./agents/pipeline.ts";

/**
 * Event study: how each impacted token actually moved around the news.
 * Prices are normalised to the price at publication (p0 = first 1-minute open
 * after the news); "adjusted" subtracts BTC's move over the same interval, so
 * a token's own reaction is separated from the market's.
 */

export const OFFSETS = [15, 60, 240, 1440] as const; // minutes after the news
const BAR_MS = 15 * 60_000;
const PRE_MS = 2 * 3_600_000;
const POST_MS = 24 * 3_600_000;

export type PathPoint = { m: number; r: number; adj: number | null };
export type TokenStudy = {
  symbol: string;
  path: PathPoint[];
  at: Record<string, number | null>;
  adjAt: Record<string, number | null>;
  peak: { m: number; r: number } | null;
};
export type EventStudy = { analysisId: string; t0: number; complete: boolean; btc: PathPoint[]; tokens: TokenStudy[] };

/** Return of each candle close vs p0, keyed by minutes from t0 (end of the candle). */
export function normalisedPath(rows: Candle[], p0: number, t0: number): { m: number; r: number }[] {
  return rows.map((c) => ({ m: Math.round((c.ts + BAR_MS - t0) / 60_000), r: c.c / p0 - 1 }));
}

/** Value at the last point at or before `minute` (null if the window hasn't reached it yet). */
export function valueAt(path: { m: number; r: number }[], minute: number): number | null {
  let best: number | null = null;
  for (const p of path) if (p.m <= minute && p.m >= minute - 15) best = p.r;
  return best;
}

export function peakMove(path: { m: number; r: number }[]): { m: number; r: number } | null {
  const post = path.filter((p) => p.m > 0);
  if (!post.length) return null;
  return post.reduce((a, b) => (Math.abs(b.r) > Math.abs(a.r) ? b : a));
}

async function tokenPath(instId: string, t0: number, until: number): Promise<{ m: number; r: number }[] | null> {
  const rows = (await candles(instId, "15m", 110, until + BAR_MS)).filter((c) => c.ts >= t0 - PRE_MS && c.ts + BAR_MS <= until + BAR_MS);
  if (!rows.length) return null;
  const p0 = (await priceAt(instId, t0).catch(() => null)) ?? rows.find((c) => c.ts + BAR_MS > t0)?.o ?? null;
  return p0 ? normalisedPath(rows, p0, t0) : null;
}

export async function eventStudy(analysisId: string): Promise<EventStudy | null> {
  const cached = kvGet<{ at: number; study: EventStudy }>(`es:${analysisId}`);
  if (cached && (cached.study.complete || Date.now() - cached.at < 5 * 60_000)) return cached.study;

  const row = db()
    .prepare(`SELECT a.as_of, a.result_json, n.published_at FROM analyses a JOIN news n ON n.id = a.news_id WHERE a.id = ? AND a.status = 'done'`)
    .get(analysisId) as { as_of: number; result_json: string | null; published_at: number | null } | undefined;
  if (!row?.result_json) return null;
  const result = JSON.parse(row.result_json) as AnalysisResult;
  const t0 = row.published_at ?? row.as_of;
  const until = Math.min(Date.now(), t0 + POST_MS);
  const uni = new Map((await universe()).map((u) => [u.symbol, u.instId]));

  const btcRaw = await tokenPath("BTC-USDT", t0, until);
  const btc: PathPoint[] = (btcRaw ?? []).map((p) => ({ ...p, adj: 0 }));
  const btcAt = new Map(btc.map((p) => [p.m, p.r]));

  const tokens: TokenStudy[] = [];
  for (const imp of result.impact.impacts) {
    const instId = uni.get(imp.token);
    if (!instId) continue;
    const raw = imp.token === "BTC" ? btcRaw : await tokenPath(instId, t0, until).catch(() => null);
    if (!raw) continue;
    const path: PathPoint[] = raw.map((p) => ({ ...p, adj: imp.token === "BTC" ? 0 : btcAt.has(p.m) ? p.r - btcAt.get(p.m)! : null }));
    const at: Record<string, number | null> = {};
    const adjAt: Record<string, number | null> = {};
    for (const o of OFFSETS) {
      at[o] = valueAt(raw, o);
      const b = valueAt(btcRaw ?? [], o);
      adjAt[o] = at[o] !== null && b !== null ? at[o]! - b : null;
    }
    tokens.push({ symbol: imp.token, path, at, adjAt, peak: peakMove(raw) });
  }

  const study: EventStudy = { analysisId, t0, complete: Date.now() >= t0 + POST_MS + BAR_MS, btc, tokens };
  kvSet(`es:${analysisId}`, { at: Date.now(), study });
  return study;
}

export type ReactionGroup = { key: string; n: number; mean1h: number | null; mean24h: number | null };

/**
 * Average absolute BTC-adjusted move by news kind, across analysed stories.
 * Answers: do "new information" headlines move prices more than price recaps?
 */
export async function reactionByKind(maxCompute = 6): Promise<{ byInfo: ReactionGroup[]; byEvent: ReactionGroup[]; analyses: number }> {
  const rows = db()
    .prepare(`SELECT id, result_json FROM analyses WHERE status = 'done' AND result_json IS NOT NULL ORDER BY created_at DESC LIMIT 60`)
    .all() as { id: string; result_json: string }[];
  const samples: { info: string; event: string; a1: number | null; a24: number | null }[] = [];
  let computed = 0;
  for (const r of rows) {
    const cached = kvGet<{ study: EventStudy }>(`es:${r.id}`);
    let study = cached?.study ?? null;
    if (!study && computed < maxCompute) {
      study = await eventStudy(r.id).catch(() => null);
      computed++;
    }
    if (!study) continue;
    const res = JSON.parse(r.result_json) as AnalysisResult;
    for (const t of study.tokens) {
      if (t.symbol === "BTC") continue;
      samples.push({ info: res.news.information_type ?? "unknown", event: res.news.event_type, a1: t.adjAt["60"], a24: t.adjAt["1440"] });
    }
  }
  const group = (key: (s: (typeof samples)[number]) => string): ReactionGroup[] => {
    const m = new Map<string, typeof samples>();
    for (const s of samples) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
    const mean = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null).map(Math.abs);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    return [...m.entries()].map(([k, xs]) => ({ key: k, n: xs.length, mean1h: mean(xs.map((x) => x.a1)), mean24h: mean(xs.map((x) => x.a24)) })).sort((a, b) => b.n - a.n);
  };
  return { byInfo: group((s) => s.info), byEvent: group((s) => s.event), analyses: rows.length };
}
