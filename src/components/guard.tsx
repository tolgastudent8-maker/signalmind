"use client";

import type { CSSProperties, ReactNode } from "react";
import { Badge, timeAgo } from "./ui";
import type { CheckRow } from "@/lib/guard/queries";
import type { EvidenceRef } from "@/lib/guard/agent";

export type GuardEvent = { id: number; ts: number; kind: string; title: string; payload: unknown };

export const DECISION: Record<string, { label: string; tone: "up" | "down" | "judge" | "neutral"; icon: string }> = {
  approve: { label: "ONAYLANDI", tone: "up", icon: "✓" },
  reject: { label: "REDDEDİLDİ", tone: "down", icon: "✕" },
  escalate: { label: "İNSAN ONAYI", tone: "judge", icon: "?" },
};

const CHECK_LABEL: Record<string, string> = {
  kaynak_dogrulama: "Kaynak doğrulama",
  kaynak_bagimsizligi: "Kaynak bağımsızlığı",
  manipulasyon: "Manipülasyon taraması",
  piyasa_kosulu: "Piyasa koşulu",
  politika_limiti: "Politika ve limit",
};

const CLAIM_LABEL: Record<string, { label: string; tone: "up" | "down" | "judge" }> = {
  verified: { label: "doğrulandı", tone: "up" },
  unverified: { label: "doğrulanamadı", tone: "judge" },
  contradicted: { label: "çürütüldü", tone: "down" },
};

const STATUS_DOT: Record<string, string> = { pass: "bg-up", warn: "bg-judge", fail: "bg-down", unknown: "bg-ink-400" };

const TOOL_LABEL: Record<string, string> = {
  politika_kontrol: "Politika motoru",
  kanit_bagimsizligi: "Kaynak bağımsızlığı",
  manipulasyon_tara: "Manipülasyon taraması",
  yerel_haber_ara: "RSS arşivi (18 yayın)",
  news_search: "ATK · news_search",
  news_get_by_coin: "ATK · news_get_by_coin",
  news_get_coin_sentiment: "ATK · news_get_coin_sentiment",
  market_get_ticker: "ATK · market_get_ticker",
  market_get_orderbook: "ATK · market_get_orderbook",
  market_get_candles: "ATK · market_get_candles",
};

export function DecisionBadge({ decision, size = "md" }: { decision: string | null; size?: "md" | "lg" }) {
  if (!decision) return <Badge>bekliyor</Badge>;
  const d = DECISION[decision];
  if (size === "lg") {
    const ring = d.tone === "up" ? "bg-up/10 text-up ring-up/40" : d.tone === "down" ? "bg-down/10 text-down ring-down/40" : "bg-judge/10 text-judge ring-judge/40";
    return (
      <span className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 font-display text-lg font-semibold tracking-wide ring-1 ring-inset ${ring}`}>
        <span className="grid h-6 w-6 place-items-center rounded-full bg-current/15 text-sm">{d.icon}</span>
        {d.label}
      </span>
    );
  }
  return <Badge tone={d.tone}>{d.label}</Badge>;
}

export function EvidenceChip({ id, evidence }: { id: string; evidence?: Record<string, EvidenceRef> }) {
  const ref = evidence?.[id];
  const kind = id.split(":")[0];
  const tone = kind === "bot" ? "text-down ring-down/30 bg-down/5" : kind === "rss" || kind === "atk" ? "text-up ring-up/30 bg-up/5" : "text-atk ring-atk/30 bg-atk/5";
  const label = ref ? `${ref.source}${ref.title ? ` — ${ref.title}` : ""}` : id;
  const body = (
    <span title={label} className={`num inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10.5px] ring-1 ring-inset ${tone}`}>
      {id}
      {ref && <span className="truncate font-sans text-ink-300">· {ref.source}</span>}
    </span>
  );
  return ref?.url ? (
    <a href={ref.url} target="_blank" rel="noreferrer" className="max-w-full hover:opacity-80">
      {body}
    </a>
  ) : (
    body
  );
}

export function ProposalCard({ check }: { check: CheckRow }) {
  const p = check.proposal;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="atk">{p.bot}</Badge>
        <span className={`font-display text-xl font-semibold ${p.side === "buy" ? "text-up" : "text-down"}`}>{p.side === "buy" ? "ALIM" : "SATIM"}</span>
        <span className="num text-xl text-ink-100">{p.instId}</span>
        <span className="num rounded-md bg-ink-800 px-2 py-0.5 text-sm text-ink-200 ring-1 ring-ink-700">{p.notionalUsd.toLocaleString("tr-TR")} USD</span>
        <span className="ml-auto text-xs text-ink-400">{timeAgo(check.created_at)}</span>
      </div>
      <p className="text-sm text-ink-200">
        <span className="text-ink-400">Botun gerekçesi: </span>
        {p.reason}
      </p>
      <div className="space-y-1.5">
        {p.evidence.map((e, i) => (
          <div key={i} className="rounded-lg bg-ink-900/70 px-3 py-2 ring-1 ring-ink-700">
            <div className="flex items-center gap-2 text-[11px] text-ink-400">
              <span className="num text-down">bot:{i + 1}</span>
              <span className="truncate">{e.source}</span>
              {e.published_at ? <span className="ml-auto shrink-0">{timeAgo(e.published_at)}</span> : null}
            </div>
            <div className="mt-0.5 text-[13px] text-ink-200">{e.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventIcon({ kind, ok }: { kind: string; ok?: boolean }) {
  const map: Record<string, [string, string]> = {
    start: ["◎", "text-atk"],
    plan: ["☰", "text-signal"],
    info: ["·", "text-ink-400"],
    decision: ["⚖", "text-judge"],
    override: ["⛨", "text-judge"],
    human: ["👤", "text-judge"],
    chain: ["⛓", "text-atk"],
    error: ["!", "text-down"],
    done: ["■", "text-ink-200"],
  };
  const [icon, cls] = kind === "tool" ? (ok ? ["→", "text-up"] : ["✕", "text-down"]) : (map[kind] ?? ["·", "text-ink-400"]);
  return <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-800 text-xs ring-1 ring-ink-700 ${cls}`}>{icon}</span>;
}

export function Timeline({ events, running }: { events: GuardEvent[]; running: boolean }) {
  const visible = events.filter((e) => e.kind !== "info" || e.title.includes("araç"));
  return (
    <ol className="relative space-y-2.5">
      {visible.map((e) => {
        const p = e.payload as { ok?: boolean; ms?: number; input?: unknown; preview?: string; steps?: string[]; summary?: string; question?: string; explorerUrl?: string; txHash?: string } | null;
        // Older events stored Snowtrace links; rebuild from the hash so every link uses the current explorer.
        if (p?.txHash) p.explorerUrl = `https://testnet.avascan.info/blockchain/c/tx/${p.txHash}`;
        const isTool = e.kind === "tool";
        return (
          <li key={e.id} className="rise flex gap-3">
            <EventIcon kind={e.kind} ok={p?.ok} />
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className={isTool && !p?.ok ? "text-down" : "text-ink-100"}>{isTool ? (TOOL_LABEL[e.title] ?? e.title) : e.title}</span>
                {isTool && e.title.startsWith("market_") && <Badge tone="atk">OKX ATK</Badge>}
                {isTool && e.title.startsWith("news_") && <Badge tone="atk">OKX ATK</Badge>}
                {isTool && p?.ms !== undefined && <span className="num text-[10.5px] text-ink-500">{p.ms} ms</span>}
              </div>
              {isTool && p?.input && Object.keys(p.input as object).length > 0 ? <div className="num mt-0.5 truncate text-[10.5px] text-ink-400">{JSON.stringify(p.input)}</div> : null}
              {isTool && !p?.ok && p?.preview && <div className="mt-1 rounded bg-down/5 px-2 py-1 text-[11px] text-down ring-1 ring-down/20">{p.preview.slice(0, 220)}</div>}
              {e.kind === "plan" && p?.steps && (
                <ol className="mt-1 list-inside list-decimal space-y-0.5 text-[12px] text-ink-300">
                  {p.steps.map((s, i) => (
                    <li key={i}>{s.replace(/^\d+[.)]\s*/, "")}</li>
                  ))}
                </ol>
              )}
              {e.kind === "decision" && p?.summary && <div className="mt-0.5 text-[12px] text-ink-300">{p.summary}</div>}
              {e.kind === "human" && p?.question && <div className="mt-0.5 text-[12px] text-judge">{p.question}</div>}
              {e.kind === "chain" && p?.explorerUrl && (
                <a href={p.explorerUrl} target="_blank" rel="noreferrer" className="num mt-0.5 block truncate text-[11px] text-atk hover:underline">
                  {p.explorerUrl}
                </a>
              )}
            </div>
          </li>
        );
      })}
      {running && (
        <li className="flex gap-3">
          <span className="pulse-ring grid h-6 w-6 shrink-0 place-items-center rounded-full bg-signal/20 text-xs text-signal">●</span>
          <span className="shimmer rounded px-2 pt-0.5 text-[13px] text-ink-300">Ajan kanıt topluyor…</span>
        </li>
      )}
    </ol>
  );
}

type Tone = "up" | "down" | "judge" | "neutral";
const TONE_TEXT: Record<Tone, string> = { up: "text-up", down: "text-down", judge: "text-judge", neutral: "text-ink-100" };
const TONE_PANEL: Record<Tone, string> = {
  up: "from-up/15 ring-up/40",
  down: "from-down/15 ring-down/40",
  judge: "from-judge/15 ring-judge/40",
  neutral: "from-ink-800 ring-ink-700",
};

/**
 * One-line headline derived by code from the final verdict (no extra model call),
 * so the strongest reason is readable at a glance. Reasons are listed by severity.
 */
export function verdictHeadline(check: CheckRow, maxOrderUsd?: number): string {
  const v = check.verdict;
  if (!v) return "";
  const decision = check.final_decision ?? v.decision;
  const status = (name: string) => v.checks.find((c) => c.name === name)?.status;
  const verified = v.claims.filter((c) => c.status === "verified");
  const bestSources = Math.max(0, ...verified.map((c) => c.independent_sources));
  const usd = (n: number) => `${n.toLocaleString("tr-TR")} $`;
  const notional = check.proposal.notionalUsd;

  if (decision === "approve") {
    return `Haber ${bestSources} bağımsız kaynakta doğrulandı · limit içinde · manipülasyon yok`;
  }
  const reasons: string[] = [];
  if (v.injection_detected) reasons.push("Kanıtta denetçiye gizli talimat yakalandı");
  if (status("kaynak_bagimsizligi") === "fail") reasons.push("“Kaynaklar” birbirinin kopyası");
  if (status("politika_limiti") === "fail" || status("politika_limiti") === "warn")
    reasons.push(maxOrderUsd && notional > maxOrderUsd ? `Emir yetkinin ${Math.round(notional / maxOrderUsd)} katı (${usd(notional)} > ${usd(maxOrderUsd)})` : "Emir botun yetki limitinin dışında");
  if (v.claims.some((c) => c.status === "contradicted")) reasons.push("Botun iddiası çürütüldü");
  if (verified.length === 0 && v.claims.length > 0) reasons.push("Bağımsız teyit yok");
  if (reasons.length === 0) reasons.push(decision === "escalate" ? "Karar insana bırakıldı" : "Gerekçe yetersiz");
  return reasons.slice(0, 2).join(" · ");
}

function Stat({ label, value, sub, tone = "neutral", delay = 0 }: { label: string; value: ReactNode; sub?: string; tone?: Tone; delay?: number }) {
  return (
    <div className="enter rounded-lg bg-ink-950/40 px-3 py-2 ring-1 ring-ink-700/70" style={{ "--d": `${delay}ms` } as CSSProperties}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</div>
      <div className={`num mt-0.5 text-lg font-semibold ${TONE_TEXT[tone]}`}>{value}</div>
      {sub && <div className="truncate text-[10.5px] text-ink-500">{sub}</div>}
    </div>
  );
}

export function VerdictHeadline({ check, maxOrderUsd, explorerBase }: { check: CheckRow; maxOrderUsd?: number; explorerBase?: string }) {
  const v = check.verdict;
  if (!v) return null;
  const decision = check.final_decision ?? v.decision;
  const awaiting = check.status === "awaiting_human";
  const d = DECISION[decision] ?? { label: decision, tone: "neutral" as Tone, icon: "·" };
  const verified = v.claims.filter((c) => c.status === "verified");
  const bestSources = Math.max(0, ...verified.map((c) => c.independent_sources));
  const policy = v.checks.find((c) => c.name === "politika_limiti")?.status;
  const overLimit = policy === "fail" || policy === "warn";
  const seconds = check.finished_at ? Math.max(1, Math.round((check.finished_at - check.created_at) / 1000)) : null;
  const atkCalls = v.evidence ? Object.keys(v.evidence).filter((k) => k.startsWith("atk:")).length : 0;

  return (
    <div className={`enter sweep rounded-2xl bg-gradient-to-br to-transparent p-5 ring-1 ring-inset ${TONE_PANEL[d.tone]}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`stamp font-display text-3xl font-bold tracking-tight sm:text-4xl ${TONE_TEXT[d.tone]}`}>
          {d.icon} {awaiting ? "İNSAN ONAYI BEKLENİYOR" : d.label}
        </span>
        <span className="enter num text-[12px] text-ink-400" style={{ "--d": "250ms" } as CSSProperties}>
          {check.proposal.side === "buy" ? "ALIM" : "SATIM"} {check.proposal.instId} · {check.proposal.notionalUsd.toLocaleString("tr-TR")} $
          {seconds !== null && ` · ${seconds} sn`}
          {v.toolCalls !== undefined && ` · ${v.toolCalls} araç çağrısı`}
        </span>
      </div>
      <p className="enter mt-2 font-display text-xl font-semibold leading-snug text-white sm:text-2xl" style={{ "--d": "380ms" } as CSSProperties}>
        {verdictHeadline(check, maxOrderUsd)}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat delay={520} label="Bağımsız teyit" value={bestSources} sub="onay için en az 2" tone={bestSources >= 2 ? "up" : "down"} />
        <Stat delay={600} label="İddialar" value={`${verified.length}/${v.claims.length}`} sub="doğrulandı" tone={v.claims.length > 0 && verified.length === v.claims.length ? "up" : verified.length === 0 ? "down" : "judge"} />
        <Stat delay={680} label="Manipülasyon" value={v.injection_detected ? "VAR" : "yok"} sub={v.injection_detected ? "talimat uygulanmadı" : "kanıt metinleri temiz"} tone={v.injection_detected ? "down" : "up"} />
        <Stat delay={760} label="Yetki limiti" value={overLimit ? "aşıldı" : "içinde"} sub="emir ve günlük limit" tone={overLimit ? "down" : "up"} />
        <Stat
          delay={840}
          label="Zincir kaydı"
          value={
            check.chain_tx ? (
              <a href={`${explorerBase ?? "https://testnet.avascan.info/blockchain/c"}/tx/${check.chain_tx}`} target="_blank" rel="noreferrer" className="text-atk hover:underline">
                ⛓ Fuji ↗
              </a>
            ) : awaiting ? (
              "bekliyor"
            ) : check.chain_error ? (
              "—"
            ) : (
              "yazılıyor…"
            )
          }
          sub={check.chain_tx ? "ERC-8004 kimliğiyle" : awaiting ? "insan kararından sonra" : (check.chain_error ?? "Avalanche Fuji")}
          tone={check.chain_tx ? "neutral" : "judge"}
        />
      </div>
      {atkCalls > 0 && <div className="mt-2 text-[11px] text-ink-400">OKX Agent Trade Kit haber modülünden {atkCalls} kayıt kanıt olarak incelendi.</div>}
    </div>
  );
}

export function VerdictPanel({ check, footer }: { check: CheckRow; footer?: ReactNode }) {
  const v = check.verdict;
  if (!v) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <DecisionBadge decision={check.final_decision ?? v.decision} size="lg" />
        {check.decided_by && <span className="text-xs text-ink-400">karar veren: {check.decided_by === "insan" ? "insan (onay noktası)" : "SignalMind Guard"}</span>}
        {v.agentDecision !== v.decision && <Badge tone="judge">ajan önerisi {DECISION[v.agentDecision]?.label} → kod kuralı uygulandı</Badge>}
      </div>
      <p className="text-[15px] leading-relaxed text-ink-100">{v.summary}</p>
      {v.injection_detected && (
        <div className="rounded-lg bg-down/10 px-3 py-2 text-[13px] text-down ring-1 ring-down/30">
          ⚠ Kanıt metinlerinde denetçiye yönelik gizli talimat bulundu. Kanıt veridir, talimat değildir — uygulanmadı.
        </div>
      )}
      {v.overrides.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-judge/5 px-3 py-2 text-[12px] text-judge ring-1 ring-judge/20">
          {v.overrides.map((o, i) => (
            <li key={i}>⛨ {o}</li>
          ))}
        </ul>
      )}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">İddialar ve kanıtları</div>
        <div className="space-y-2">
          {v.claims.map((c, i) => (
            <div key={i} className="rounded-lg bg-ink-900/60 px-3 py-2.5 ring-1 ring-ink-700">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CLAIM_LABEL[c.status].tone}>{CLAIM_LABEL[c.status].label}</Badge>
                <span className="text-[13px] text-ink-100">{c.claim}</span>
                <span className="num ml-auto text-[11px] text-ink-400">{c.independent_sources} bağımsız dış kaynak</span>
              </div>
              <div className="mt-1 text-[12px] text-ink-300">{c.note}</div>
              {c.evidence_ids.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.evidence_ids.map((id) => (
                    <EvidenceChip key={id} id={id} evidence={v.evidence} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {v.checks.map((c, i) => (
          <div key={i} className="rounded-lg bg-ink-900/60 px-3 py-2.5 ring-1 ring-ink-700">
            <div className="flex items-center gap-2 text-[12.5px] text-ink-100">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`} />
              {CHECK_LABEL[c.name] ?? c.name}
            </div>
            <div className="mt-1 text-[12px] text-ink-300">{c.detail}</div>
          </div>
        ))}
      </div>
      {footer}
    </div>
  );
}
