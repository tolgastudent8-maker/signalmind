"use client";

import Link from "next/link";
import { useState } from "react";
import type { PremiumPoint, TurkeySnapshot } from "@/lib/turkey";
import { Card, usePoll } from "./ui";

export type TurkeyData = { snapshot: TurkeySnapshot; history: PremiumPoint[]; liquidTryVol: number };

export const fmtPrem = (x: number | null | undefined, digits = 2) =>
  x === null || x === undefined ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
const tone = (x: number | null | undefined) => (x === null || x === undefined ? "text-ink-300" : x > 0.0005 ? "text-up" : x < -0.0005 ? "text-down" : "text-ink-200");

/** Two premium series on one shared % axis (same unit), with hover readout. */
function PremiumHistory({ points }: { points: PremiumPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 90;
  const series = [
    { key: "usdt_premium" as const, label: "USDT primi", color: "#7aa7ff" },
    { key: "basket_premium" as const, label: "Sepet primi", color: "#c6f432" },
  ];
  const vals = points.flatMap((p) => series.map((s) => p[s.key])).filter((v): v is number => v !== null);
  if (points.length < 2 || !vals.length) {
    return <p className="text-[11px] text-ink-500">Geçmiş birikiyor: arka plan döngüsü 5 dakikada bir kayıt alır ({points.length} kayıt).</p>;
  }
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.15 || 0.0005;
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const x = (ts: number) => ((ts - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * H;
  const path = (k: (typeof series)[number]["key"]) =>
    points
      .filter((p) => p[k] !== null)
      .map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)},${y(p[k]!).toFixed(1)}`)
      .join("");
  const hp = hover !== null ? points[hover] : points[points.length - 1];

  return (
    <div>
      <div className="num mb-1 flex flex-wrap gap-3 text-[11px]">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-ink-400">
            <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
            {s.label} <span className="text-ink-100">{fmtPrem(hp[s.key], 3)}</span>
          </span>
        ))}
        <span className="ml-auto text-ink-500">{new Date(hp.ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[90px] w-full"
        preserveAspectRatio="none"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const ts = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
          let best = 0;
          points.forEach((p, i) => (Math.abs(p.ts - ts) < Math.abs(points[best].ts - ts) ? (best = i) : null));
          setHover(best);
        }}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="USDT ve sepet priminin zaman içindeki seyri"
      >
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#2a3243" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        {series.map((s) => (
          <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
        {hover !== null && <line x1={x(hp.ts)} x2={x(hp.ts)} y1={0} y2={H} stroke="#8a94a8" opacity={0.5} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

export function TurkeyCard() {
  const { data } = usePoll<TurkeyData>("/api/turkey?hours=48", 60000);
  const s = data?.snapshot;
  const liquid = (s?.tokens ?? []).filter((t) => t.liquid);
  const top = [...liquid].sort((a, b) => b.premium - a.premium).slice(0, 3);
  const bottom = [...liquid].sort((a, b) => a.premium - b.premium).slice(0, 3);

  return (
    <Card title="Türkiye primi · OKX TR" action={<span className="num text-[11px] text-ink-500">TRY ↔ USDT</span>}>
      {!s ? (
        <div className="shimmer h-32 rounded-xl bg-ink-850" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-ink-900/70 p-3 ring-1 ring-ink-800">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">USDT primi</div>
              <div className={`num mt-1 text-xl ${tone(s.usdtPremium)}`}>{fmtPrem(s.usdtPremium, 3)}</div>
              <div className="num text-[11px] text-ink-400">
                USDT/TRY {s.usdtTry.toFixed(3)} · TCMB {s.tcmb ? s.tcmb.mid.toFixed(3) : "—"}
              </div>
            </div>
            <div className="rounded-lg bg-ink-900/70 p-3 ring-1 ring-ink-800">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">Sepet primi</div>
              <div className={`num mt-1 text-xl ${tone(s.basketPremium)}`}>{fmtPrem(s.basketPremium, 3)}</div>
              <div className="num text-[11px] text-ink-400">{liquid.length} likit TRY paritesi · hacim ağırlıklı</div>
            </div>
          </div>
          <div className="mt-3">
            <PremiumHistory points={data!.history} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 border-t border-ink-800 pt-3 text-[12px]">
            {[
              ["En primli", top],
              ["En iskontolu", bottom],
            ].map(([label, list]) => (
              <div key={label as string}>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{label as string}</div>
                {(list as typeof top).map((t) => (
                  <Link key={t.symbol} href={`/token/${t.symbol}`} className="num flex justify-between py-0.5 hover:text-signal">
                    <span className="text-ink-200">{t.symbol}</span>
                    <span className={tone(t.premium)}>{fmtPrem(t.premium, 3)}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            Prim = TRY fiyatı ÷ (USDT fiyatı × USDT/TRY) − 1, alış/satış ortasıyla. USDT primi resmî kura göre kripto dolar talebini gösterir. Canlı analizlerde ajanlara verilir.
          </p>
        </>
      )}
    </Card>
  );
}
