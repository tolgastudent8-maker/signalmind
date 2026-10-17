import { test } from "node:test";
import assert from "node:assert/strict";
import { atr, bollinger, bookStats, depthCurve, ema, last, macd, rsi, sma } from "../src/lib/indicators.ts";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test("sma and ema warm up with nulls and track the input", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e.slice(0, 2), [null, null]);
  assert.equal(e[2], 2); // seeded with SMA
  assert.ok(close(e[3]!, 3)); // 4·0.5 + 2·0.5
  assert.ok(close(e[4]!, 4));
});

test("rsi is 100 on a straight rise, 0 on a straight fall, ~50 on alternation", () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  const zig = Array.from({ length: 60 }, (_, i) => 100 + (i % 2));
  assert.equal(last(rsi(up)), 100);
  assert.ok(close(last(rsi(down))!, 0));
  assert.ok(Math.abs(last(rsi(zig))! - 50) < 5);
  assert.equal(rsi(up).slice(0, 14).every((v) => v === null), true);
});

test("rsi matches the textbook Wilder example", () => {
  // StockCharts' Wilder sample. Their table shows 70.53 because it rounds the
  // averages to 0.24 / 0.10; unrounded: gains 3.34/14, losses 1.40/14 → RSI 70.46.
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  assert.ok(Math.abs(rsi(c)[14]! - 70.464) < 0.005, String(rsi(c)[14]));
});

test("macd histogram is macd minus signal and turns positive on an uptrend", () => {
  const c = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5);
  const m = macd(c);
  const i = c.length - 1;
  assert.ok(close(m.hist[i]!, m.macd[i]! - m.signal[i]!));
  assert.ok(m.macd[i]! > 0);
  assert.equal(m.signal.findIndex((v) => v !== null), 25 + 8);
});

test("bollinger bands collapse on a flat series and are symmetric", () => {
  const flat = new Array(25).fill(10);
  const b = bollinger(flat);
  assert.equal(b.upper[24], 10);
  assert.equal(b.lower[24], 10);
  const wave = Array.from({ length: 40 }, (_, i) => 10 + Math.sin(i));
  const w = bollinger(wave);
  assert.ok(close(w.upper[39]! - w.mid[39]!, w.mid[39]! - w.lower[39]!));
});

test("atr equals the constant range when bars do not gap", () => {
  const bars = Array.from({ length: 30 }, () => ({ o: 10, h: 11, l: 9, c: 10 }));
  assert.ok(close(last(atr(bars))!, 2));
});

test("order book stats: spread, depth bands and imbalance", () => {
  const bids = [
    { px: 99.9, sz: 10 },
    { px: 99, sz: 10 },
    { px: 97, sz: 100 },
  ];
  const asks = [
    { px: 100.1, sz: 5 },
    { px: 101.5, sz: 5 },
  ];
  const s = bookStats(bids, asks)!;
  assert.equal(s.mid, 100);
  assert.ok(close(s.spreadBps, 20));
  assert.ok(close(s.depth[0].bid, 99.9 * 10 + 99 * 10)); // 97 is outside ±1%
  assert.ok(close(s.depth[0].ask, 100.1 * 5));
  assert.ok(s.imbalance > 0);
  assert.equal(bookStats([], asks), null);

  const curve = depthCurve(bids, asks, 0.02, 4)!;
  assert.equal(curve.bids.length, 4);
  // Cumulative depth never shrinks moving away from mid.
  for (let i = 1; i < 4; i++) assert.ok(curve.bids[i].cum >= curve.bids[i - 1].cum && curve.asks[i].cum >= curve.asks[i - 1].cum);
  assert.ok(close(curve.asks[3].cum, 100.1 * 5 + 101.5 * 5)); // +2% reaches 102
});
