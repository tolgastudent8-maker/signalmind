import { atkCall } from "./atk.ts";

/**
 * OKX TR market data. Every call goes through the ATK MCP server first and
 * falls back to the public REST API, so a dead MCP process never stalls the demo.
 */

const REST = "https://tr.okx.com/api/v5";

export type DataSource = "atk" | "rest";
export type Candle = { ts: number; o: number; h: number; l: number; c: number; volQuote: number };
export type Ticker = {
  instId: string;
  last: number;
  open24h: number;
  volQuote24h: number;
  high24h: number;
  low24h: number;
  /** Best bid / ask at snapshot time (0 when the book side is empty). */
  bid: number;
  ask: number;
};

/** Mid of the touch when both sides exist, otherwise last trade. */
export const midOf = (t: Ticker) => (t.bid > 0 && t.ask > 0 ? (t.bid + t.ask) / 2 : t.last);

const g = globalThis as unknown as { __signalmindMarket?: { lastSource?: DataSource; tickers?: { at: number; data: Map<string, Ticker> } } };
const state = (g.__signalmindMarket ??= {});

export function lastDataSource(): DataSource | undefined {
  return state.lastSource;
}

type Envelope<T> = { ok?: boolean; data?: { data?: T } };

async function rest<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${REST}${pathAndQuery}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`OKX REST ${res.status}`);
  const body = (await res.json()) as { code: string; msg: string; data: T };
  if (body.code !== "0") throw new Error(`OKX REST ${body.code}: ${body.msg}`);
  return body.data;
}

async function viaAtk<T>(tool: string, args: Record<string, unknown>, restPath: string): Promise<T> {
  try {
    const env = await atkCall<Envelope<T>>(tool, args);
    if (env && env.ok !== false && env.data?.data !== undefined) {
      state.lastSource = "atk";
      return env.data.data;
    }
    throw new Error(`ATK ${tool}: beklenmeyen yanıt`);
  } catch {
    const data = await rest<T>(restPath);
    state.lastSource = "rest";
    return data;
  }
}

type RawTicker = { instId: string; last: string; open24h: string; volCcy24h: string; high24h: string; low24h: string; bidPx?: string; askPx?: string };

function toTicker(t: RawTicker): Ticker {
  return {
    instId: t.instId,
    last: Number(t.last),
    open24h: Number(t.open24h),
    volQuote24h: Number(t.volCcy24h),
    high24h: Number(t.high24h),
    low24h: Number(t.low24h),
    bid: Number(t.bidPx) || 0,
    ask: Number(t.askPx) || 0,
  };
}

export async function tickers(maxAgeMs = 30_000): Promise<Map<string, Ticker>> {
  if (state.tickers && Date.now() - state.tickers.at < maxAgeMs) return state.tickers.data;
  const raw = await viaAtk<RawTicker[]>("market_get_tickers", { instType: "SPOT" }, "/market/tickers?instType=SPOT");
  const data = new Map(raw.map((t) => [t.instId, toTicker(t)]));
  state.tickers = { at: Date.now(), data };
  return data;
}

export type UniverseToken = { symbol: string; instId: string; last: number; change24h: number; volUsd24h: number };

/** Tokens tradable on OKX TR (have a TRY pair), priced via their USDT pair. */
export async function universe(): Promise<UniverseToken[]> {
  const all = await tickers();
  const out: UniverseToken[] = [];
  for (const t of all.values()) {
    if (!t.instId.endsWith("-TRY")) continue;
    const symbol = t.instId.slice(0, -4);
    if (symbol === "USDT" || symbol === "USDC") continue;
    const usdt = all.get(`${symbol}-USDT`);
    if (!usdt || !usdt.last) continue;
    out.push({
      symbol,
      instId: usdt.instId,
      last: usdt.last,
      change24h: usdt.open24h ? usdt.last / usdt.open24h - 1 : 0,
      volUsd24h: usdt.volQuote24h,
    });
  }
  return out.sort((a, b) => b.volUsd24h - a.volUsd24h);
}

const BAR_MS: Record<string, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1H": 3_600_000, "4H": 14_400_000 };

/** Candles in ascending time order. `before` = only candles that START before this ms timestamp. */
export async function candles(instId: string, bar: keyof typeof BAR_MS, limit: number, before?: number): Promise<Candle[]> {
  const args: Record<string, unknown> = { instId, bar, limit };
  let restPath = `/market/history-candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  if (before !== undefined) {
    args.after = String(before);
    restPath += `&after=${before}`;
  }
  const raw = await viaAtk<string[][]>("market_get_candles", args, restPath);
  return raw
    .map((r) => ({ ts: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), volQuote: Number(r[7] ?? r[6]) }))
    .sort((a, b) => a.ts - b.ts);
}

export type OrderBook = { bids: { px: number; sz: number }[]; asks: { px: number; sz: number }[]; ts: number };

/** Top-of-book depth (best first on each side). */
export async function orderbook(instId: string, depth = 50): Promise<OrderBook> {
  const raw = await viaAtk<{ asks: string[][]; bids: string[][]; ts: string }[]>(
    "market_get_orderbook",
    { instId, sz: depth },
    `/market/books?instId=${instId}&sz=${depth}`,
  );
  const book = raw[0] ?? { asks: [], bids: [], ts: "0" };
  const side = (rows: string[][]) => rows.map((r) => ({ px: Number(r[0]), sz: Number(r[1]) })).filter((l) => l.px > 0 && l.sz > 0);
  return { bids: side(book.bids), asks: side(book.asks), ts: Number(book.ts) };
}

/** Price at a moment: open of the first 1-minute candle starting at or after `ts`. Null if it doesn't exist yet. */
export async function priceAt(instId: string, ts: number): Promise<number | null> {
  const start = Math.ceil(ts / 60_000) * 60_000;
  const rows = await candles(instId, "1m", 1, start + 60_000);
  const hit = rows.find((c) => c.ts === start);
  return hit ? hit.o : null;
}

export type Snapshot = {
  instId: string;
  asOf: number;
  price: number | null;
  ret1h: number | null;
  ret4h: number | null;
  ret24h: number | null;
  hourlyVol: number | null;
  momentumDir: "up" | "down" | "flat";
};

/**
 * Market state strictly before `asOf`: only 1H candles that have fully closed
 * by `asOf` are used, so backtests never see post-news prices.
 */
export function lastClosedHourStart(asOf: number): number {
  const hour = BAR_MS["1H"];
  return Math.floor(asOf / hour) * hour - hour;
}

/** Keeps only 1H candles whose full hour ended at or before `asOf`. */
export function closedBefore(rows: Candle[], asOf: number): Candle[] {
  const cutoff = lastClosedHourStart(asOf);
  return rows.filter((c) => c.ts <= cutoff);
}

export async function snapshot(instId: string, asOf: number, livePrice?: number): Promise<Snapshot> {
  const rows = closedBefore(await candles(instId, "1H", 30, lastClosedHourStart(asOf) + BAR_MS["1H"]), asOf);
  const closes = rows.map((c) => c.c);
  const n = closes.length;
  const ret = (k: number) => (n > k ? closes[n - 1] / closes[n - 1 - k] - 1 : null);
  const hourly = closes.slice(1).map((c, i) => c / closes[i] - 1);
  const mean = hourly.reduce((a, b) => a + b, 0) / (hourly.length || 1);
  const vol = hourly.length > 4 ? Math.sqrt(hourly.reduce((a, b) => a + (b - mean) ** 2, 0) / (hourly.length - 1)) : null;
  const r1 = ret(1);
  const price = livePrice ?? (await priceAt(instId, asOf));
  return {
    instId,
    asOf,
    price,
    ret1h: r1,
    ret4h: ret(4),
    ret24h: ret(24),
    hourlyVol: vol,
    momentumDir: r1 === null ? "flat" : r1 > 0.002 ? "up" : r1 < -0.002 ? "down" : "flat",
  };
}
