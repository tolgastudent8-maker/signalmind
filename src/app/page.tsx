"use client";

import { useEffect, useState } from "react";
import { Badge, Card, Empty, usePoll, timeAgo } from "@/components/ui";
import { DecisionBadge, ProposalCard, Timeline, VerdictPanel, type GuardEvent } from "@/components/guard";
import type { CheckRow } from "@/lib/guard/queries";
import type { Trust } from "@/lib/guard/policy";
import type { ChainInfo } from "@/lib/guard/agent";

type Overview = {
  bot: string;
  trust: Trust;
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

  async function run(scenario: string) {
    setBusy(scenario);
    setError(null);
    const res = await fetch("/api/guard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }) });
    const b = await res.json();
    setBusy(null);
    if (!res.ok) return setError(b.error ?? "Denetim başlatılamadı");
    setSelected(b.id);
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
            {error && <div className="mt-3 rounded-lg bg-down/10 px-3 py-2 text-[12.5px] text-down ring-1 ring-down/30">{error}</div>}
          </Card>
          {o && (
            <Card title="Kanıtla büyüyen yetki">
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
                                <a href={`${chain?.explorerBase ?? "https://testnet.snowtrace.io"}/tx/${check.chain_tx}`} target="_blank" rel="noreferrer" className="num mt-1 block break-all text-[11px] text-atk hover:underline">
                                  Avalanche Fuji tx {check.chain_tx} ↗
                                </a>
                              ) : (
                                <div className="mt-1 text-[11px] text-ink-500">{check.chain_error ? `Zincir kaydı başarısız: ${check.chain_error}` : "Zincire henüz yazılmadı"}</div>
                              )}
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
