"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { NewsFeed } from "@/components/news-feed";
import { TurkeyCard } from "@/components/turkey-card";
import { AutopilotCard } from "@/components/autopilot-card";
import { Heatmap } from "@/components/market";
import { ImpactMatrix } from "@/components/impact-matrix";
import { Badge, Card, Empty, Stat, usePoll, timeAgo, DirPill } from "@/components/ui";
import { EVENT_LABEL, WINNER_LABEL } from "@/lib/labels";
import type { FeedResult, StoryRow } from "@/lib/news";
import type { AnalysisSummary } from "@/lib/queries";
import type { Stats } from "@/lib/scorecard";

type NewsRow = StoryRow;

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `%${Math.round(x * 100)}`);

export default function Home() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const onFilter = (e: Event) => setFilter(String((e as CustomEvent).detail ?? ""));
    window.addEventListener("signalmind:filter", onFilter);
    return () => window.removeEventListener("signalmind:filter", onFilter);
  }, []);

  const news = usePoll<{ news: NewsRow[]; sources: { source: string; lang: "en" | "tr" }[] }>("/api/news", 60000);
  const uni = usePoll<{ tokens: { symbol: string }[] }>("/api/universe", 300000);
  const universe = useMemo(() => new Set((uni.data?.tokens ?? []).map((t) => t.symbol)), [uni.data]);
  const [feedReport, setFeedReport] = useState<FeedResult[] | null>(null);
  const analyses = usePoll<{ analyses: AnalysisSummary[]; failed: number }>("/api/analyze", 8000);
  const score = usePoll<{ stats: Stats }>("/api/scorecard", 30000);

  async function refresh() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/news?refresh=1", { cache: "no-store" }).then((x) => x.json());
      setFeedReport(r.feeds ?? null);
    } finally {
      news.reload();
      setRefreshing(false);
    }
  }

  async function analyze(newsId: string, mode: "live" | "backtest") {
    setBusy(`${newsId}:${mode}`);
    setError(null);
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newsId, mode }) });
    const b = await res.json();
    setBusy(null);
    if (!res.ok) return setError(b.error ?? "Analiz başlatılamadı");
    router.push(`/analiz/${b.id}`);
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/news", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body, publishedAt: Date.now() }),
    });
    const b = await res.json();
    if (!res.ok) return setError(b.error);
    setTitle("");
    setBody("");
    setShowForm(false);
    news.reload();
    analyze(b.news.id, "live");
  }

  const s = score.data?.stats;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Haber gelir. Ajanlar tartışır. <span className="text-signal">Karne tutulur.</span>
        </h1>
        <p className="max-w-3xl text-sm text-ink-300">
          Her analiz; haberi ayrıştıran, OKX TR tokenlarına etkisini çıkaran, boğa ve ayı tezlerini tartıştıran ve ATK ile canlı piyasayı kontrol eden ajanlardan geçer.
          Tahminler sonuç belli olmadan kaydedilir ve gerçek fiyatla puanlanır.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="İsabet" value={pct(s?.accuracy)} hint={s ? `${s.correct}/${s.n} puanlanmış tahmin` : "…"} accent />
        <Stat label="Momentum kuralı" value={pct(s?.baselines.momentum)} hint="Aynı tahminlerde basit kural" />
        <Stat label="Brier skoru" value={s?.brier != null ? s.brier.toFixed(3) : "—"} hint="Düşük = daha iyi kalibrasyon" />
        <Stat label="Bekleyen" value={s?.pending ?? "—"} hint="Ufku dolmamış tahmin" />
      </div>

      {error && <div className="rounded-xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">{error}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card
          className="lg:col-span-7"
          title="Haber akışı"
          action={
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm((v) => !v)} className="rounded-lg px-2.5 py-1 text-xs text-ink-200 ring-1 ring-ink-600 hover:bg-ink-800">
                + Kendi haberin
              </button>
              <button onClick={refresh} disabled={refreshing} className="rounded-lg bg-ink-800 px-2.5 py-1 text-xs text-ink-100 ring-1 ring-ink-600 hover:bg-ink-700 disabled:opacity-50">
                {refreshing ? "Çekiliyor…" : "RSS yenile"}
              </button>
            </div>
          }
        >
          {showForm && (
            <form onSubmit={submitManual} className="rise mb-5 space-y-2.5 rounded-xl bg-ink-900 p-4 ring-1 ring-ink-700">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Başlık — örn. SEC, Solana spot ETF başvurusunu onayladı"
                className="w-full rounded-lg bg-ink-850 px-3 py-2 text-sm outline-none ring-1 ring-ink-600 focus:ring-signal"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Haber metni (isteğe bağlı)"
                className="w-full rounded-lg bg-ink-850 px-3 py-2 text-sm outline-none ring-1 ring-ink-600 focus:ring-signal"
              />
              <div className="flex justify-end">
                <button className="rounded-lg bg-signal px-3 py-1.5 text-sm font-semibold text-ink-950 hover:bg-signal-dim">Kaydet ve analiz et</button>
              </div>
            </form>
          )}
          {feedReport && (
            <div className="num mb-3 rounded-lg bg-ink-900 px-3 py-2 text-[11px] text-ink-400 ring-1 ring-ink-800">
              {feedReport.filter((f) => f.ok).length}/{feedReport.length} kaynak yanıt verdi ·{" "}
              {feedReport.reduce((a, f) => a + f.count, 0)} öğe okundu
              {feedReport.some((f) => !f.ok) && (
                <span className="text-down"> · yanıt vermeyen: {feedReport.filter((f) => !f.ok).map((f) => f.source).join(", ")}</span>
              )}
            </div>
          )}
          <NewsFeed
            news={news.data?.news ?? null}
            sources={news.data?.sources ?? []}
            universe={universe}
            filter={filter}
            setFilter={setFilter}
            busy={busy}
            onAnalyze={analyze}
          />
        </Card>

        <div className="space-y-6 lg:col-span-5">
          <Card title="Piyasa ısı haritası · 24s" action={<Link href="/tokenlar" className="text-xs text-ink-400 hover:text-ink-100">tümü →</Link>}>
            <Heatmap />
            <p className="mt-2 text-[11px] text-ink-500">Hacme göre en likit 24 OKX TR tokenı. Renk yoğunluğu ±%8&apos;de doygunlaşır.</p>
          </Card>

          <TurkeyCard />

          {analyses.data && analyses.data.analyses.some((a) => a.impacts.length) && (
            <Card title="Etki matrisi · token × analiz">
              <ImpactMatrix analyses={analyses.data.analyses} columns={8} rows={8} />
            </Card>
          )}

          <Card title="Son analizler" action={<Link href="/karne" className="text-xs text-signal hover:underline">Karne →</Link>}>
            {!analyses.data ? (
              <div className="shimmer h-24 rounded-xl bg-ink-850" />
            ) : analyses.data.analyses.length === 0 ? (
              <Empty>İlk analizi soldaki bir haberden başlatın.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {analyses.data.analyses.slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <Link href={`/analiz/${a.id}`} className="block rounded-xl bg-ink-900/60 p-3.5 ring-1 ring-ink-700 transition hover:bg-ink-850 hover:ring-ink-500">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        {a.status === "running" && (
                          <Badge tone="signal">
                            <span className="pulse-ring h-1.5 w-1.5 rounded-full bg-signal" /> çalışıyor
                          </Badge>
                        )}
                        {a.trigger === "auto" && <Badge tone="atk">otonom</Badge>}
                        {a.mode === "backtest" && <Badge tone="judge">geriye dönük</Badge>}
                        {a.event_type && <Badge>{EVENT_LABEL[a.event_type] ?? a.event_type}</Badge>}
                        {a.winner && <Badge tone={a.winner === "bull" ? "up" : a.winner === "bear" ? "down" : "neutral"}>{WINNER_LABEL[a.winner]}</Badge>}
                        <span className="ml-auto text-[11px] text-ink-400">{timeAgo(a.created_at)}</span>
                      </div>
                      <div className="line-clamp-2 text-sm font-medium text-ink-100">{a.headline ?? a.title}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {a.tokens.map((t) => (
                          <span key={t} className="num rounded bg-ink-800 px-1.5 py-0.5 text-ink-200">
                            {t}
                          </span>
                        ))}
                        {a.correct + a.wrong + a.pending > 0 && (
                          <span className="ml-auto flex gap-2">
                            <span className="text-up">✓ {a.correct}</span>
                            <span className="text-down">✗ {a.wrong}</span>
                            <span className="text-judge">⏳ {a.pending}</span>
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {analyses.data && analyses.data.failed > 0 && (
              <p className="mt-3 text-xs text-ink-500">{analyses.data.failed} başarısız analiz listede gösterilmiyor; ilgili haberden yeniden başlatılabilir.</p>
            )}
          </Card>

          <AutopilotCard />

          <Card title="Nasıl çalışır">
            <ol className="space-y-3 text-sm">
              {[
                ["News Analyst", "Haberi sınıflandırır, kaynağın güvenilirliğini puanlar, olguyu söylentiden ayırır."],
                ["Impact Radar", "OKX TR'de işlem gören 130+ token içinden etkilenenleri ve neden-sonuç zincirini çıkarır."],
                ["Bull vs Bear + Hakem", "İki ajan karşıt tezleri kanıtla savunur; hakem retoriğe değil kanıta göre puanlar."],
                ["Strategy & Risk", "ATK MCP araçlarıyla canlı mum, RSI ve emir defterine bakar; geçmiş karneye göre güvenini ayarlar."],
                ["Tahmin Karnesi", "Tahminler 1 saat ve 24 saat sonra gerçek fiyatla puanlanır; tutmayanlar da gösterilir."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="num grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-800 text-xs text-signal">{i + 1}</span>
                  <div>
                    <div className="font-medium text-ink-100">{t}</div>
                    <div className="text-ink-300">{d}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex items-center gap-2 text-xs text-ink-400">
              <DirPill dir="up" /> <DirPill dir="flat" /> <DirPill dir="down" />
              <span>1s için ±%0,4, 24s için ±%1,5 içi “yatay” sayılır.</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
