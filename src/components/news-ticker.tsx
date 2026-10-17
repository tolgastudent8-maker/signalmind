"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePoll } from "./ui";
import type { StoryRow } from "@/lib/news";
import type { UniverseToken } from "@/lib/market";
import { tagTokens } from "@/lib/tagging";

/** Only stories younger than this run in the band: it is a "breaking news" band. */
const WINDOW_MS = 60 * 60_000;

/** Coins a story is about, from every outlet's headline and summary. */
function storyCoins(s: StoryRow, uni: Set<string>): string[] {
  const found = new Set<string>();
  for (const x of s.sources) for (const c of tagTokens(x.title, uni)) found.add(c);
  if (s.summary) for (const c of tagTokens(s.summary, uni)) found.add(c);
  return [...found].slice(0, 4);
}

/**
 * Breaking-news band under the price ticker: archive stories from the last 60 minutes
 * (pulled every 5 minutes on the server, polled here every minute), each with its coins.
 */
export function NewsTicker() {
  const { data } = usePoll<{ news: StoryRow[] }>("/api/news?limit=60", 60_000);
  const uniData = usePoll<{ tokens: UniverseToken[] }>("/api/universe", 0);
  const uni = useMemo(() => new Set((uniData.data?.tokens ?? []).map((t) => t.symbol)), [uniData.data]);

  const now = Date.now();
  const items = (data?.news ?? [])
    .map((s) => ({ s, t: s.published_at ?? s.fetched_at }))
    .filter(({ t }) => now - t >= 0 && now - t < WINDOW_MS)
    .slice(0, 24);
  if (!data) return null;
  const breaking = items.length > 0;

  // A short list is repeated so the band stays full while it scrolls.
  const loop = items.length && items.length < 6 ? Array.from({ length: Math.ceil(6 / items.length) }, () => items).flat() : items;
  const row = (copy: string) =>
    loop.map(({ s, t }, i) => {
      const outlets = new Set(s.sources.map((x) => x.source)).size;
      const coins = storyCoins(s, uni);
      const url = s.sources.find((x) => x.url)?.url ?? null;
      const mins = Math.max(0, Math.floor((now - t) / 60_000));
      return (
        <span key={`${s.story_id}-${copy}-${i}`} className="flex shrink-0 items-center gap-2 px-5 text-[12px]">
          <span className={`num text-[10.5px] font-semibold ${mins < 15 ? "text-down" : "text-ink-400"}`}>{mins === 0 ? "şimdi" : `${mins} dk`}</span>
          {coins.length ? (
            coins.map((c) => (
              <Link key={c} href={`/token/${c}`} tabIndex={copy === "b" ? -1 : undefined} className="num rounded bg-[#a78bfa]/15 px-1.5 py-px text-[10px] font-semibold text-[#c4b5fd] ring-1 ring-inset ring-[#a78bfa]/40">
                {c}
              </Link>
            ))
          ) : (
            <span className="num rounded bg-ink-800 px-1.5 py-px text-[10px] text-ink-400 ring-1 ring-inset ring-ink-600" title="Belirli bir coin anılmıyor">
              GENEL
            </span>
          )}
          {outlets >= 2 && <span className="num rounded bg-up/10 px-1.5 py-px text-[10px] text-up ring-1 ring-up/30">✓ {outlets} yayın</span>}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" tabIndex={copy === "b" ? -1 : undefined} className="text-ink-100 hover:underline">
              {s.title}
            </a>
          ) : (
            <span className="text-ink-100">{s.title}</span>
          )}
          <span className="num text-[10.5px] text-ink-500">{s.source}</span>
          <span className="pl-3 text-ink-600">◆</span>
        </span>
      );
    });

  return (
    <div className="ticker group relative flex h-9 items-center overflow-hidden border-b hairline bg-ink-900/70">
      <Link href="/haberler" className="relative z-10 flex h-full shrink-0 items-center gap-2 border-r hairline bg-ink-950 px-3 text-[10.5px] font-bold tracking-[0.16em]" title="Son 60 dakikanın haberleri">
        <span className={`h-1.5 w-1.5 rounded-full ${breaking ? "pulse-ring bg-down" : "bg-ink-500"}`} />
        <span className={breaking ? "text-down" : "text-ink-400"}>SON DAKİKA</span>
      </Link>
      {!breaking ? (
        <span className="px-4 text-[12px] text-ink-400">Son 60 dakikada yeni haber yok · kaynaklar 5 dakikada bir yenileniyor</span>
      ) : (
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {/* Two identical copies make the -50% translate loop seamless; slower than prices (longer text). */}
        <div className="ticker-track flex" style={{ animationDuration: `${Math.max(45, loop.length * 8)}s` }}>
          {row("a")}
          <div className="flex" aria-hidden>
            {row("b")}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ink-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-ink-900 to-transparent" />
      </div>
      )}
    </div>
  );
}
