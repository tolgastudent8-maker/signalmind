"use client";

import Link from "next/link";
import { fmtPrice, usePoll } from "./ui";
import type { UniverseToken } from "@/lib/market";

function useUniverse() {
  return usePoll<{ tokens: UniverseToken[] }>("/api/universe", 30000);
}

/** Scrolling price strip of the most traded OKX TR tokens. */
export function TickerTape() {
  const { data } = useUniverse();
  const tokens = (data?.tokens ?? []).slice(0, 28);
  if (!tokens.length) return <div className="h-8 border-b hairline bg-ink-950" />;
  const row = (copy: string) =>
    tokens.map((t) => (
    <Link key={`${t.symbol}-${copy}`} href={`/token/${t.symbol}`} tabIndex={copy === "b" ? -1 : undefined} className="flex shrink-0 items-center gap-2 px-4 text-[11px] hover:bg-ink-850">
      <span className="num font-semibold text-ink-200">{t.symbol}</span>
      <span className="num text-ink-400">{fmtPrice(t.last)}</span>
      <span className={`num ${t.change24h >= 0 ? "text-up" : "text-down"}`}>
        {t.change24h >= 0 ? "▲" : "▼"} {Math.abs(t.change24h * 100).toFixed(2)}%
      </span>
    </Link>
    ));
  return (
    <div className="ticker group relative flex h-8 items-center overflow-hidden border-b hairline bg-ink-950">
      {/* Two identical copies make the -50% translate loop seamless. */}
      <div className="ticker-track flex">
        {row("a")}
        <div className="flex" aria-hidden>
          {row("b")}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-ink-950 to-transparent" />
    </div>
  );
}

function heatColor(change: number): string {
  // ±8% saturates; green for up, red for down, on the ink background.
  const k = Math.min(1, Math.abs(change) / 0.08);
  const alpha = 0.12 + 0.6 * k;
  return change >= 0 ? `rgba(47, 214, 138, ${alpha})` : `rgba(255, 92, 108, ${alpha})`;
}

/** 24h change heatmap of the most liquid tokens; tile area grows with volume rank. */
export function Heatmap({ count = 24 }: { count?: number }) {
  const { data } = useUniverse();
  const tokens = (data?.tokens ?? []).slice(0, count);
  if (!tokens.length) return <div className="shimmer h-48 rounded-xl bg-ink-850" />;
  return (
    <div className="grid grid-flow-dense grid-cols-4 gap-1 sm:grid-cols-6">
      {tokens.map((t, i) => (
        <Link
          key={t.symbol}
          href={`/token/${t.symbol}`}
          title={`${t.symbol} · $${fmtPrice(t.last)} · 24s hacim $${(t.volUsd24h / 1e6).toFixed(1)}M`}
          className={`flex flex-col justify-between rounded-md p-2 ring-1 ring-inset ring-black/20 transition hover:brightness-125 ${
            i < 2 ? "col-span-2 row-span-2 min-h-[92px]" : i < 6 ? "col-span-2 min-h-[44px]" : "min-h-[44px]"
          }`}
          style={{ background: heatColor(t.change24h) }}
        >
          <span className={`num font-semibold text-ink-100 ${i < 2 ? "text-lg" : "text-[11px]"}`}>{t.symbol}</span>
          <span className={`num text-ink-100/90 ${i < 2 ? "text-sm" : "text-[10px]"}`}>
            {t.change24h >= 0 ? "+" : ""}
            {(t.change24h * 100).toFixed(1)}%
          </span>
        </Link>
      ))}
    </div>
  );
}
