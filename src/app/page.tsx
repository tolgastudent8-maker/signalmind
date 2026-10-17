"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Empty, usePoll, timeAgo } from "@/components/ui";
import { DecisionBadge, ProposalCard, Timeline, VerdictHeadline, VerdictPanel, type GuardEvent } from "@/components/guard";
import type { CheckRow } from "@/lib/guard/queries";
import type { Trust } from "@/lib/guard/policy";
import type { ChainInfo } from "@/lib/guard/agent";

type Overview = {
  bot: string;
  trust: Trust;
  trustSince: number;
  tiers: { tier: number; name: string; maxOrderUsd: number; dailyUsd: number; needApproved: number }[];
  allowedAssets: string[];
  scenarios: { id: string; title: string; expectation: string }[];
  checks: CheckRow[];
  layers: { chain: ChainInfo | null; atkNewsCredentials: boolean; ai: { label: string; model: string; configured: boolean } };
};

function Layer({ name, value, ok, hint }: { name: string; value: string; ok: boolean | "warn"; hint: string }) {
  const dot = ok === true ? "bg-up" : ok === "warn" ? "bg-judge" : "bg-ink-500";
  return (
    <div className="card px-4 py-3" title={hint}>
      <div className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {name}
      </div>
      <div className="mt-1 truncate text-[13px] text-ink-100">{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-ink-400">{hint}</div>
    </div>
  );
}

function TrustLadder({ trust, tiers }: { trust: Trust; tiers: Overview["tiers"] }) {
  return (
    <div className="space-y-2">
      {tiers.map((t) => {
        const active = t.tier === trust.tier.tier;
        const reached = t.tier <= trust.tier.tier;
        return (
          <div key={t.tier} className={`flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ${active ? "bg-signal/10 ring-signal/40" : "bg-ink-900/50 ring-ink-700"}`}>
            <span className={`num grid h-6 w-6 place-items-center rounded-full text-[11px] ${reached ? "bg-signal text-ink-950" : "bg-ink-700 text-ink-300"}`}>{t.tier}</span>
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] ${active ? "text-signal" : "text-ink-200"}`}>{t.name}</div>
              <div className="num text-[10.5px] text-ink-400">
                emir ≤ {t.maxOrderUsd.toLocaleString("tr-TR")} $ · gün ≤ {t.dailyUsd.toLocaleString("tr-TR")} $
              </div>
            </div>
            <span className="num text-[10.5px] text-ink-400">{t.needApproved} onay</span>
          </div>
        );
      })}
      <p className="text-[11.5px] leading-relaxed text-ink-400">
        Yetki yalnızca kanıtlı geçmişle büyür: {trust.approved} onaylı, {trust.rejected} reddedilmiş emir.
        {trust.next ? ` Sonraki seviye için ${trust.next.needApproved - trust.approved} onay daha gerekli.` : " En üst seviye."}
      </p>
    </div>
  );
}

type Verify = {
  ok: boolean;
  recomputed: string;
  hashMatches: boolean;
  decision?: string;
  decisionMatches?: boolean | null;
  agentMatches?: boolean | null;
  onChain?: { recorded: boolean; recordedAt: number | null; block: number | null; agentId: string | null; decision: string | null };
  error?: string;
};

const DECISION_TR: Record<string, string> = { approve: "onay", reject: "ret", escalate: "insan onayı" };

/** Re-hashes the stored verdict and reads Fuji for it: the check a juror would otherwise do by hand. */
function VerifyOnChain({ checkId }: { checkId: string }) {
  const [state, setState] = useState<"idle" | "busy" | Verify>("idle");
  async function go() {
    setState("busy");
    const r = await fetch(`/api/guard/${checkId}/verify`, { cache: "no-store" });
    setState((await r.json()) as Verify);
  }
  if (state === "idle" || state === "busy")
    return (
      <button onClick={go} disabled={state === "busy"} className="mt-2 rounded-lg bg-atk/10 px-3 py-1.5 text-[12.5px] font-medium text-atk ring-1 ring-atk/40 hover:bg-atk/20 disabled:opacity-60">
        {state === "busy" ? "Fuji okunuyor…" : "⛓ Zincirde doğrula"}
      </button>
    );
  const v = state;
  const row = (ok: boolean | null | undefined, text: string) => (
    <li className="flex gap-2">
      <span className={ok ? "text-up" : ok === false ? "text-down" : "text-ink-500"}>{ok ? "✓" : ok === false ? "✕" : "·"}</span>
      <span className="text-ink-200">{text}</span>
    </li>
  );
  return (
    <div className={`mt-2 rounded-lg px-3 py-2.5 ring-1 ${v.ok ? "bg-up/5 ring-up/30" : "bg-down/5 ring-down/30"}`}>
      <div className={`text-[13px] font-semibold ${v.ok ? "text-up" : "text-down"}`}>{v.ok ? "✓ Doğrulandı: kayıt değiştirilmemiş" : "✕ Doğrulanamadı"}</div>
      <ul className="num mt-1.5 space-y-1 text-[11.5px]">
        {row(v.hashMatches, `Karar kaydı yeniden hash'lendi: ${v.recomputed.slice(0, 18)}… ${v.hashMatches ? "kayıtla aynı" : "kayıtla FARKLI"}`)}
        {v.onChain && row(v.onChain.recorded, v.onChain.recorded ? `Fuji'de kayıtlı · blok #${v.onChain.block ?? "?"} · ${v.onChain.recordedAt ? new Date(v.onChain.recordedAt).toLocaleString("tr-TR") : ""}` : "Bu hash Fuji'de yok")}
        {v.onChain && v.decisionMatches !== undefined && row(v.decisionMatches, `Zincirdeki karar: ${DECISION_TR[v.onChain.decision ?? ""] ?? "—"} (kayıttaki: ${DECISION_TR[v.decision ?? ""] ?? "—"})`)}
        {v.onChain && v.agentMatches !== undefined && row(v.agentMatches, `Yazan: ERC-8004 ajan #${v.onChain.agentId ?? "—"}`)}
        {v.error && row(false, v.error)}
      </ul>
    </div>
  );
}

/**
 * An order typed by hand (e.g. by a juror): the same path any external trading agent uses,
 * POST /api/guard with a full proposal. One evidence item per line; "Kaynak: metin" names its source.
 */
function CustomOrder({ bot, assets, disabled, busy, onSubmit }: { bot: string; assets: string[]; disabled: boolean; busy: boolean; onSubmit: (p: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const [coin, setCoin] = useState("ETH");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [usd, setUsd] = useState("200");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const items = evidence
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5)
      .map((l) => {
        const m = l.match(/^([^:]{2,40}):\s*(.+)$/);
        return m ? { source: m[1].trim(), text: m[2] } : { source: "Bot kaynağı", text: l };
      });
    onSubmit({ bot, side, instId: `${coin.trim().toUpperCase()}-USDT`, notionalUsd: Number(usd), reason: reason.trim(), evidence: items });
  }

  const field = "w-full rounded-lg bg-ink-900 px-2.5 py-1.5 text-[13px] text-ink-100 ring-1 ring-ink-700 outline-none focus:ring-signal/50";
  if (!open)
    return (
      <button onClick={() => setOpen(true)} disabled={disabled} className="mt-3 w-full rounded-lg bg-signal/10 px-3 py-3 text-left ring-1 ring-signal/50 transition hover:bg-signal/20 disabled:opacity-50">
        <div className="text-[14px] font-semibold text-signal">✎ Kendi emrini yaz</div>
        <div className="mt-0.5 text-[11.5px] text-ink-300">Hazır senaryo değil: istediğin coin, tutar ve iddiayı yaz, Guard canlı haberlerle denetlesin</div>
      </button>
    );
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-lg bg-ink-900/60 p-3 ring-1 ring-signal/30">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-signal">Kendi emrin</span>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-ink-400 hover:text-ink-100">
          kapat
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")} className={field} aria-label="Yön">
          <option value="buy">ALIM</option>
          <option value="sell">SATIM</option>
        </select>
        <input value={coin} onChange={(e) => setCoin(e.target.value)} list="guard-assets" className={field} aria-label="Coin" placeholder="ETH" />
        <input value={usd} onChange={(e) => setUsd(e.target.value)} type="number" min="1" className={field} aria-label="Tutar (USD)" placeholder="USD" />
        <datalist id="guard-assets">
          {assets.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} maxLength={600} rows={2} className={field} placeholder="Gerekçe: ör. Ethereum spot ETF'lerine rekor giriş oldu, alıyorum" />
      <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={3} maxLength={3000} className={field} placeholder={"Kanıtlar (her satır bir kaynak, isteğe bağlı)\nTelegram: ETF girişleri rekor kırdı!\nX: ETH yarın 5000$"} />
      <button type="submit" disabled={disabled} className="w-full rounded-lg bg-signal/15 px-3 py-2 text-[13px] font-medium text-signal ring-1 ring-signal/40 hover:bg-signal/25 disabled:opacity-50">
        {busy ? "gönderiliyor…" : "Guard'a denetlet →"}
      </button>
      <p className="text-[11px] text-ink-500">Aynı yol, dışarıdaki her trading ajanının kullandığı API: POST /api/guard</p>
    </form>
  );
}

export default function GuardConsole() {
  const overview = usePoll<Overview>("/api/guard", 5000);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  const checks = overview.data?.checks ?? [];
  useEffect(() => {
    if (!selected && checks[0]) setSelected(checks[0].id);
  }, [selected, checks]);

  const current = checks.find((c) => c.id === selected);
  const live = current?.status === "running";
  const detail = usePoll<{ check: CheckRow; events: GuardEvent[] }>(selected ? `/api/guard/${selected}` : null, live ? 1200 : 4000);
  const check = detail.data?.check.id === selected ? detail.data.check : current;
  const events = detail.data?.check.id === selected ? detail.data.events : [];

  async function run(scenario: string, proposal?: unknown) {
    setBusy(scenario);
    setError(null);
    const res = await fetch("/api/guard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(proposal ? { proposal } : { scenario }) });
    const b = await res.json();
    setBusy(null);
    if (!res.ok) return setError(b.error ?? "Denetim başlatılamadı");
    setSelected(b.id);
    overview.reload();
  }

  // Two-step inline confirmation: window.confirm() is silently suppressed in embedded browsers.
  const [confirmReset, setConfirmReset] = useState(false);
  async function reset() {
    setConfirmReset(false);
    setError(null);
    const res = await fetch("/api/guard", { method: "DELETE" });
    const b = await res.json();
    if (!res.ok) return setError(b.error ?? "Sıfırlanamadı");
    overview.reload();
  }

  async function answer(approve: boolean) {
    if (!check) return;
    setAnswering(true);
    const res = await fetch(`/api/guard/${check.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve }) });
    const b = await res.json();
    setAnswering(false);
    if (!res.ok) setError(b.error ?? "Yanıt kaydedilemedi");
    detail.reload();
    overview.reload();
  }

  const o = overview.data;
  const chain = o?.layers.chain;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">SignalMind Guard</div>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-[34px]">Ajanınız işlem yapmadan önce, kanıtını göstersin.</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-300">
            Trading botunun her emri borsaya gitmeden önce denetlenir: gerekçesindeki haber bağımsız kaynaklarda var mı, kanıtlar birbirinin kopyası mı, içinde manipülasyon var mı, bot yetkisinin içinde mi?
            Karar gerekçesiyle verilir, kanıtına bağlanır ve ajanın zincir üstü kimliğiyle kaydedilir. Fiyat tahmini yapılmaz.
          </p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Layer
          name="Kimlik"
          value={chain?.configured ? `ERC-8004 ajan #${chain.agentId} · Fuji` : "Avalanche Fuji · kurulum bekliyor"}
          ok={chain?.configured ? true : chain?.agentAddress ? "warn" : false}
          hint={chain?.agentAddress ? `cüzdan ${chain.agentAddress.slice(0, 8)}…${chain.agentAddress.slice(-4)}` : "Kararlar yerelde hash'leniyor"}
        />
        <Layer
          name="Araçlar"
          value="OKX Agent Trade Kit (MCP)"
          ok={o ? (o.layers.atkNewsCredentials ? true : "warn") : false}
          hint={o?.layers.atkNewsCredentials ? "market + news modülleri, salt okunur" : "market açık · news için okuma anahtarı yok → RSS yedeği"}
        />
        <Layer name="Sınırlar" value={o ? `${o.trust.tier.name} · emir ≤ ${o.trust.tier.maxOrderUsd} $` : "…"} ok={true} hint="Salt okunur · emir göndermez · araç izin listesi" />
        <Layer name="Model" value={o ? `${o.layers.ai.label} · ${o.layers.ai.model}` : "…"} ok={o?.layers.ai.configured ?? false} hint="Karar sonrası kod kuralları uygulanır" />
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-4">
          <Card title="Trading ajanından emir">
            <p className="mb-3 text-[12.5px] text-ink-300">
              <span className="text-ink-100">{o?.bot ?? "MomentumBot"}</span> okuduğu her habere göre işlem açan basit bir demo bottur. Bir senaryo seçin; emir önce Guard&apos;a gelir.
            </p>
            <div className="space-y-2">
              {(o?.scenarios ?? []).map((s) => (
                <button
                  key={s.id}
                  onClick={() => run(s.id)}
                  disabled={busy !== null}
                  className="group w-full rounded-lg bg-ink-900/60 px-3 py-2.5 text-left ring-1 ring-ink-700 transition hover:bg-ink-800 hover:ring-signal/40 disabled:opacity-50"
                >
                  <div className="flex items-center gap-2 text-[13.5px] text-ink-100">
                    {s.title}
                    <span className="ml-auto text-[11px] text-signal opacity-0 transition group-hover:opacity-100">{busy === s.id ? "gönderiliyor…" : "denet →"}</span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-ink-400">{s.expectation}</div>
                </button>
              ))}
            </div>
            <CustomOrder bot={o?.bot ?? "MomentumBot"} assets={o?.allowedAssets ?? []} disabled={busy !== null} busy={busy === "custom"} onSubmit={(p) => run("custom", p)} />
            {error && <div className="mt-3 rounded-lg bg-down/10 px-3 py-2 text-[12.5px] text-down ring-1 ring-down/30">{error}</div>}
          </Card>
          {o && (
            <Card
              title="Kanıtla büyüyen yetki"
              action={
                confirmReset ? (
                  <span className="flex items-center gap-2 text-[11px]">
                    <span className="text-ink-300">Bot &quot;Yeni&quot; seviyesine dönsün mü? (geçmiş kalır)</span>
                    <button onClick={reset} className="rounded px-1.5 py-0.5 font-medium text-down ring-1 ring-down/40 hover:bg-down/10">
                      evet, sıfırla
                    </button>
                    <button onClick={() => setConfirmReset(false)} className="text-ink-400 hover:text-ink-100">
                      vazgeç
                    </button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmReset(true)} disabled={busy !== null || live} className="text-[11px] text-ink-400 hover:text-ink-100 disabled:opacity-40" title="Botun yetki seviyesini sıfırlar; denetim geçmişi ve zincir kayıtları kalır">
                    demoyu sıfırla
                  </button>
                )
              }
            >
              <TrustLadder trust={o.trust} tiers={o.tiers} />
            </Card>
          )}
        </div>

        <div className="space-y-6 lg:col-span-8">
          {!check ? (
            <Card title="Denetim">
              <Empty>Soldan bir senaryo seçerek ilk denetimi başlatın.</Empty>
            </Card>
          ) : (
            <>
              {check.verdict && check.status !== "error" && (
                <VerdictHeadline check={check} maxOrderUsd={o?.trust.tier.maxOrderUsd} explorerBase={chain?.explorerBase} />
              )}
              <Card title="Emir önerisi" action={<DecisionBadge decision={check.final_decision ?? check.decision} />}>
                <ProposalCard check={check} />
              </Card>
              <div className="grid gap-6 xl:grid-cols-5">
                <Card title="Ajan izi" className="xl:col-span-2" action={live ? <Badge tone="signal">canlı</Badge> : undefined}>
                  <Timeline events={events} running={live} />
                </Card>
                <Card title="Karar" className="xl:col-span-3">
                  {check.status === "error" ? (
                    <div className="rounded-lg bg-down/10 px-3 py-2 text-[13px] text-down ring-1 ring-down/30">Denetim tamamlanamadı: {check.error}</div>
                  ) : !check.verdict ? (
                    <Empty>Ajan kanıt topluyor; karar burada görünecek.</Empty>
                  ) : (
                    <VerdictPanel
                      check={check}
                      footer={
                        <>
                          {check.status === "awaiting_human" && (
                            <div className="rounded-xl bg-judge/10 p-4 ring-1 ring-judge/30">
                              <div className="text-[13px] font-medium text-judge">İnsan onay noktası</div>
                              <div className="mt-1 text-[13px] text-ink-200">{check.verdict.human_question}</div>
                              <div className="mt-3 flex gap-2">
                                <button onClick={() => answer(true)} disabled={answering} className="rounded-lg bg-up/15 px-4 py-2 text-sm font-medium text-up ring-1 ring-up/40 hover:bg-up/25 disabled:opacity-50">
                                  Tek seferlik onayla
                                </button>
                                <button onClick={() => answer(false)} disabled={answering} className="rounded-lg bg-down/15 px-4 py-2 text-sm font-medium text-down ring-1 ring-down/40 hover:bg-down/25 disabled:opacity-50">
                                  Reddet
                                </button>
                              </div>
                            </div>
                          )}
                          {check.verdict_hash && (
                            <div className="rounded-lg bg-ink-900/70 px-3 py-2.5 ring-1 ring-ink-700">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Karar kaydı</div>
                              <div className="num mt-1 break-all text-[11px] text-ink-300">hash {check.verdict_hash}</div>
                              {check.chain_tx ? (
                                <a href={`${chain?.explorerBase ?? "https://testnet.avascan.info/blockchain/c"}/tx/${check.chain_tx}`} target="_blank" rel="noreferrer" className="num mt-1 block break-all text-[11px] text-atk hover:underline">
                                  Avalanche Fuji tx {check.chain_tx} ↗
                                </a>
                              ) : (
                                <div className="mt-1 text-[11px] text-ink-500">{check.chain_error ? `Zincir kaydı başarısız: ${check.chain_error}` : "Zincire henüz yazılmadı"}</div>
                              )}
                              {check.chain_tx && <VerifyOnChain key={check.id} checkId={check.id} />}
                            </div>
                          )}
                        </>
                      }
                    />
                  )}
                </Card>
              </div>
            </>
          )}

          <Card title="Denetim geçmişi">
            {checks.length === 0 ? (
              <Empty>Henüz denetim yok.</Empty>
            ) : (
              <div className="divide-y divide-ink-700">
                {checks.map((c) => (
                  <button key={c.id} onClick={() => setSelected(c.id)} className={`flex w-full flex-wrap items-center gap-3 px-1 py-2.5 text-left text-[13px] hover:bg-ink-800/50 ${c.id === selected ? "bg-ink-800/60" : ""}`}>
                    <span className="num w-20 shrink-0 text-[11px] text-ink-400">{timeAgo(c.created_at)}</span>
                    <span className={c.proposal.side === "buy" ? "text-up" : "text-down"}>{c.proposal.side === "buy" ? "ALIM" : "SATIM"}</span>
                    <span className="num text-ink-100">{c.proposal.instId}</span>
                    <span className="num text-ink-300">{c.proposal.notionalUsd} $</span>
                    <span className="ml-auto flex items-center gap-2">
                      {c.status === "running" ? <Badge tone="signal">çalışıyor</Badge> : c.status === "error" ? <Badge tone="down">hata</Badge> : <DecisionBadge decision={c.final_decision ?? c.decision} />}
                      {c.decided_by === "insan" && <Badge tone="judge">insan</Badge>}
                      {o && c.created_at < o.trustSince && <Badge>önceki demo</Badge>}
                      {c.chain_tx && <Badge tone="atk">⛓ Fuji</Badge>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
