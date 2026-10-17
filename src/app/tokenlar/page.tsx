"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type TurkeyData, fmtPrem } from "@/components/turkey-card";
import { Card, Empty, Pct, fmtPrice, usePoll } from "@/components/ui";
import type { UniverseToken } from "@/lib/market";

const SORTS = [
  { id: "vol", label: "Hacim" },
  { id: "chg", label: "24s değişim" },
  { id: "prem", label: "TR primi ↓" },
  { id: "disc", label: "TR primi ↑" },
] as const;
type Sort = (typeof SORTS)[number]["id"];

export default function Tokenlar() {
  const { data, error } = usePoll<{ tokens: UniverseToken[] }>("/api/universe", 60000);
  const tr = usePoll<TurkeyData>("/api/turkey?hours=1", 60000);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("vol");

  const prem = useMemo(() => new Map((tr.data?.snapshot.tokens ?? []).map((t) => [t.symbol, t])), [tr.data]);
  const tokens = useMemo(() => {
    const list = (data?.tokens ?? []).filter((t) => t.symbol.toLowerCase().includes(q.toLowerCase()));
    const p = (s: string) => prem.get(s)?.premium ?? 0;
    const liquidFirst = (a: UniverseToken, b: UniverseToken) => Number(prem.get(b.symbol)?.liquid ?? false) - Number(prem.get(a.symbol)?.liquid ?? false);
    if (sort === "chg") return [...list].sort((a, b) => b.change24h - a.change24h);
    if (sort === "prem") return [...list].sort((a, b) => liquidFirst(a, b) || p(b.symbol) - p(a.symbol));
    if (sort === "disc") return [...list].sort((a, b) => liquidFirst(a, b) || p(a.symbol) - p(b.symbol));
    return list;
  }, [data, q, sort, prem]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">OKX TR token evreni</h1>
        <p className="mt-1 text-sm text-ink-300">
          TRY paritesiyle OKX TR&apos;de işlem gören tokenlar. Fiyatlar ATK MCP üzerinden USDT paritesinden alınır; TR primi, TRY paritesinin küresel fiyata göre farkıdır. Impact Radar yalnızca bu
          listeden seçim yapar.
        </p>
      </div>
      <Card
        title={data ? `${data.tokens.length} token` : "Yükleniyor"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-ink-900 p-0.5 ring-1 ring-ink-800">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className={`rounded-md px-2 py-1 text-[11px] ${sort === s.id ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Sembol ara"
              className="w-36 rounded-lg bg-ink-900 px-3 py-1.5 text-sm outline-none ring-1 ring-ink-700 focus:ring-ink-500"
            />
          </div>
        }
      >
        {error ? (
          <Empty>{error}</Empty>
        ) : !data ? (
          <div className="shimmer h-64 rounded-xl bg-ink-850" />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {tokens.map((t) => {
              const p = prem.get(t.symbol);
              return (
                <Link key={t.symbol} href={`/token/${t.symbol}`} className="rounded-xl bg-ink-900/60 p-3 ring-1 ring-ink-800 transition hover:bg-ink-850 hover:ring-ink-600">
                  <div className="flex items-center justify-between">
                    <span className="num font-semibold text-ink-100">{t.symbol}</span>
                    <Pct value={t.change24h} className="text-xs" />
                  </div>
                  <div className="num mt-1 text-sm text-ink-300">${fmtPrice(t.last)}</div>
                  <div className="num flex justify-between text-[11px] text-ink-500">
                    <span>${(t.volUsd24h / 1e6).toFixed(1)}M</span>
                    {p && (
                      <span className={p.liquid ? (p.premium > 0.0005 ? "text-up" : p.premium < -0.0005 ? "text-down" : "text-ink-300") : "text-ink-600"} title={p.liquid ? "TR primi" : "TR primi · sığ TRY paritesi"}>
                        TR {fmtPrem(p.premium, 2)}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
