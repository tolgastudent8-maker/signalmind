"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Candle } from "@/lib/market";
import type { Series } from "@/lib/indicators";
import { fmtPrice } from "./ui";

/**
 * Multi-pane technical chart drawn in SVG: price (candles + Bollinger + EMA),
 * volume, RSI and MACD share one time axis and one crosshair. Each pane has its
 * own single y-scale (stacked panes, never a dual axis).
 */

export type Indicators = {
  ema20: Series;
  ema50: Series;
  bbUpper: Series;
  bbMid: Series;
  bbLower: Series;
  rsi: Series;
  macd: Series;
  signal: Series;
  hist: Series;
};

export type ChartMarker = { ts: number; price: number; dir: string; status: string; horizon: number };

const C = {
  up: "#2fd68a",
  down: "#ff5c6c",
  grid: "#1a202b",
  axis: "#5b667d",
  text: "#8a94a8",
  ema20: "#c6f432",
  ema50: "#f5c451",
  band: "#7aa7ff",
  rsi: "#7aa7ff",
  macd: "#e4e8ef",
  signal: "#f5c451",
  cross: "#8a94a8",
  pending: "#f5c451",
};

const AXIS_W = 64;
const PANES = { price: 300, volume: 64, rsi: 92, macd: 92 };
const GAP = 10;
const TIME_H = 22;

/**
 * Element width via a callback ref: measured synchronously when the node mounts
 * (ResizeObserver callbacks can be delayed in background tabs) and re-measured
 * if the node is replaced, e.g. when content appears after data loads.
 */
function useWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (node) setW(Math.floor(node.getBoundingClientRect().width));
  }, [node]);
  useEffect(() => {
    if (!node) return;
    const ro = new ResizeObserver((e) => setW(Math.floor(e[0].contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [setNode, w];
}

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-12; v += step) out.push(v);
  return out;
}

function linePath(values: Series, x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  return d;
}

function bandPath(upper: Series, lower: Series, x: (i: number) => number, y: (v: number) => number): string {
  const idx = upper.map((v, i) => (v !== null && lower[i] !== null ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return "";
  const top = idx.map((i, k) => `${k ? "L" : "M"}${x(i).toFixed(1)},${y(upper[i]!).toFixed(1)}`).join("");
  const bottom = [...idx].reverse().map((i) => `L${x(i).toFixed(1)},${y(lower[i]!).toFixed(1)}`).join("");
  return `${top}${bottom}Z`;
}

const fmtCompact = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : v.toFixed(0));

export function TechChart({
  candles,
  ind,
  markers,
  bar,
}: {
  candles: Candle[];
  ind: Indicators;
  markers: ChartMarker[];
  bar: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [show, setShow] = useState({ ema: true, bb: true, markers: true });

  const n = candles.length;
  const plotW = Math.max(0, width - AXIS_W);
  const step = n ? plotW / n : 0;
  const bodyW = Math.max(1, Math.min(14, step * 0.68));
  const x = (i: number) => i * step + step / 2;

  const top = { price: 0, volume: PANES.price + GAP, rsi: PANES.price + GAP + PANES.volume + GAP, macd: PANES.price + GAP + PANES.volume + GAP + PANES.rsi + GAP };
  const totalH = top.macd + PANES.macd + TIME_H;

  const scales = useMemo(() => {
    const vals: number[] = [];
    candles.forEach((c, i) => {
      vals.push(c.h, c.l);
      if (show.bb) {
        if (ind.bbUpper[i] !== null) vals.push(ind.bbUpper[i]!);
        if (ind.bbLower[i] !== null) vals.push(ind.bbLower[i]!);
      }
    });
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.06 || hi * 0.01;
    const pLo = lo - pad;
    const pHi = hi + pad;
    const vMax = Math.max(...candles.map((c) => c.volQuote), 1);
    const mVals = [...ind.macd, ...ind.signal, ...ind.hist].filter((v): v is number => v !== null);
    const mAbs = Math.max(...mVals.map(Math.abs), 1e-9) * 1.1;
    return {
      pLo,
      pHi,
      py: (v: number) => top.price + ((pHi - v) / (pHi - pLo)) * PANES.price,
      vy: (v: number) => top.volume + PANES.volume - (v / vMax) * PANES.volume,
      vMax,
      ry: (v: number) => top.rsi + ((100 - v) / 100) * PANES.rsi,
      my: (v: number) => top.macd + PANES.macd / 2 - (v / mAbs) * (PANES.macd / 2),
      mAbs,
    };
  }, [candles, ind, show.bb, top.price, top.volume, top.rsi, top.macd]);

  if (!n) return <div ref={ref} className="h-[600px]" />;

  const { py, vy, ry, my, pLo, pHi } = scales;
  const lastC = candles[n - 1];
  const hi = hover ?? n - 1;
  const hc = candles[hi];
  const prev = candles[hi - 1];
  const chg = prev ? hc.c / prev.c - 1 : 0;
  const tsIdx = new Map(candles.map((c, i) => [c.ts, i]));
  const barMs = n > 1 ? candles[1].ts - candles[0].ts : 3_600_000;
  const markerIdx = (ts: number) => {
    const start = Math.floor(ts / barMs) * barMs;
    return tsIdx.get(start) ?? null;
  };
  // One time label per ~90px so narrow screens don't overlap them.
  const tickCount = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
  const timeTicks = Array.from({ length: tickCount }, (_, k) => Math.round((k * (n - 1)) / (tickCount - 1)));
  const fmtTime = (ts: number) =>
    new Date(ts).toLocaleString("tr-TR", bar === "15m" ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", ...(bar === "1H" ? { hour: "2-digit" } : {}) });

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px > plotW) return setHover(null);
    setHover(Math.max(0, Math.min(n - 1, Math.floor(px / step))));
  }

  const r = (v: Series) => v[hi];
  const lastPriceY = py(lastC.c);

  return (
    <div ref={ref} className="select-none">
      {/* Readout row: values under the crosshair (or the latest bar). */}
      <div className="num mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="text-ink-300">{new Date(hc.ts).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
        <span>
          <span className="text-ink-500">A</span> <span className="text-ink-100">{fmtPrice(hc.o)}</span>
        </span>
        <span>
          <span className="text-ink-500">Y</span> <span className="text-ink-100">{fmtPrice(hc.h)}</span>
        </span>
        <span>
          <span className="text-ink-500">D</span> <span className="text-ink-100">{fmtPrice(hc.l)}</span>
        </span>
        <span>
          <span className="text-ink-500">K</span> <span className={hc.c >= hc.o ? "text-up" : "text-down"}>{fmtPrice(hc.c)}</span>
        </span>
        <span className={chg >= 0 ? "text-up" : "text-down"}>
          {chg >= 0 ? "+" : ""}
          {(chg * 100).toFixed(2)}%
        </span>
        <span>
          <span className="text-ink-500">Hacim</span> <span className="text-ink-200">${fmtCompact(hc.volQuote)}</span>
        </span>
        <span className="ml-auto flex gap-1.5 font-sans">
          {(
            [
              ["ema", "EMA 20/50"],
              ["bb", "Bollinger"],
              ["markers", "Tahminler"],
            ] as const
          )
            .filter(([k]) => k !== "markers" || markers.length > 0)
            .map(([k, label]) => (
            <button
              key={k}
              onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))}
              aria-pressed={show[k]}
              className={`rounded-md px-2 py-0.5 text-[11px] ring-1 ring-inset ${show[k] ? "bg-ink-800 text-ink-100 ring-ink-600" : "text-ink-500 ring-ink-800"}`}
            >
              {label}
            </button>
          ))}
        </span>
      </div>

      <svg width={width} height={totalH} onMouseMove={onMove} onMouseLeave={() => setHover(null)} className="block" role="img" aria-label="Mum grafiği, hacim, RSI ve MACD">
        {/* Grid + y-axis labels per pane */}
        {niceTicks(pLo, pHi, 5).map((v) => (
          <g key={`p${v}`}>
            <line x1={0} x2={plotW} y1={py(v)} y2={py(v)} stroke={C.grid} />
            <text x={plotW + 6} y={py(v) + 3.5} fontSize="10" fill={C.text} className="num">
              {fmtPrice(v)}
            </text>
          </g>
        ))}
        {[30, 50, 70].map((v) => (
          <g key={`r${v}`}>
            <line x1={0} x2={plotW} y1={ry(v)} y2={ry(v)} stroke={v === 50 ? C.grid : "#2a3243"} strokeDasharray={v === 50 ? undefined : "3 3"} />
            <text x={plotW + 6} y={ry(v) + 3.5} fontSize="10" fill={C.text} className="num">
              {v}
            </text>
          </g>
        ))}
        <rect x={0} y={ry(70)} width={plotW} height={ry(30) - ry(70)} fill={C.rsi} opacity={0.04} />
        <line x1={0} x2={plotW} y1={my(0)} y2={my(0)} stroke="#2a3243" />
        <text x={plotW + 6} y={vy(scales.vMax) + 9} fontSize="10" fill={C.text} className="num">
          ${fmtCompact(scales.vMax)}
        </text>
        {timeTicks.map((i, k) => (
          <g key={`t${i}`}>
            <line x1={x(i)} x2={x(i)} y1={0} y2={top.macd + PANES.macd} stroke={C.grid} />
            {/* Edge labels hug the plot edges so they never clip. */}
            <text x={k === 0 ? 2 : k === timeTicks.length - 1 ? plotW - 2 : x(i)} y={totalH - 6} fontSize="10" fill={C.text} textAnchor={k === 0 ? "start" : k === timeTicks.length - 1 ? "end" : "middle"} className="num">
              {fmtTime(candles[i].ts)}
            </text>
          </g>
        ))}

        {/* Pane titles */}
        {(
          [
            ["Hacim", top.volume],
            ["RSI 14", top.rsi],
            ["MACD 12·26·9", top.macd],
          ] as const
        ).map(([t, y]) => (
          <text key={t} x={6} y={y + 12} fontSize="10" fill={C.text} fontWeight={600}>
            {t}
          </text>
        ))}

        {/* Bollinger band */}
        {show.bb && (
          <g>
            <path d={bandPath(ind.bbUpper, ind.bbLower, x, py)} fill={C.band} opacity={0.07} />
            <path d={linePath(ind.bbUpper, x, py)} fill="none" stroke={C.band} strokeWidth={1} opacity={0.5} />
            <path d={linePath(ind.bbLower, x, py)} fill="none" stroke={C.band} strokeWidth={1} opacity={0.5} />
            <path d={linePath(ind.bbMid, x, py)} fill="none" stroke={C.band} strokeWidth={1} strokeDasharray="2 3" opacity={0.45} />
          </g>
        )}

        {/* Candles */}
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const col = up ? C.up : C.down;
          const yo = py(c.o);
          const yc = py(c.c);
          return (
            <g key={c.ts}>
              <line x1={x(i)} x2={x(i)} y1={py(c.h)} y2={py(c.l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - bodyW / 2} y={Math.min(yo, yc)} width={bodyW} height={Math.max(1, Math.abs(yc - yo))} fill={col} rx={bodyW > 4 ? 1 : 0} />
              <rect x={x(i) - bodyW / 2} y={vy(c.volQuote)} width={bodyW} height={top.volume + PANES.volume - vy(c.volQuote)} fill={col} opacity={0.35} />
            </g>
          );
        })}

        {/* EMAs */}
        {show.ema && (
          <g fill="none" strokeWidth={1.6}>
            <path d={linePath(ind.ema20, x, py)} stroke={C.ema20} />
            <path d={linePath(ind.ema50, x, py)} stroke={C.ema50} />
          </g>
        )}

        {/* Last price */}
        <line x1={0} x2={plotW} y1={lastPriceY} y2={lastPriceY} stroke={lastC.c >= lastC.o ? C.up : C.down} strokeDasharray="2 3" opacity={0.7} />
        <rect x={plotW + 1} y={lastPriceY - 8} width={AXIS_W - 2} height={16} rx={3} fill={lastC.c >= lastC.o ? C.up : C.down} />
        <text x={plotW + 6} y={lastPriceY + 3.5} fontSize="10" fill="#07090d" fontWeight={700} className="num">
          {fmtPrice(lastC.c)}
        </text>

        {/* Prediction markers: ▲ up, ▼ down, ◆ flat; colour = outcome */}
        {show.markers &&
          markers.map((m, k) => {
            const i = markerIdx(m.ts);
            if (i === null) return null;
            const col = m.status === "correct" ? C.up : m.status === "wrong" ? C.down : C.pending;
            const cx = x(i);
            const cy = m.dir === "down" ? py(candles[i].h) - 12 : py(candles[i].l) + 12;
            const s = 6;
            const shape =
              m.dir === "up" ? `M${cx},${cy - s} L${cx + s},${cy + s} L${cx - s},${cy + s}Z` : m.dir === "down" ? `M${cx},${cy + s} L${cx + s},${cy - s} L${cx - s},${cy - s}Z` : `M${cx},${cy - s} L${cx + s},${cy} L${cx},${cy + s} L${cx - s},${cy}Z`;
            return (
              <path key={k} d={shape} fill={col} stroke="#07090d" strokeWidth={1.5}>
                <title>{`${m.horizon}s tahmin · ${m.dir} · ${m.status} · giriş ${fmtPrice(m.price)}`}</title>
              </path>
            );
          })}

        {/* RSI */}
        <path d={linePath(ind.rsi, x, ry)} fill="none" stroke={C.rsi} strokeWidth={1.6} />

        {/* MACD */}
        {ind.hist.map((v, i) =>
          v === null ? null : (
            <rect key={`h${i}`} x={x(i) - bodyW / 2} y={Math.min(my(0), my(v))} width={bodyW} height={Math.max(0.5, Math.abs(my(v) - my(0)))} fill={v >= 0 ? C.up : C.down} opacity={0.45} />
          ),
        )}
        <path d={linePath(ind.macd, x, my)} fill="none" stroke={C.macd} strokeWidth={1.4} />
        <path d={linePath(ind.signal, x, my)} fill="none" stroke={C.signal} strokeWidth={1.4} />

        {/* Crosshair */}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={x(hi)} x2={x(hi)} y1={0} y2={top.macd + PANES.macd} stroke={C.cross} strokeDasharray="3 3" opacity={0.6} />
            <line x1={0} x2={plotW} y1={py(hc.c)} y2={py(hc.c)} stroke={C.cross} strokeDasharray="3 3" opacity={0.4} />
            <rect x={plotW + 1} y={py(hc.c) - 8} width={AXIS_W - 2} height={16} rx={3} fill="#2a3243" />
            <text x={plotW + 6} y={py(hc.c) + 3.5} fontSize="10" fill="#e4e8ef" className="num">
              {fmtPrice(hc.c)}
            </text>
          </g>
        )}

        {/* Pane value labels at the crosshair */}
        <text x={plotW - 4} y={top.rsi + 12} fontSize="10" textAnchor="end" fill={C.rsi} className="num">
          {r(ind.rsi) !== null ? r(ind.rsi)!.toFixed(1) : ""}
        </text>
        <text x={plotW - 4} y={top.macd + 12} fontSize="10" textAnchor="end" className="num">
          <tspan fill={C.macd}>{r(ind.macd) !== null ? r(ind.macd)!.toPrecision(3) : ""}</tspan>
          <tspan dx="6" fill={C.signal}>
            {r(ind.signal) !== null ? r(ind.signal)!.toPrecision(3) : ""}
          </tspan>
        </text>
      </svg>

      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-ink-400">
        {show.ema && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: C.ema20 }} /> EMA 20
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ background: C.ema50 }} /> EMA 50
            </span>
          </>
        )}
        {show.bb && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm" style={{ background: C.band, opacity: 0.35 }} /> Bollinger 20·2
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: C.macd }} /> MACD
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: C.signal }} /> Sinyal
        </span>
        {show.markers && markers.length > 0 && (
          <span>
            Tahmin: <span className="text-up">▲</span> yükseliş · <span className="text-down">▼</span> düşüş · ◆ yatay — renk sonucu gösterir (yeşil doğru, kırmızı yanlış, sarı bekliyor)
          </span>
        )}
      </div>
    </div>
  );
}

/** Cumulative bid/ask depth to ±2% of mid. */
/** "%0.02" style label for a fraction, with enough decimals for very tight bands. */
export function fmtBand(f: number): string {
  const p = f * 100;
  return `%${p >= 1 ? p.toFixed(p % 1 ? 1 : 0) : p >= 0.1 ? p.toFixed(2) : p.toFixed(3)}`.replace(".", ",");
}

export function DepthChart({ curve, mid, range = 0.02 }: { curve: { bids: { px: number; cum: number }[]; asks: { px: number; cum: number }[] }; mid: number; range?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ side: "bid" | "ask"; px: number; cum: number } | null>(null);
  const H = 150;
  const B = 18;
  const lo = curve.bids[curve.bids.length - 1]?.px ?? mid * 0.98;
  const hi = curve.asks[curve.asks.length - 1]?.px ?? mid * 1.02;
  const maxCum = Math.max(1, ...curve.bids.map((p) => p.cum), ...curve.asks.map((p) => p.cum));
  const xs = (px: number) => ((px - lo) / (hi - lo)) * width;
  const ys = (c: number) => H - B - (c / maxCum) * (H - B - 8);
  const area = (pts: { px: number; cum: number }[]) => {
    if (!pts.length) return "";
    let d = `M${xs(mid)},${ys(0)}`;
    let prevY = ys(0);
    for (const p of pts) {
      d += `L${xs(p.px)},${prevY}L${xs(p.px)},${ys(p.cum)}`;
      prevY = ys(p.cum);
    }
    d += `L${xs(pts[pts.length - 1].px)},${ys(0)}Z`;
    return d;
  };

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = lo + ((e.clientX - rect.left) / width) * (hi - lo);
    const side = px < mid ? curve.bids : curve.asks;
    const p = [...side].sort((a, b) => Math.abs(a.px - px) - Math.abs(b.px - px))[0];
    if (p) setHover({ side: px < mid ? "bid" : "ask", ...p });
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Emir defteri derinlik grafiği">
          <path d={area(curve.bids)} fill={C.up} fillOpacity={0.18} stroke={C.up} strokeWidth={1.5} />
          <path d={area(curve.asks)} fill={C.down} fillOpacity={0.18} stroke={C.down} strokeWidth={1.5} />
          <line x1={xs(mid)} x2={xs(mid)} y1={4} y2={H - B} stroke="#5b667d" strokeDasharray="3 3" />
          {[-1, -0.5, 0, 0.5, 1].map((k) => (
            <text key={k} x={Math.min(width - 18, Math.max(18, xs(mid * (1 + k * range))))} y={H - 4} fontSize="10" fill={C.text} textAnchor="middle" className="num">
              {k === 0 ? "orta" : `${k > 0 ? "+" : "−"}${fmtBand(Math.abs(k) * range)}`}
            </text>
          ))}
          {hover && <line x1={xs(hover.px)} x2={xs(hover.px)} y1={4} y2={H - B} stroke="#8a94a8" opacity={0.6} />}
        </svg>
      )}
      {hover && (
        <div className="num pointer-events-none absolute left-2 top-1 rounded-md bg-ink-900/95 px-2 py-1 text-[11px] ring-1 ring-ink-700">
          <span className={hover.side === "bid" ? "text-up" : "text-down"}>{hover.side === "bid" ? "Alış" : "Satış"}</span> {fmtPrice(hover.px)} · kümülatif $
          {fmtCompact(hover.cum)}
        </div>
      )}
    </div>
  );
}

/** Top-of-book ladder with size bars. */
export function BookLadder({ bids, asks, rows = 10 }: { bids: { px: number; sz: number }[]; asks: { px: number; sz: number }[]; rows?: number }) {
  const a = asks.slice(0, rows);
  const b = bids.slice(0, rows);
  const maxQ = Math.max(1, ...a.map((l) => l.px * l.sz), ...b.map((l) => l.px * l.sz));
  const spread = a[0] && b[0] ? a[0].px - b[0].px : null;
  const Row = ({ l, side }: { l: { px: number; sz: number }; side: "bid" | "ask" }) => (
    <div className="relative grid grid-cols-3 px-2 py-[3px] text-[11.5px]">
      <div className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-up/10" : "bg-down/10"}`} style={{ width: `${((l.px * l.sz) / maxQ) * 100}%` }} />
      <span className={`relative ${side === "bid" ? "text-up" : "text-down"}`}>{fmtPrice(l.px)}</span>
      <span className="relative text-right text-ink-200">{l.sz < 1 ? l.sz.toPrecision(3) : l.sz.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
      <span className="relative text-right text-ink-400">${fmtCompact(l.px * l.sz)}</span>
    </div>
  );
  return (
    <div className="num">
      <div className="grid grid-cols-3 px-2 pb-1 text-[10px] uppercase tracking-wider text-ink-500">
        <span>Fiyat</span>
        <span className="text-right">Miktar</span>
        <span className="text-right">Tutar</span>
      </div>
      {[...a].reverse().map((l) => (
        <Row key={`a${l.px}`} l={l} side="ask" />
      ))}
      <div className="my-1 flex justify-between border-y border-ink-800 px-2 py-1 text-[11px] text-ink-400">
        <span>spread</span>
        <span className="text-ink-200">{spread !== null ? fmtPrice(spread) : "—"}</span>
      </div>
      {b.map((l) => (
        <Row key={`b${l.px}`} l={l} side="bid" />
      ))}
    </div>
  );
}
