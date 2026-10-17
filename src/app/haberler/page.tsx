"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, Empty, usePoll, timeAgo } from "@/components/ui";
import type { StoryRow } from "@/lib/news";
import type { UniverseToken } from "@/lib/market";
import { tagTokens } from "@/lib/tagging";

/** Coins a story is about: tagged from every outlet's headline, limited to tokens tradable on OKX TR. */
function storyCoins(s: StoryRow, uni: Set<string>): string[] {
  const found = new Set<string>();
  for (const x of s.sources) for (const t of tagTokens(x.title, uni)) found.add(t);
  return [...found].slice(0, 5);
}

/**
 * Guard's evidence archive: every story with the outlets that carried it.
 * Copies of the same event are grouped, so "how many independent outlets" is visible at a glance.
 */
export default function NewsArchive() {
  const news = usePoll<{ news: StoryRow[]; sources: { source: string; lang: "en" | "tr" }[] }>("/api/news", 60000);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");
  const uniData = usePoll<{ tokens: UniverseToken[] }>("/api/universe", 0);
  // The server pulls every RSS source every 5 minutes (scheduler); show when, and when next.
  const status = usePoll<{ scheduler: { lastFeed?: number } }>("/api/status", 30000);
  const lastFeed = status.data?.scheduler.lastFeed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const nextIn = lastFeed ? Math.max(0, lastFeed + 5 * 60_000 + 60_000 - now) : null; // tick runs each minute
  const uni = useMemo(() => new Set((uniData.data?.tokens ?? []).map((t) => t.symbol)), [uniData.data]);

  async function refresh() {
    setRefreshing(true);
    await fetch("/api/news?refresh=1", { cache: "no-store" }).catch(() => null);
    news.reload();
    setRefreshing(false);
  }

  const stories = (news.data?.news ?? []).filter((s) => !q || s.sources.some((x) => x.title.toLocaleLowerCase("tr-TR").includes(q.toLocaleLowerCase("tr-TR"))));
  const multi = stories.filter((s) => new Set(s.sources.map((x) => x.source)).size >= 2).length;

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-signal">Kanıt arşivi</div>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Haber arşivi</h1>
        <p className="mt-2 text-[14px] text-ink-300">
          Guard bir botun gerekçesini doğrularken bu arşivde ve OKX Agent Trade Kit haber modülünde arar. Aynı olayı aktaran yayınlar tek olayda toplanır; bir iddia ancak birbirinden bağımsız en az iki yayın organında geçiyorsa
          doğrulanmış sayılır.
        </p>
        <p className="num mt-2 flex items-center gap-2 text-[12px] text-ink-400">
          <span className="pulse-ring h-1.5 w-1.5 rounded-full bg-up" />
          18 kaynak 5 dakikada bir otomatik yenilenir
          {lastFeed && <> · son güncelleme {timeAgo(lastFeed)}</>}
          {nextIn !== null && <> · sonraki ≈ {nextIn > 0 ? `${Math.floor(nextIn / 60000)}:${String(Math.floor((nextIn % 60000) / 1000)).padStart(2, "0")}` : "şimdi"}</>}
        </p>
      </div>
      <Card
        title={`${stories.length} olay · ${multi} tanesi birden çok yayında`}
        action={
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara…" className="w-40 rounded-lg bg-ink-900 px-3 py-1.5 text-sm ring-1 ring-ink-700 outline-none focus:ring-signal/50" />
            <button onClick={refresh} disabled={refreshing} className="rounded-lg bg-ink-800 px-3 py-1.5 text-sm text-ink-100 ring-1 ring-ink-600 hover:bg-ink-700 disabled:opacity-50">
              {refreshing ? "Yenileniyor…" : "Kaynakları yenile"}
            </button>
          </div>
        }
      >
        {stories.length === 0 ? (
          <Empty>{news.data ? "Eşleşen haber yok." : "Yükleniyor…"}</Empty>
        ) : (
          <div className="divide-y divide-ink-700">
            {stories.slice(0, 80).map((s) => {
              const outlets = new Set(s.sources.map((x) => x.source)).size;
              const coins = storyCoins(s, uni);
              return (
                <div key={s.story_id} className="py-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="min-w-0 flex-1 text-[14px] text-ink-100">{s.title}</span>
                    {coins.map((c) => (
                      <Link
                        key={c}
                        href={`/token/${c}`}
                        title={`${c} sayfasını aç`}
                        className="num rounded-md bg-[#a78bfa]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#c4b5fd] ring-1 ring-inset ring-[#a78bfa]/40 hover:bg-[#a78bfa]/25"
                      >
                        {c}
                      </Link>
                    ))}
                    <Badge tone={outlets >= 2 ? "up" : "neutral"}>{outlets} yayın</Badge>
                    <span className="text-[11px] text-ink-400">{timeAgo(s.published_at ?? s.fetched_at)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.sources.map((x) =>
                      x.url ? (
                        <a key={x.id} href={x.url} target="_blank" rel="noreferrer" className="rounded bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-300 ring-1 ring-ink-700 hover:text-ink-100">
                          {x.source}
                        </a>
                      ) : (
                        <span key={x.id} className="rounded bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-300 ring-1 ring-ink-700">
                          {x.source}
                        </span>
                      ),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
