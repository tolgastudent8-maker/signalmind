"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";
import type { EventStudy } from "@/lib/eventstudy";
import { Card, Empty, Pct, usePoll } from "./ui";

/** Dark-surface categorical slots, validated as a set against #0b0e14 (6 series max per analysis). */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const OFFS = [
  { m: 15, label: "+15 dk" },
  { m: 60, label: "+1 s" },
  { m: 240, label: "+4 s" },
  { m: 1440, label: "+24 s" },
];

/**
 * Width of an element that may mount later (after data arrives): a callback ref
 * re-runs the measurement whenever the node appears, unlike a ref read on mount.
 */
function useWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
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

const fmtM = (m: number) => (m === 0 ? "haber" : `${m > 0 ? "+" : "−"}${Math.abs(m) >= 60 ? `${(Math.abs(m) / 60).toFixed(Math.abs(m) % 60 ? 1 : 0)}s` : `${Math.abs(m)}dk`}`);

export function EventStudyCard({ analysisId, analysisAt }: { analysisId: string; analysisAt: number }) {
  const { data, error } = usePoll<EventStudy>(`/api/eventstudy?analysis=${analysisId}`, 300000);
  const [adjusted, setAdjusted] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth();

  const tokens = (data?.tokens ?? []).filter((t) => !(adjusted && t.symbol === "BTC"));
  const pts = tokens.flatMap((t) => t.path.map((p) => ({ m: p.m, v: adjusted ? p.adj : p.r }))).filter((p): p is { m: number; v: number } => p.v !== null);
  const H = 240;
  const L = 8;
  const R = 70; // room for end labels and the y axis
  const plotW = Math.max(0, width - L - R);
  const mMin = -120;
  const mMax = Math.max(60, ...pts.map((p) => p.m));
  const vLo = Math.min(0, ...pts.map((p) => p.v));
  const vHi = Math.max(0, ...pts.map((p) => p.v));
  const pad = (vHi - vLo) * 0.12 || 0.005;
  const x = (m: number) => L + ((m - mMin) / (mMax - mMin)) * plotW;
  const y = (v: number) => 8 + ((vHi + pad - v) / (vHi + pad - (vLo - pad))) * (H - 30);
  const analysisM = data ? Math.round((analysisAt - data.t0) / 60_000) : 0;
  const yTicks = [vLo - pad, 0, vHi + pad].map((v) => Math.round(v * 1000) / 1000);
  const xTicks = [-120, 0, 60, 240, 720, 1440].filter((m) => m <= mMax);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const m = mMin + ((e.clientX - r.left - L) / plotW) * (mMax - mMin);
    const all = [...new Set(tokens.flatMap((t) => t.path.map((p) => p.m)))].sort((a, b) => a - b);
    if (!all.length) return;
    setHover(all.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a)));
  }

  return (
    <Card
      title="Olay çalışması · haber sonrası gerçek fiyat yolu"
      action={
        <div className="flex rounded-lg bg-ink-900 p-0.5 ring-1 ring-ink-800">
          {[
            [false, "Ham getiri"],
            [true, "BTC'den arındırılmış"],
          ].map(([v, label]) => (
            <button
              key={String(v)}
              onClick={() => setAdjusted(v as boolean)}
              aria-pressed={adjusted === v}
              className={`rounded-md px-2 py-1 text-[11px] ${adjusted === v ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
            >
              {label as string}
            </button>
          ))}
        </div>
      }
    >
      {error ? (
        <Empty>{error}</Empty>
      ) : !data ? (
        <div className="shimmer h-60 rounded-xl bg-ink-850" />
      ) : tokens.length === 0 ? (
        <Empty>Bu analiz için fiyat yolu oluşturulamadı.</Empty>
      ) : (
        <>
          <div ref={ref} className="grid-bg rounded-lg">
            {width > 0 && (
              <svg width={width} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label="Haber anına göre normalize edilmiş fiyat yolları">
                {yTicks.map((v) => (
                  <g key={v}>
                    <line x1={L} x2={L + plotW} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#3a4458" : "#1a202b"} strokeDasharray={v === 0 ? "3 3" : undefined} />
                    {/* Y labels sit at the left, above their gridline; the right edge is reserved for series end labels. */}
                    <text x={L + 2} y={y(v) - 3} fontSize="10" fill="#8a94a8" className="num">
                      {v > 0 ? "+" : ""}
                      {(v * 100).toFixed(1)}%
                    </text>
                  </g>
                ))}
                {xTicks.map((m) => (
                  <text key={m} x={x(m)} y={H - 6} fontSize="10" fill="#8a94a8" textAnchor="middle" className="num">
                    {fmtM(m)}
                  </text>
                ))}
                <line x1={x(0)} x2={x(0)} y1={4} y2={H - 22} stroke="#e4e8ef" strokeOpacity={0.5} />
                {analysisM > 5 && analysisM <= mMax && (
                  <g>
                    <line x1={x(analysisM)} x2={x(analysisM)} y1={4} y2={H - 22} stroke="#c6f432" strokeOpacity={0.6} strokeDasharray="4 3" />
                    <text x={x(analysisM) + 4} y={14} fontSize="10" fill="#c6f432">
                      analiz
                    </text>
                  </g>
                )}
                {(() => {
                  const lines = tokens
                    .map((t, i) => {
                      const path = t.path
                        .map((p) => ({ m: p.m, v: adjusted ? p.adj : p.r }))
                        .filter((p): p is { m: number; v: number } => p.v !== null);
                      return { t, path, color: t.symbol === "BTC" ? "#8a94a8" : SERIES[i % SERIES.length] };
                    })
                    .filter((l) => l.path.length);
                  // End labels: keep at least 12px between them so close finishes stay readable.
                  const labels = lines
                    .map((l) => ({ sym: l.t.symbol, x: x(l.path[l.path.length - 1].m) + 4, y: y(l.path[l.path.length - 1].v) + 3.5 }))
                    .sort((a, b) => a.y - b.y);
                  for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 13) labels[k].y = labels[k - 1].y + 13;
                  return (
                    <>
                      {lines.map((l) => (
                        <path
                          key={l.t.symbol}
                          d={l.path.map((p, k) => `${k ? "L" : "M"}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join("")}
                          fill="none"
                          stroke={l.color}
                          strokeWidth={2}
                          strokeDasharray={l.t.symbol === "BTC" ? "5 3" : undefined}
                        />
                      ))}
                      {labels.map((lb) => (
                        <text key={lb.sym} x={lb.x} y={lb.y} fontSize="10.5" fontWeight={600} fill="#e4e8ef" className="num">
                          {lb.sym}
                        </text>
                      ))}
                    </>
                  );
                })()}
                {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={4} y2={H - 22} stroke="#8a94a8" strokeOpacity={0.6} />}
              </svg>
            )}
          </div>

          <div className="num mt-2 flex min-h-[20px] flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {hover !== null ? (
              <>
                <span className="text-ink-400">{fmtM(hover)}</span>
                {tokens.map((t, i) => {
                  const p = t.path.find((q) => q.m === hover);
                  const v = p ? (adjusted ? p.adj : p.r) : null;
                  return (
                    <span key={t.symbol} className="flex items-center gap-1.5 text-ink-300">
                      <span className="h-0.5 w-3 rounded" style={{ background: t.symbol === "BTC" ? "#8a94a8" : SERIES[i % SERIES.length] }} />
                      {t.symbol} <Pct value={v} />
                    </span>
                  );
                })}
              </>
            ) : (
              tokens.map((t, i) => (
                <span key={t.symbol} className="flex items-center gap-1.5 text-ink-400">
                  <span className="h-0.5 w-3 rounded" style={{ background: t.symbol === "BTC" ? "#8a94a8" : SERIES[i % SERIES.length] }} />
                  {t.symbol}
                </span>
              ))
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="num w-full min-w-[520px] text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-ink-500">
                <tr className="border-b border-ink-800">
                  <th className="py-1.5 text-left font-medium">Token</th>
                  {OFFS.map((o) => (
                    <th key={o.m} className="py-1.5 text-right font-medium">
                      {o.label}
                    </th>
                  ))}
                  <th className="py-1.5 text-right font-medium">En büyük hareket</th>
                </tr>
              </thead>
              <tbody>
                {(data.tokens ?? []).map((t) => (
                  <tr key={t.symbol} className="border-b border-ink-800/60">
                    <td className="py-1.5">
                      <Link href={`/token/${t.symbol}`} className="font-semibold text-ink-100 hover:text-signal">
                        {t.symbol}
                      </Link>
                    </td>
                    {OFFS.map((o) => (
                      <td key={o.m} className="py-1.5 text-right">
                        <Pct value={adjusted ? t.adjAt[o.m] : t.at[o.m]} />
                      </td>
                    ))}
                    <td className="py-1.5 text-right text-ink-300">{t.peak ? <><Pct value={t.peak.r} /> · {fmtM(t.peak.m)}</> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-500">
            Fiyatlar haber anındaki fiyata (yayından sonraki ilk 1 dk mumun açılışı) göre 15 dakikalık mumlarla normalize edilir. Arındırılmış görünümde BTC&apos;nin aynı aralıktaki hareketi çıkarılır, böylece tokene özgü tepki görünür.
            {data.complete ? "" : " 24 saatlik pencere dolana kadar güncellenir."}
          </p>
        </>
      )}
    </Card>
  );
}
