"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { AgentRecordCard, ReactionCard } from "@/components/agent-record";
import { BatchPanel } from "@/components/batch-panel";
import { AccuracyTimeline, BaselineChart, CalibrationChart } from "@/components/charts";
import { Badge, Card, ConfidenceBar, DirPill, Empty, Pct, Stat, StatusPill, fmtTime, usePoll } from "@/components/ui";
import { EVENT_LABEL } from "@/lib/labels";
import type { Coverage, PredictionRow, Stats } from "@/lib/scorecard";

const RULE_LABEL: Record<string, string> = { momentum: "momentum", alwaysUp: "hep yükseliş", alwaysFlat: "hep yatay" };
const ABSTAIN_LABEL: Record<string, string> = {
  no_edge: "Taban orana göre yeterli avantaj yok (<5 puan)",
  contradiction: "Model kendisiyle çelişti (başka sonuç daha olası)",
  not_new_information: "Haber yeni bilgi değil (fiyat özeti / yorum)",
  not_called: "Ajan bu token ve ufuk için tahmin vermedi",
  no_price: "Borsa fiyatı alınamadı",
};

const pct =(x: number | null | undefined) => (x === null || x === undefined ? "—" : `%${Math.round(x * 100)}`);
const MODES = [
  { id: "", label: "Tümü" },
  { id: "live", label: "Canlı" },
  { id: "backtest", label: "Geriye dönük" },
];
const STATUS = [
  { id: "all", label: "Hepsi" },
  { id: "correct", label: "Doğru" },
  { id: "wrong", label: "Yanlış" },
  { id: "pending", label: "Bekleyen" },
];

export default function Karne() {
  const [mode, setMode] = useState("");
  const [status, setStatus] = useState("all");
  const { data, reload } = usePoll<{ stats: Stats; predictions: PredictionRow[]; timeline: { ts: number; cumulative: number; n: number }[]; coverage: Coverage }>(
    `/api/scorecard?evaluate=1${mode ? `&mode=${mode}` : ""}`,
    30000,
  );
  const onBatchFinished = useCallback(() => reload(), [reload]);
  const s = data?.stats;
  const cov = data?.coverage;
  const rows = (data?.predictions ?? []).filter((p) => status === "all" || p.status === status);
  const lowN = s ? s.n < 20 : true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Tahmin Karnesi</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-300">
            Her tahmin, sonuç belli olmadan önce kaydedilir ve ufku dolunca OKX TR fiyatıyla otomatik puanlanır. Tutmayanlar silinmez.
          </p>
        </div>
        <div className="flex rounded-lg bg-ink-900 p-1 ring-1 ring-ink-700">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${mode === m.id ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:text-ink-100"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {s && lowN && (
        <div className="rounded-xl border border-judge/30 bg-judge/10 px-4 py-3 text-sm text-judge">
          Örneklem küçük ({s.n} puanlanmış tahmin). 20&apos;nin altındaki örneklemde isabet oranı istatistiksel olarak anlamlı değildir; geriye dönük test ile örneklemi büyütebilirsiniz.
        </div>
      )}

      <BatchPanel onFinished={onBatchFinished} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="İsabet" value={pct(s?.accuracy)} hint={s ? `${s.correct} doğru / ${s.n}` : "…"} accent />
        <Stat
          label="Beceri · en iyi kurala göre"
          value={s?.skill?.vsBest != null ? `${s.skill.vsBest >= 0 ? "+" : ""}${Math.round(s.skill.vsBest * 100)} puan` : "—"}
          hint={s?.skill?.best ? `kıyas: ${RULE_LABEL[s.skill.best]} (${pct(s.baselines[s.skill.best])})` : "puanlanmış tahmin gerekiyor"}
        />
        <Stat
          label="Brier beceri skoru"
          value={s?.bss?.value != null ? s.bss.value.toFixed(2) : "—"}
          hint={s?.bss?.n ? `>0: taban orandan bilgili · n=${s.bss.n}` : "yeni kayıt kuralıyla gelen tahminlerde"}
        />
        <Stat
          label="Kapsama"
          value={cov?.rate != null ? pct(cov.rate) : "—"}
          hint={cov ? `${cov.predicted} tahmin · ${cov.abstained} çekimser` : "…"}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Brier skoru" value={s?.brier != null ? s.brier.toFixed(3) : "—"} hint="0 mükemmel · 0,25 yazı-tura" />
        <Stat label="Momentum kuralı" value={pct(s?.baselines.momentum)} hint="Son 1 saatin yönü devam eder" />
        <Stat label="Hep “yatay”" value={pct(s?.baselines.alwaysFlat)} hint="Hiçbir şey olmaz varsayımı" />
        <Stat label="Bekleyen" value={s?.pending ?? "—"} hint="Ufku dolmamış" />
      </div>

      {cov && cov.abstained > 0 && (
        <Card title="Neden çekimser kalındı?">
          <div className="space-y-2">
            {cov.byReason.map((r) => (
              <div key={r.code} className="grid grid-cols-[minmax(0,1fr)_120px_36px] items-center gap-3 text-[13px]">
                <span className="text-ink-200">{ABSTAIN_LABEL[r.code] ?? r.code}</span>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full rounded-full bg-judge" style={{ width: `${(r.n / cov.abstained) * 100}%` }} />
                </div>
                <span className="num text-right text-ink-400">{r.n}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-ink-400">
            Bir tahmin karneye ancak güveni kendi taban oranının en az 5 puan üstündeyse ve haber yeni bilgi içeriyorsa girer. Çekimser kalınan fırsatlar silinmez; kapsama oranında görünür.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Kalibrasyon — ajan ne kadar emin, ne kadar tutuyor?">
          {s && s.n > 0 ? (
            <>
              <CalibrationChart buckets={s.calibration} />
              <p className="mt-2 text-xs text-ink-400">Yeşil çizgi kesikli çizginin altındaysa ajan o güven aralığında fazla emin demektir. Bu bilgi her yeni analizde Strategy ajanına verilir.</p>
            </>
          ) : (
            <Empty>Puanlanmış tahmin olunca kalibrasyon grafiği burada görünecek.</Empty>
          )}
        </Card>
        <Card title="SignalMind basit kurallardan iyi mi?">
          {s && s.n > 0 ? (
            <>
              <BaselineChart
                rows={[
                  { name: "SignalMind", value: s.accuracy, highlight: true },
                  { name: "Momentum", value: s.baselines.momentum },
                  { name: "Hep yükseliş", value: s.baselines.alwaysUp },
                  { name: "Hep yatay", value: s.baselines.alwaysFlat },
                ]}
              />
              <p className="mt-2 text-xs text-ink-400">Basit kurallar aynı tahmin anlarında, aynı token ve ufuklarda puanlanır. Böylece kıyas birebir yapılır.</p>
            </>
          ) : (
            <Empty>Kıyas için puanlanmış tahmin gerekiyor.</Empty>
          )}
        </Card>
      </div>

      {data && data.timeline.length > 1 && (
        <Card title="Zaman içinde kümülatif isabet · tüm modlar">
          <AccuracyTimeline points={data.timeline} />
          <p className="mt-2 text-xs text-ink-400">Her nokta bir tahminin sonucunun belli olduğu an. Kesikli çizgi %50. Erken dönemdeki sıçramalar küçük örneklemden kaynaklanır.</p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AgentRecordCard />
        <ReactionCard />
      </div>

      {s && s.n > 0 && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Ufka göre">
            <ul className="space-y-2 text-sm">
              {s.byHorizon.map((h) => (
                <li key={h.horizon} className="flex justify-between">
                  <span className="text-ink-300">{h.horizon} saat</span>
                  <span className="num">
                    {pct(h.accuracy)} <span className="text-ink-500">n={h.n}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Olay tipine göre">
            <ul className="space-y-2 text-sm">
              {s.byEventType.map((e) => (
                <li key={e.eventType} className="flex justify-between">
                  <span className="text-ink-300">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                  <span className="num">
                    {pct(e.accuracy)} <span className="text-ink-500">n={e.n}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Tokene göre">
            <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
              {s.byToken.map((t) => (
                <li key={t.token} className="flex justify-between">
                  <Link href={`/token/${t.token}`} className="num text-ink-200 hover:text-signal">
                    {t.token}
                  </Link>
                  <span className="num">
                    {pct(t.accuracy)} <span className="text-ink-500">n={t.n}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card
        title="Tüm tahminler"
        action={
          <div className="flex gap-1">
            {STATUS.map((x) => (
              <button
                key={x.id}
                onClick={() => setStatus(x.id)}
                className={`rounded-md px-2.5 py-1 text-xs ${status === x.id ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty>Bu filtrede tahmin yok.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                <tr className="border-b border-ink-800">
                  <th className="py-2 pr-3 font-medium">Zaman</th>
                  <th className="py-2 pr-3 font-medium">Token</th>
                  <th className="py-2 pr-3 font-medium">Ufuk</th>
                  <th className="py-2 pr-3 font-medium">Tahmin</th>
                  <th className="py-2 pr-3 font-medium">Güven</th>
                  <th className="py-2 pr-3 font-medium">Gerçekleşen</th>
                  <th className="py-2 pr-3 font-medium">Sonuç</th>
                  <th className="py-2 font-medium">Mekanizma</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-ink-800/70 align-top">
                    <td className="py-2.5 pr-3 text-xs text-ink-400">
                      <Link href={`/analiz/${p.analysis_id}`} className="hover:text-ink-100">
                        {fmtTime(p.entry_ts)}
                      </Link>
                      {p.mode === "backtest" && (
                        <div>
                          <Badge tone="judge">geriye dönük</Badge>
                        </div>
                      )}
                    </td>
                    <td className="num py-2.5 pr-3 font-semibold">
                      <Link href={`/token/${p.token}`} className="hover:text-signal">
                        {p.token}
                      </Link>
                    </td>
                    <td className="num py-2.5 pr-3 text-ink-300">{p.horizon_h}s</td>
                    <td className="py-2.5 pr-3">
                      <DirPill dir={p.direction} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <ConfidenceBar value={p.confidence} />
                    </td>
                    <td className="py-2.5 pr-3">
                      {p.actual_dir ? (
                        <div className="flex items-center gap-2">
                          <DirPill dir={p.actual_dir} />
                          <Pct value={p.change_pct} className="text-xs" />
                        </div>
                      ) : (
                        <span className="text-xs text-ink-500">{fmtTime(p.entry_ts + p.horizon_h * 3600000)}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <StatusPill status={p.status} />
                    </td>
                    <td className="max-w-md py-2.5 text-xs text-ink-300">{p.mechanism}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
