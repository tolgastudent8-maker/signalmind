"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePoll, timeAgo } from "./ui";
import type { StoryRow } from "@/lib/news";
import type { UniverseToken } from "@/lib/market";
import { tagTokens } from "@/lib/tagging";

/** Under this age a story is flagged "SON DAKİKA". */
const BREAKING_MS = 30 * 60_000;
const WINDOW_MS = 24 * 3_600_000;

/**
 * Scrolling headline band under the price ticker: the archive's latest stories (refreshed
 * every 5 minutes on the server, polled here every minute), breaking ones flagged first.
 */
export function NewsTicker() {
  const { data } = usePoll<{ news: StoryRow[] }>("/api/news?limit=60", 60_000);
  const uniData = usePoll<{ tokens: UniverseToken[] }>("/api/universe", 0);
  const uni = useMemo(() => new Set((uniData.data?.tokens ?? []).map((t) => t.symbol)), [uniData.data]);

  const now = Date.now();
  const items = (data?.news ?? [])
    .map((s) => ({ s, t: s.published_at ?? s.fetched_at }))
    .filter(({ t }) => now - t < WINDOW_MS)
    .slice(0, 24);
  if (!items.length) return null;
  const breaking = items.some(({ t }) => now - t < BREAKING_MS);

  const row = (copy: string) =>
    items.map(({ s, t }) => {
      const fresh = now - t < BREAKING_MS;
      const outlets = new Set(s.sources.map((x) => x.source)).size;
      const coins = [...new Set(s.sources.flatMap((x) => tagTokens(x.title, uni)))].slice(0, 3);
      const url = s.sources.find((x) => x.url)?.url ?? null;
      return (
        <span key={`${s.story_id}-${copy}`} className="flex shrink-0 items-center gap-2 px-5 text-[12px]">
          {fresh && <span className="rounded bg-down/15 px-1.5 py-px text-[10px] font-bold tracking-wider text-down ring-1 ring-down/40">SON DAKİKA</span>}
          {outlets >= 2 && <span className="num rounded bg-up/10 px-1.5 py-px text-[10px] text-up ring-1 ring-up/30">✓ {outlets} yayın</span>}
          {coins.map((c) => (
            <Link key={c} href={`/token/${c}`} tabIndex={copy === "b" ? -1 : undefined} className="num rounded bg-[#a78bfa]/15 px-1.5 py-px text-[10px] font-semibold text-[#c4b5fd] ring-1 ring-inset ring-[#a78bfa]/40">
              {c}
            </Link>
          ))}
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" tabIndex={copy === "b" ? -1 : undefined} className={`hover:underline ${fresh ? "text-ink-100" : "text-ink-200"}`}>
              {s.title}
            </a>
          ) : (
            <span className="text-ink-200">{s.title}</span>
          )}
          <span className="num text-[10.5px] text-ink-500">
            {s.source} · {timeAgo(t)}
          </span>
          <span className="pl-3 text-ink-600">◆</span>
        </span>
      );
    });

  return (
    <div className="ticker group relative flex h-9 items-center overflow-hidden border-b hairline bg-ink-900/70">
      <Link href="/haberler" className="relative z-10 flex h-full shrink-0 items-center gap-2 border-r hairline bg-ink-950 px-3 text-[10.5px] font-bold tracking-[0.16em]">
        <span className={`h-1.5 w-1.5 rounded-full ${breaking ? "pulse-ring bg-down" : "bg-signal"}`} />
        <span className={breaking ? "text-down" : "text-signal"}>{breaking ? "SON DAKİKA" : "HABERLER"}</span>
      </Link>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        {/* Two identical copies make the -50% translate loop seamless; slower than prices (longer text). */}
        <div className="ticker-track flex" style={{ animationDuration: `${Math.max(60, items.length * 9)}s` }}>
          {row("a")}
          <div className="flex" aria-hidden>
            {row("b")}
          </div>
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-ink-900 to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-ink-900 to-transparent" />
      </div>
    </div>
  );
}
