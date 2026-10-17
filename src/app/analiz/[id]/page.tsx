"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RawOutputs, Waterfall } from "@/components/waterfall";
import { EventStudyCard } from "@/components/event-study";
import { use, useEffect, useState } from "react";
import { Badge, Card, ConfidenceBar, DirPill, Empty, Pct, StatusPill, fmtPrice, fmtTime, timeAgo, usePoll } from "@/components/ui";
import { AGENTS, EVENT_LABEL, INFO_LABEL, LEVEL_LABEL, NOVELTY_LABEL, PRICED_LABEL, RELATION_LABEL, WINNER_LABEL } from "@/lib/labels";
import type { AnalysisDetail, EventRow } from "@/lib/queries";
import type { Case, Impact, NewsAnalysis, Strategy, Verdict } from "@/lib/agents/schemas";
import type { TokenSnapshot } from "@/lib/agents/pipeline";
import type { ToolCallLog } from "@/lib/agents/llm";

type AgentState = "waiting" | "running" | "done" | "error";

function agentStates(events: EventRow[], status: string): Record<string, AgentState> {
  const st: Record<string, AgentState> = Object.fromEntries(AGENTS.map((a) => [a.id, "waiting" as AgentState]));
  for (const e of events) {
    if (!(e.agent in st)) continue;
    if (e.kind === "start") st[e.agent] = "running";
    if (e.kind === "done") st[e.agent] = "done";
  }
  if (status === "error") for (const k of Object.keys(st)) if (st[k] === "running") st[k] = "error";
  return st;
}

function donePayload<T>(events: EventRow[], agent: string): T | null {
  const e = [...events].reverse().find((x) => x.agent === agent && x.kind === "done");
  return (e?.payload as T) ?? null;
}

function Elapsed({ from, to }: { from: number; to: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (to) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [to]);
  return <span className="num">{(((to ?? now) - from) / 1000).toFixed(1)} sn</span>;
}

function Pipeline({ states }: { states: Record<string, AgentState> }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {AGENTS.map((a, i) => {
        const s = states[a.id];
        return (
          <div
            key={a.id}
            className={`relative rounded-xl px-3 py-2.5 ring-1 transition ${
              s === "done" ? "bg-ink-850 ring-ink-600" : s === "running" ? "bg-ink-800 ring-signal/60" : s === "error" ? "bg-down/10 ring-down/40" : "bg-ink-900 ring-ink-800"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${s === "running" ? "pulse-ring" : ""}`}
                style={{ background: s === "waiting" ? "var(--color-ink-600)" : s === "error" ? "var(--color-down)" : a.color }}
              />
              <span className="num text-[10px] text-ink-400">0{i + 1}</span>
            </div>
            <div className={`mt-1 text-[13px] font-medium ${s === "waiting" ? "text-ink-400" : "text-ink-100"}`}>{a.name}</div>
            <div className="text-[11px] text-ink-400">{s === "done" ? "tamamlandı" : s === "running" ? "çalışıyor…" : s === "error" ? "hata" : "sırada"}</div>
          </div>
        );
      })}
    </div>
  );
}

function Trace({ events, start }: { events: EventRow[]; start: number }) {
  const color = (agent: string, kind: string) =>
    kind === "error" ? "var(--color-down)" : kind === "tool" ? "var(--color-atk)" : (AGENTS.find((a) => a.id === agent)?.color ?? "var(--color-ink-400)");
  return (
    <ol className="relative space-y-2.5 border-l border-ink-700 pl-4">
      {events.map((e) => {
        const tool = e.kind === "tool" ? (e.payload as ToolCallLog) : null;
        return (
          <li key={e.id} className="rise relative">
            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-ink-900" style={{ background: color(e.agent, e.kind) }} />
            <div className="flex items-baseline gap-2 text-[11px] text-ink-400">
              <span className="num">+{((e.ts - start) / 1000).toFixed(1)}s</span>
              <span className="uppercase tracking-wider">{AGENTS.find((a) => a.id === e.agent)?.short ?? "Sistem"}</span>
            </div>
            <div className={`text-[13px] leading-snug ${e.kind === "error" ? "text-down" : tool ? "text-atk" : "text-ink-200"}`}>{e.title}</div>
            {tool && (
              <div className="mt-1 rounded-md bg-ink-950/70 px-2 py-1.5 text-[11px] ring-1 ring-ink-800">
                <div className="num truncate text-ink-300">{JSON.stringify(tool.input)}</div>
                <div className="num mt-0.5 line-clamp-2 break-all text-ink-500">
                  {tool.ok ? "✓" : "✗"} {tool.ms}ms · {tool.preview}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function NewsCard({ n }: { n: NewsAnalysis }) {
  const cred = Math.round(n.credibility_score);
  return (
    <Card title="01 · News Analyst">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <Badge tone="signal">{EVENT_LABEL[n.event_type] ?? n.event_type}</Badge>
        {n.information_type && (
          <Badge tone={n.information_type === "new_information" ? "up" : "judge"}>{INFO_LABEL[n.information_type] ?? n.information_type}</Badge>
        )}
        <Badge>Önem: {LEVEL_LABEL[n.materiality]}</Badge>
        <Badge>{NOVELTY_LABEL[n.novelty]}</Badge>
      </div>
      <p className="font-display text-lg font-medium leading-snug text-ink-100">{n.headline}</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-300">{n.summary}</p>
      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Güvenilirlik</div>
          <div className="mt-1 flex items-end gap-1">
            <span className={`font-display text-4xl font-semibold ${cred >= 70 ? "text-up" : cred >= 45 ? "text-judge" : "text-down"}`}>{cred}</span>
            <span className="mb-1.5 text-sm text-ink-400">/100</span>
          </div>
          <ul className="mt-2 space-y-1 text-xs text-ink-300">
            {n.credibility_reasons.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Olgular</div>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-200">
            {n.key_facts.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-up">●</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Açık sorular</div>
          <ul className="mt-2 space-y-1.5 text-[13px] text-ink-200">
            {n.open_questions.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-judge">?</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function ImpactCard({ impact, snaps }: { impact: Impact; snaps: TokenSnapshot[] | null }) {
  const snapBy = new Map((snaps ?? []).map((s) => [s.symbol, s]));
  return (
    <Card title="02 · Impact Radar">
      <p className="mb-4 text-sm text-ink-300">{impact.market_wide_note}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {impact.impacts.map((i) => {
          const s = snapBy.get(i.token);
          return (
            <div key={i.token} className="rounded-xl bg-ink-900/70 p-4 ring-1 ring-ink-700">
              <div className="flex items-center gap-2">
                <Link href={`/token/${i.token}`} className="num text-lg font-semibold text-ink-100 hover:text-signal">
                  {i.token}
                </Link>
                <Badge>{RELATION_LABEL[i.relation]}</Badge>
                <span className="ml-auto">
                  <DirPill dir={i.direction} />
                </span>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-ink-400">
                <span>Güç: {LEVEL_LABEL[i.strength]}</span>
                <ConfidenceBar value={i.confidence / 100} />
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-200">{i.mechanism}</p>
              {i.evidence.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-ink-400">
                  {i.evidence.map((e, k) => (
                    <li key={k}>↳ {e}</li>
                  ))}
                </ul>
              )}
              {s && (
                <div className="mt-3 grid grid-cols-4 gap-2 border-t border-ink-800 pt-3 text-[11px]">
                  <div>
                    <div className="text-ink-500">Fiyat</div>
                    <div className="num text-ink-100">{fmtPrice(s.price)}</div>
                  </div>
                  <div>
                    <div className="text-ink-500">1 saat</div>
                    <Pct value={s.ret1h} />
                  </div>
                  <div>
                    <div className="text-ink-500">24 saat</div>
                    <Pct value={s.ret24h} />
                  </div>
                  <div>
                    <div className="text-ink-500">Haberden beri</div>
                    <Pct value={s.moveSinceNews} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CaseColumn({ c, side }: { c: Case; side: "bull" | "bear" }) {
  const color = side === "bull" ? "text-bull" : "text-bear";
  return (
    <div className={`rounded-xl p-4 ring-1 ${side === "bull" ? "bg-up/[0.04] ring-up/20" : "bg-down/[0.04] ring-down/20"}`}>
      <div className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${color}`}>{side === "bull" ? "▲ Boğa tezi" : "▼ Ayı tezi"}</div>
      <p className="mt-1.5 font-display text-[15px] font-medium leading-snug text-ink-100">{c.thesis}</p>
      <ul className="mt-3 space-y-2.5">
        {c.arguments.map((a, i) => (
          <li key={i} className="text-[13px]">
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 rounded px-1 text-[10px] font-semibold ${a.strength === "high" ? "bg-ink-100 text-ink-950" : a.strength === "medium" ? "bg-ink-600 text-ink-100" : "bg-ink-800 text-ink-400"}`}>
                {LEVEL_LABEL[a.strength]}
              </span>
              <div>
                <div className="text-ink-100">{a.claim}</div>
                <div className="text-xs text-ink-400">Kanıt: {a.evidence}</div>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-ink-800 pt-2.5 text-xs text-ink-400">
        <span className="text-ink-300">Çürütülür, eğer:</span> {c.invalidation}
      </div>
    </div>
  );
}

function DebateCard({ bull, bear, verdict }: { bull: Case | null; bear: Case | null; verdict: Verdict | null }) {
  const total = verdict ? Math.max(1, verdict.bull_score + verdict.bear_score) : 1;
  return (
    <Card title="03 · Bull vs Bear · Hakem">
      <div className="grid gap-3 md:grid-cols-2">
        {bull ? <CaseColumn c={bull} side="bull" /> : <div className="shimmer h-40 rounded-xl bg-ink-850" />}
        {bear ? <CaseColumn c={bear} side="bear" /> : <div className="shimmer h-40 rounded-xl bg-ink-850" />}
      </div>
      {verdict ? (
        <div className="mt-4 rounded-xl bg-judge/[0.05] p-4 ring-1 ring-judge/25">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-judge">⚖ Hakem kararı</span>
            <Badge tone={verdict.winner === "bull" ? "up" : verdict.winner === "bear" ? "down" : "judge"}>{WINNER_LABEL[verdict.winner]}</Badge>
          </div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink-800">
            <div className="bg-bull" style={{ width: `${(verdict.bull_score / total) * 100}%` }} />
            <div className="bg-bear" style={{ width: `${(verdict.bear_score / total) * 100}%` }} />
          </div>
          <div className="num mt-1 flex justify-between text-[11px]">
            <span className="text-bull">Boğa {Math.round(verdict.bull_score)}</span>
            <span className="text-bear">Ayı {Math.round(verdict.bear_score)}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-ink-200">{verdict.reasoning}</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Belirleyici noktalar</div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-200">
                {verdict.decisive_points.map((p, i) => (
                  <li key={i}>· {p}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Zayıf argümanlar</div>
              <ul className="mt-1.5 space-y-1 text-[13px] text-ink-300">
                {verdict.weak_points.map((p, i) => (
                  <li key={i}>· {p}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        bull && bear && <div className="shimmer mt-4 h-24 rounded-xl bg-ink-850" />
      )}
    </Card>
  );
}

function BaseCell({ snap, horizon, dir, confidence }: { snap?: TokenSnapshot; horizon: "1h" | "24h"; dir: string; confidence: number }) {
  const base = horizon === "1h" ? snap?.base1h : snap?.base24h;
  if (!base) return <span className="text-xs text-ink-500">—</span>;
  const p = Math.round((dir === "up" ? base.up : dir === "down" ? base.down : base.flat) * 100);
  const edge = Math.round(confidence) - p;
  return (
    <div className="text-xs">
      <span className="num text-ink-300">%{p}</span>
      <div className={`num text-[11px] ${edge > 15 ? "text-judge" : edge >= 0 ? "text-ink-400" : "text-ink-500"}`}>
        {edge >= 0 ? "+" : ""}
        {edge} puan
      </div>
    </div>
  );
}

function StrategyCard({ s, a, snaps }: { s: Strategy; a: AnalysisDetail; snaps: TokenSnapshot[] | null }) {
  const predBy = new Map(a.predictions.map((p) => [`${p.token}:${p.horizon_h}`, p]));
  const abstBy = new Map((a.abstentions ?? []).map((x) => [`${x.token}:${x.horizon_h}`, x]));
  const snapBy = new Map((snaps ?? []).map((x) => [x.symbol, x]));
  const notCalled = (a.abstentions ?? []).filter((x) => x.reason_code === "not_called");
  return (
    <Card title="04 · Strategy & Risk">
      <div className="rounded-xl bg-ink-900/70 p-4 ring-1 ring-ink-700">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-signal">Duruş</div>
        <p className="mt-1 text-[15px] leading-relaxed text-ink-100">{s.stance}</p>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="text-[11px] uppercase tracking-wider text-ink-400">
            <tr className="border-b border-ink-800">
              <th className="py-2 pr-3 font-medium">Token</th>
              <th className="py-2 pr-3 font-medium">Ufuk</th>
              <th className="py-2 pr-3 font-medium">Tahmin</th>
              <th className="py-2 pr-3 font-medium">Güven</th>
              <th className="py-2 pr-3 font-medium" title="Haber hiç yokmuş gibi, yalnız oynaklıktan hesaplanan olasılık. Fark = ajanın şansın üstündeki iddiası.">
                Taban oran
              </th>
              <th className="py-2 pr-3 font-medium">Fiyatlanma</th>
              <th className="py-2 pr-3 font-medium">Sonuç</th>
              <th className="py-2 font-medium">Gerekçe</th>
            </tr>
          </thead>
          <tbody>
            {s.predictions.map((p, i) => {
              const row = predBy.get(`${p.token.toUpperCase()}:${p.horizon === "1h" ? 1 : 24}`);
              // The recorded prediction is authoritative: code rules may have corrected the model's call.
              const dir = row?.direction ?? p.direction;
              const conf = row ? row.confidence * 100 : p.confidence;
              return (
                <tr key={i} className="border-b border-ink-800/70 align-top">
                  <td className="num py-3 pr-3 font-semibold">
                    <Link href={`/token/${p.token.toUpperCase()}`} className="hover:text-signal">
                      {p.token.toUpperCase()}
                    </Link>
                  </td>
                  <td className="num py-3 pr-3 text-ink-300">{p.horizon === "1h" ? "1 saat" : "24 saat"}</td>
                  <td className="py-3 pr-3">
                    <DirPill dir={dir} />
                    {row?.rule_note && (
                      <div className="mt-1 text-[11px] text-ink-500 line-through">
                        model: {p.direction} %{Math.round(p.confidence)}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pr-3">
                    <ConfidenceBar value={conf / 100} />
                  </td>
                  <td className="py-3 pr-3">
                    <BaseCell snap={snapBy.get(p.token.toUpperCase())} horizon={p.horizon} dir={dir} confidence={conf} />
                  </td>
                  <td className="py-3 pr-3 text-xs text-ink-300">{PRICED_LABEL[p.priced_in]}</td>
                  <td className="py-3 pr-3">
                    {row ? (
                      <div className="space-y-1">
                        <StatusPill status={row.status} />
                        {row.change_pct !== null && (
                          <div className="text-[11px]">
                            <Pct value={row.change_pct} /> {row.actual_dir && <span className="text-ink-400">→ {row.actual_dir}</span>}
                          </div>
                        )}
                        {row.status === "pending" && <div className="text-[11px] text-ink-400">{fmtTime(row.entry_ts + row.horizon_h * 3600000)}</div>}
                      </div>
                    ) : abstBy.has(`${p.token.toUpperCase()}:${p.horizon === "1h" ? 1 : 24}`) ? (
                      <Badge tone="judge">çekimser</Badge>
                    ) : (
                      <span className="text-xs text-ink-500">kaydedilmedi</span>
                    )}
                  </td>
                  <td className="py-3 text-ink-200">
                    {p.rationale}
                    <div className="mt-1 text-xs text-ink-400">Geçersiz olur: {p.invalidation}</div>
                    {row?.rule_note && (
                      <div className="mt-1.5 rounded-md bg-judge/10 px-2 py-1 text-xs text-judge ring-1 ring-judge/25">⚙ Kural düzeltmesi: {row.rule_note}</div>
                    )}
                    {!row && abstBy.get(`${p.token.toUpperCase()}:${p.horizon === "1h" ? 1 : 24}`) && (
                      <div className="mt-1.5 rounded-md bg-judge/10 px-2 py-1 text-xs text-judge ring-1 ring-judge/25">
                        ⚙ Karneye alınmadı: {abstBy.get(`${p.token.toUpperCase()}:${p.horizon === "1h" ? 1 : 24}`)!.reason}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notCalled.length > 0 && (
        <p className="mt-3 text-xs text-ink-400">
          Ajan şu fırsatlarda çekimser kaldı (tahmin vermedi):{" "}
          <span className="num text-ink-200">{notCalled.map((x) => `${x.token} ${x.horizon_h}s`).join(" · ")}</span>
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Senaryolar</div>
          <div className="space-y-2.5">
            {s.scenarios.map((sc, i) => (
              <div key={i} className="rounded-xl bg-ink-900/60 p-3.5 ring-1 ring-ink-800">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink-100">{sc.name}</span>
                  <span className="num text-sm text-signal">%{Math.round(sc.probability)}</span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full bg-signal/70" style={{ width: `${Math.min(100, sc.probability)}%` }} />
                </div>
                <p className="mt-2 text-[13px] text-ink-300">{sc.description}</p>
                {sc.signposts.length > 0 && <div className="mt-1.5 text-xs text-ink-400">İşaretler: {sc.signposts.join(" · ")}</div>}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-atk">ATK ile piyasa durumu</div>
            <p className="text-[13px] leading-relaxed text-ink-200">{s.market_context}</p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Riskler</div>
            <ul className="space-y-1 text-[13px] text-ink-200">
              {s.risks.map((r, i) => (
                <li key={i}>⚠ {r}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">En büyük belirsizlik</div>
            <p className="text-[13px] text-ink-200">{s.uncertainty}</p>
          </div>
          <div className="rounded-xl bg-ink-900/60 p-3.5 ring-1 ring-ink-800">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-judge">Karneden öğrenilen</div>
            <p className="text-[13px] text-ink-200">{s.track_record_note}</p>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RetryButton({ newsId, mode }: { newsId: string; mode: "live" | "backtest" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newsId, mode }) });
    const b = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(b.error ?? "Başlatılamadı");
    router.push(`/analiz/${b.id}`);
  }
  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs">{err}</span>}
      <button onClick={retry} disabled={busy} className="rounded-lg bg-ink-100 px-3 py-1 text-xs font-semibold text-ink-950 hover:bg-white disabled:opacity-50">
        {busy ? "Başlatılıyor…" : "Tekrar dene"}
      </button>
    </div>
  );
}

export default function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [interval, setIntervalMs] = useState(1200);
  const { data: a, error } = usePoll<AnalysisDetail>(`/api/analysis/${id}`, interval);

  useEffect(() => {
    if (!a) return;
    const pending = a.predictions.some((p) => p.status === "pending");
    setIntervalMs(a.status === "running" ? 1200 : pending ? 30000 : 0);
  }, [a]);

  if (error) return <Empty>{error}</Empty>;
  if (!a) return <div className="shimmer h-64 rounded-2xl bg-ink-850" />;

  const states = agentStates(a.events, a.status);
  const r = a.result;
  const news = r?.news ?? donePayload<NewsAnalysis>(a.events, "news");
  const impact = r?.impact ?? donePayload<Impact>(a.events, "impact");
  const snaps = r?.snapshots ?? (a.events.find((e) => e.title === "Piyasa anlık görüntüsü alındı")?.payload as TokenSnapshot[] | undefined) ?? null;
  const bull = r?.bull ?? donePayload<Case>(a.events, "bull");
  const bear = r?.bear ?? donePayload<Case>(a.events, "bear");
  const verdict = r?.verdict ?? donePayload<Verdict>(a.events, "judge");
  const strategy = r?.strategy ?? donePayload<Strategy>(a.events, "strategy");

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
          <Link href="/" className="hover:text-ink-200">← Komuta merkezi</Link>
          <span>·</span>
          <span className="font-semibold text-ink-200">{a.news.source}</span>
          <span>·</span>
          <span>{timeAgo(a.news.published_at ?? a.news.fetched_at)}</span>
          {a.trigger === "auto" && <Badge tone="atk">otonom mod başlattı</Badge>}
          {a.mode === "backtest" && <Badge tone="judge">Geriye dönük test · veri {fmtTime(a.as_of)} öncesi</Badge>}
          {a.status === "running" && <Badge tone="signal">çalışıyor · <Elapsed from={a.created_at} to={null} /></Badge>}
          {a.status === "done" && <Badge tone="up">tamamlandı · <Elapsed from={a.created_at} to={a.finished_at} /></Badge>}
          {a.status === "error" && <Badge tone="down">hata</Badge>}
          {r && (
            <span className="num ml-auto text-ink-500">
              {r.model ? `${r.model} · ` : ""}
              {(r.usage.input / 1000).toFixed(1)}k girdi · {(r.usage.output / 1000).toFixed(1)}k çıktı token
            </span>
          )}
        </div>
        <h1 className="mt-2 font-display text-xl font-semibold leading-snug sm:text-2xl">{a.news.title}</h1>
        {a.news.url && (
          <a href={a.news.url} target="_blank" rel="noreferrer" className="text-xs text-ink-400 hover:text-ink-200">
            {a.news.url} ↗
          </a>
        )}
        <div className="mt-4">
          <Pipeline states={states} />
        </div>
        {a.status === "error" && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
            <span className="min-w-0 flex-1">{a.error}</span>
            <RetryButton newsId={a.news.id} mode={a.mode} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card title="Yürütme zaman çizelgesi">
            <Waterfall events={a.events} start={a.created_at} end={a.finished_at} />
          </Card>
          {news ? <NewsCard n={news} /> : <div className="shimmer h-48 rounded-2xl bg-ink-850" />}
          {impact && <ImpactCard impact={impact} snaps={snaps} />}
          {(bull || bear || states.bull === "running") && <DebateCard bull={bull} bear={bear} verdict={verdict} />}
          {strategy ? <StrategyCard s={strategy} a={a} snaps={snaps} /> : states.strategy === "running" && <div className="shimmer h-64 rounded-2xl bg-ink-850" />}
          {a.status === "done" && <EventStudyCard analysisId={a.id} analysisAt={a.as_of} />}
          {r && r.trackRecord && (
            <Card title="Ajana verilen karne hafızası">
              <pre className="num whitespace-pre-wrap text-xs leading-relaxed text-ink-300">{r.trackRecord}</pre>
            </Card>
          )}
          {(news || impact) && (
            <Card title="Ham ajan çıktıları · JSON">
              <RawOutputs
                outputs={[
                  { id: "news", label: "news", data: news },
                  { id: "impact", label: "impact", data: impact },
                  { id: "snapshots", label: "market_snapshot", data: snaps },
                  { id: "bull", label: "bull", data: bull },
                  { id: "bear", label: "bear", data: bear },
                  { id: "judge", label: "judge", data: verdict },
                  { id: "strategy", label: "strategy", data: strategy },
                  { id: "tools", label: "atk_calls", data: r?.toolCalls },
                  { id: "predictions", label: "predictions", data: a.predictions.length ? a.predictions : null },
                ]}
              />
            </Card>
          )}
        </div>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <Card
            title="Ajan izi"
            action={r ? <span className="text-[11px] text-atk">{r.toolCalls.length} ATK çağrısı</span> : undefined}
          >
            <div className="max-h-[70vh] overflow-y-auto pr-1">
              <Trace events={a.events} start={a.created_at} />
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
