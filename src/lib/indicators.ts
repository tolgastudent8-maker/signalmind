/**
 * Technical indicators computed in code from OKX candles (no LLM involved).
 * Every series has the same length as its input; values before an indicator
 * has enough history are null.
 */

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** RSI with Wilder smoothing. */
export function rsi(closes: number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export type Macd = { macd: Series; signal: Series; hist: Series };

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line: Series = closes.map((_, i) => (f[i] !== null && s[i] !== null ? f[i]! - s[i]! : null));
  const firstIdx = line.findIndex((v) => v !== null);
  const signal: Series = new Array(closes.length).fill(null);
  if (firstIdx >= 0) {
    const compact = line.slice(firstIdx) as number[];
    const sig = ema(compact, signalPeriod);
    sig.forEach((v, j) => (signal[firstIdx + j] = v));
  }
  const hist: Series = line.map((v, i) => (v !== null && signal[i] !== null ? v - signal[i]! : null));
  return { macd: line, signal, hist };
}

export type Bands = { mid: Series; upper: Series; lower: Series };

/** Bollinger bands with population standard deviation. */
export function bollinger(closes: number[], period = 20, mult = 2): Bands {
  const mid = sma(closes, period);
  const upper: Series = new Array(closes.length).fill(null);
  const lower: Series = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const m = mid[i]!;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { mid, upper, lower };
}

export type OHLC = { o: number; h: number; l: number; c: number };

/** Average true range with Wilder smoothing. */
export function atr(candles: OHLC[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = candles.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c))));
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export const last = (s: Series): number | null => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] !== null) return s[i];
  return null;
};

export type BookLevel = { px: number; sz: number };
export type BookStats = {
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadBps: number;
  /**
   * Quote-currency depth within ±1% and ±2% of mid. `covered` is false when the fetched
   * levels stop short of that band (liquid books: 400 levels can span < 0.05%), so the
   * figure is a lower bound.
   */
  depth: { pct: number; bid: number; ask: number; covered: boolean }[];
  /** How far from mid (fraction) the fetched levels reach on the thinner side. */
  coverage: number;
  /** (bid − ask) / (bid + ask) depth within ±1%; >0 means more resting buy interest. */
  imbalance: number;
};

export type DepthPoint = { px: number; cum: number };

/**
 * Cumulative quote-currency depth per side out to ±`range` of mid, resampled to
 * `points` evenly spaced price steps (for the depth chart).
 */
export function depthCurve(bids: BookLevel[], asks: BookLevel[], range = 0.02, points = 40): { bids: DepthPoint[]; asks: DepthPoint[] } | null {
  if (!bids.length || !asks.length) return null;
  const mid = (bids[0].px + asks[0].px) / 2;
  const curve = (side: BookLevel[], dir: 1 | -1) => {
    const out: DepthPoint[] = [];
    for (let k = 1; k <= points; k++) {
      const px = mid * (1 + dir * range * (k / points));
      const cum = side.filter((l) => (dir === 1 ? l.px <= px : l.px >= px)).reduce((a, l) => a + l.px * l.sz, 0);
      out.push({ px, cum });
    }
    return out;
  };
  return { bids: curve(bids, -1), asks: curve(asks, 1) };
}

/** Fraction of mid that the fetched book reaches on its thinner side. */
export function bookCoverage(bids: BookLevel[], asks: BookLevel[]): number {
  if (!bids.length || !asks.length) return 0;
  const mid = (bids[0].px + asks[0].px) / 2;
  return Math.min((mid - bids[bids.length - 1].px) / mid, (asks[asks.length - 1].px - mid) / mid);
}

export function bookStats(bids: BookLevel[], asks: BookLevel[]): BookStats | null {
  if (!bids.length || !asks.length) return null;
  const bestBid = bids[0].px;
  const bestAsk = asks[0].px;
  const mid = (bestBid + bestAsk) / 2;
  const coverage = bookCoverage(bids, asks);
  const within = (side: BookLevel[], pct: number, dir: 1 | -1) =>
    side.filter((l) => (dir === 1 ? l.px <= mid * (1 + pct) : l.px >= mid * (1 - pct))).reduce((a, l) => a + l.px * l.sz, 0);
  const depth = [0.01, 0.02].map((pct) => ({ pct, bid: within(bids, pct, -1), ask: within(asks, pct, 1), covered: coverage >= pct }));
  const d1 = depth[0];
  return {
    bestBid,
    bestAsk,
    mid,
    spreadBps: ((bestAsk - bestBid) / mid) * 10_000,
    depth,
    coverage,
    imbalance: d1.bid + d1.ask > 0 ? (d1.bid - d1.ask) / (d1.bid + d1.ask) : 0,
  };
}
