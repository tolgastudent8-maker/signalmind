"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { StoryRow } from "@/lib/news";
import { Badge, Empty, timeAgo } from "./ui";
import { tagTokens } from "@/lib/tagging";

const RANGES = [
  { id: 2, label: "2s" },
  { id: 6, label: "6s" },
  { id: 24, label: "24s" },
  { id: 72, label: "3g" },
  { id: 0, label: "tümü" },
] as const;

const PAGE = 30;

export function NewsFeed({
  news,
  sources,
  universe,
  filter,
  setFilter,
  busy,
  onAnalyze,
}: {
  news: StoryRow[] | null;
  sources: { source: string; lang: "en" | "tr" }[];
  universe: Set<string>;
  filter: string;
  setFilter: (v: string) => void;
  busy: string | null;
  onAnalyze: (newsId: string, mode: "live" | "backtest") => void;
}) {
  const [lang, setLang] = useState<"all" | "en" | "tr">("all");
  const [source, setSource] = useState("");
  const [range, setRange] = useState<number>(24);
  const [multiOnly, setMultiOnly] = useState(false);
  const [visible, setVisible] = useState(PAGE);

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const cutoff = range ? Date.now() - range * 3_600_000 : 0;
    return (news ?? []).filter((n) => {
      if (lang !== "all" && !n.sources.some((x) => x.lang === lang)) return false;
      if (source && !n.sources.some((x) => x.source === source)) return false;
      if (multiOnly && new Set(n.sources.map((x) => x.source)).size < 2) return false;
      if (cutoff && (n.published_at ?? n.fetched_at) < cutoff) return false;
      if (q && !`${n.title} ${n.summary} ${n.sources.map((x) => x.title).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [news, lang, source, range, multiOnly, filter]);

  const shown = items.slice(0, visible);
  const chip = (active: boolean) => `rounded-md px-2 py-1 text-[11px] ${active ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`;

  return (
    <div>
      <input
        value={filter}
        onChange={(e) => {
          setFilter(e.target.value);
          setVisible(PAGE);
        }}
        placeholder="Haberlerde ara (ör. ETF, Solana, hack)"
        className="mb-3 w-full rounded-lg bg-ink-900 px-3 py-2 text-sm outline-none ring-1 ring-ink-700 focus:ring-ink-500"
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-ink-900 p-0.5 ring-1 ring-ink-800">
          {(
            [
              ["all", "Tümü"],
              ["en", "EN"],
              ["tr", "TR"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} onClick={() => (setLang(id), setVisible(PAGE))} className={chip(lang === id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg bg-ink-900 p-0.5 ring-1 ring-ink-800">
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => (setRange(r.id), setVisible(PAGE))} className={`num ${chip(range === r.id)}`}>
              {r.label}
            </button>
          ))}
        </div>
        <select
          value={source}
          onChange={(e) => (setSource(e.target.value), setVisible(PAGE))}
          className="rounded-lg bg-ink-900 px-2 py-1 text-[11px] text-ink-200 outline-none ring-1 ring-ink-800"
          aria-label="Kaynak süzgeci"
        >
          <option value="">Tüm kaynaklar ({sources.length})</option>
          {sources.map((s) => (
            <option key={s.source} value={s.source}>
              {s.source} · {s.lang.toUpperCase()}
            </option>
          ))}
        </select>
        <button onClick={() => (setMultiOnly((v) => !v), setVisible(PAGE))} aria-pressed={multiOnly} className={`rounded-lg px-2 py-1 text-[11px] ring-1 ${multiOnly ? "bg-atk/10 text-atk ring-atk/30" : "text-ink-400 ring-ink-800 hover:text-ink-100"}`}>
          yalnız çok kaynaklı
        </button>
        <span className="num ml-auto text-[11px] text-ink-500">
          {items.length} hikâye{news ? ` / ${news.length}` : ""}
        </span>
      </div>

      {!news ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="shimmer h-16 rounded-xl bg-ink-850" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty>Bu süzgeçlerle haber yok. Zaman aralığını genişletin ya da “RSS yenile” ile {sources.length} kaynağı çekin.</Empty>
      ) : (
        <>
          <ul className="-mx-2 max-h-[1150px] divide-y divide-ink-800 overflow-y-auto">
            {shown.map((n) => {
              const canBacktest = n.published_at !== null && Date.now() - n.published_at > 3_600_000;
              const tokens = tagTokens(`${n.title} ${n.sources.map((x) => x.title).join(" ")}`, universe);
              const outlets = [...new Set(n.sources.map((x) => x.source))];
              return (
                <li key={n.id} className="group px-2 py-3.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
                    <span className="font-semibold text-ink-200">{n.source}</span>
                    <span className="num rounded bg-ink-800 px-1 text-[9.5px] text-ink-400">{n.lang.toUpperCase()}</span>
                    <span>·</span>
                    <span>{timeAgo(n.published_at ?? n.fetched_at)}</span>
                    {outlets.length > 1 && (
                      <Badge tone="atk" className="cursor-help">
                        <span title={n.sources.map((x) => `${x.source}: ${x.title}`).join("\n")}>
                          {outlets.length} kaynak · {outlets.slice(0, 3).join(", ")}
                          {outlets.length > 3 ? "…" : ""}
                        </span>
                      </Badge>
                    )}
                    {n.analysis_status === "running" && <Badge tone="signal">analiz sürüyor</Badge>}
                    {tokens.length > 0 && (
                      <span className="ml-auto flex gap-1">
                        {tokens.map((t) => (
                          <Link key={t} href={`/token/${t}`} className="num rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-200 ring-1 ring-ink-700 hover:text-signal">
                            {t}
                          </Link>
                        ))}
                      </span>
                    )}
                  </div>
                  <div className="text-[15px] font-medium leading-snug text-ink-100">{n.title}</div>
                  {n.summary && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-300">{n.summary}</p>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {n.analysis_id ? (
                      <Link href={`/analiz/${n.analysis_id}`} className="rounded-lg bg-ink-800 px-3 py-1 text-xs font-medium text-ink-100 ring-1 ring-ink-600 hover:bg-ink-700">
                        Analizi aç →
                      </Link>
                    ) : null}
                    <button
                      onClick={() => onAnalyze(n.id, "live")}
                      disabled={busy !== null}
                      className="rounded-lg bg-signal px-3 py-1 text-xs font-semibold text-ink-950 hover:bg-signal-dim disabled:opacity-50"
                    >
                      {busy === `${n.id}:live` ? "Başlatılıyor…" : n.analysis_id ? "Yeniden analiz" : "Analiz et"}
                    </button>
                    {canBacktest && (
                      <button
                        onClick={() => onAnalyze(n.id, "backtest")}
                        disabled={busy !== null}
                        title="Yalnızca haber anına kadarki piyasa verisiyle analiz edip hemen puanlar"
                        className="rounded-lg px-3 py-1 text-xs text-ink-200 ring-1 ring-ink-600 hover:bg-ink-800 disabled:opacity-50"
                      >
                        {busy === `${n.id}:backtest` ? "Başlatılıyor…" : "Geriye dönük test"}
                      </button>
                    )}
                    {n.url && (
                      <a href={n.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-ink-400 hover:text-ink-200">
                        kaynak ↗
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {items.length > visible && (
            <button onClick={() => setVisible((v) => v + PAGE)} className="mt-3 w-full rounded-lg bg-ink-900 py-2 text-xs text-ink-200 ring-1 ring-ink-700 hover:bg-ink-850">
              Daha fazla göster · {items.length - visible} hikâye kaldı
            </button>
          )}
        </>
      )}
    </div>
  );
}
