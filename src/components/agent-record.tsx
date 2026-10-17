"use client";

import type { AgentRecord, Score } from "@/lib/agent-record";
import type { ReactionGroup } from "@/lib/eventstudy";
import { EVENT_LABEL, INFO_LABEL } from "@/lib/labels";
import { Card, Empty, usePoll } from "./ui";

type Data = { record: AgentRecord; reaction: { byInfo: ReactionGroup[]; byEvent: ReactionGroup[]; analyses: number } };

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `%${Math.round(x * 100)}`);

function ScoreCell({ s }: { s: Score }) {
  return (
    <td className="py-2 pl-3">
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-800">
          <div className="h-full rounded-full bg-signal" style={{ width: `${(s.rate ?? 0) * 100}%` }} />
        </div>
        <span className="num text-ink-100">{pct(s.rate)}</span>
        <span className="num text-[10px] text-ink-500">n={s.n}</span>
      </div>
    </td>
  );
}

function SideBar({ s }: { s: { bull: number; bear: number; flat: number } }) {
  const total = s.bull + s.bear + s.flat;
  if (!total) return <span className="text-[11px] text-ink-500">veri yok</span>;
  const seg = [
    { k: "bull", n: s.bull, c: "bg-bull", label: "boğa" },
    { k: "flat", n: s.flat, c: "bg-ink-500", label: "yatay" },
    { k: "bear", n: s.bear, c: "bg-bear", label: "ayı" },
  ];
  return (
    <div>
      {/* 2px surface gaps between segments; labels carry identity, not colour alone. */}
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {seg.map((x) => (x.n ? <div key={x.k} className={x.c} style={{ width: `${(x.n / total) * 100}%` }} /> : null))}
      </div>
      <div className="num mt-1 flex justify-between text-[10.5px] text-ink-400">
        {seg.map((x) => (
          <span key={x.k}>
            {x.label} {x.n}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AgentRecordCard() {
  const { data } = usePoll<Data>("/api/agentrecord", 120000);
  const r = data?.record;
  return (
    <Card title="Ajan sicili · hangi ajan haklı çıktı?">
      {!r ? (
        <div className="shimmer h-40 rounded-xl bg-ink-850" />
      ) : r.studied === 0 ? (
        <Empty>Tamamlanmış analizlerin fiyat yolu oluştukça burada her ajanın kendi isabeti görünür.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto"><table className="w-full min-w-[330px] text-[13px]">
            <thead className="text-[10px] uppercase tracking-wider text-ink-500">
              <tr className="border-b border-ink-800">
                <th className="py-1.5 text-left font-medium">Ajan · neyi ölçüyoruz</th>
                <th className="py-1.5 pl-3 text-left font-medium">1 saat</th>
                <th className="py-1.5 pl-3 text-left font-medium">24 saat</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-ink-800/60">
                <td className="py-2">
                  <div className="text-ink-100">Impact Radar</div>
                  <div className="text-[11px] text-ink-500">her tokene verdiği yön</div>
                </td>
                <ScoreCell s={r.impact["1h"]} />
                <ScoreCell s={r.impact["24h"]} />
              </tr>
              <tr className="border-b border-ink-800/60">
                <td className="py-2">
                  <div className="text-ink-100">Hakem</div>
                  <div className="text-[11px] text-ink-500">kazanan taraf → ana token yönü</div>
                </td>
                <ScoreCell s={r.judge["1h"]} />
                <ScoreCell s={r.judge["24h"]} />
              </tr>
            </tbody>
          </table></div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(["1h", "24h"] as const).map((k) => (
              <div key={k}>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">Fiyat hangi tezi doğruladı · {k === "1h" ? "1 saat" : "24 saat"}</div>
                <SideBar s={r.sides[k]} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-ink-500">
            {r.studied}/{r.analyses} analizin fiyat yolu hesaplandı. Ölçüm, karnedeki yatay bandı (1 s ±%0,4 · 24 s ±%1,5) kullanır. Strategy ajanının sicili karnenin kendisidir.
          </p>
        </>
      )}
    </Card>
  );
}

export function ReactionCard() {
  const { data } = usePoll<Data>("/api/agentrecord", 120000);
  const rx = data?.reaction;
  const rows = (list: ReactionGroup[], label: (k: string) => string) => {
    const max = Math.max(0.0001, ...list.map((g) => g.mean1h ?? 0), ...list.map((g) => g.mean24h ?? 0));
    return list.map((g) => (
      <tr key={g.key} className="border-b border-ink-800/60">
        <td className="py-1.5 text-ink-200">{label(g.key)}</td>
        {[g.mean1h, g.mean24h].map((v, i) => (
          <td key={i} className="py-1.5 pl-3">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-800">
                <div className="h-full rounded-full bg-atk" style={{ width: `${((v ?? 0) / max) * 100}%` }} />
              </div>
              <span className="num text-ink-100">{v === null ? "—" : `%${(v * 100).toFixed(2)}`}</span>
            </div>
          </td>
        ))}
        <td className="num py-1.5 pl-3 text-right text-ink-500">{g.n}</td>
      </tr>
    ));
  };
  return (
    <Card title="Haber türüne göre fiyat tepkisi">
      {!rx ? (
        <div className="shimmer h-40 rounded-xl bg-ink-850" />
      ) : rx.byInfo.length === 0 ? (
        <Empty>Olay çalışması verisi oluştukça haber türlerinin ortalama fiyat tepkisi burada görünür.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto"><table className="w-full min-w-[330px] text-[13px]">
            <thead className="text-[10px] uppercase tracking-wider text-ink-500">
              <tr className="border-b border-ink-800">
                <th className="py-1.5 text-left font-medium">Haber türü</th>
                <th className="py-1.5 pl-3 text-left font-medium">|hareket| 1 s</th>
                <th className="py-1.5 pl-3 text-left font-medium">|hareket| 24 s</th>
                <th className="py-1.5 pl-3 text-right font-medium">n</th>
              </tr>
            </thead>
            <tbody>{rows(rx.byInfo, (k) => INFO_LABEL[k] ?? "Sınıflandırılmamış")}</tbody>
          </table></div>
          {rx.byEvent.length > 0 && (
            <div className="overflow-x-auto mt-4"><table className="w-full min-w-[330px] text-[13px]">
              <thead className="text-[10px] uppercase tracking-wider text-ink-500">
                <tr className="border-b border-ink-800">
                  <th className="py-1.5 text-left font-medium">Olay tipi</th>
                  <th className="py-1.5 pl-3 text-left font-medium">1 s</th>
                  <th className="py-1.5 pl-3 text-left font-medium">24 s</th>
                  <th className="py-1.5 pl-3 text-right font-medium">n</th>
                </tr>
              </thead>
              <tbody>{rows(rx.byEvent, (k) => EVENT_LABEL[k] ?? k)}</tbody>
            </table></div>
          )}
          <p className="mt-3 text-[11px] text-ink-500">
            BTC&apos;den arındırılmış ortalama mutlak hareket, etkilenen tokenler üzerinden (BTC hariç). Yeni bilgi içeren haberlerin fiyat özetlerinden daha çok hareket ettirip ettirmediğini ölçer;
            karne kuralının dayanağı budur.
          </p>
        </>
      )}
    </Card>
  );
}
