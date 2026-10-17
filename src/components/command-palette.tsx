"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { UniverseToken } from "@/lib/market";
import type { StoryRow } from "@/lib/news";
import type { AnalysisSummary } from "@/lib/queries";

type Item = { group: string; label: string; hint?: string; href: string; keywords: string };

const PAGES: Item[] = [
  { group: "Sayfa", label: "Komuta Merkezi", href: "/", keywords: "ana sayfa haber akış komuta" },
  { group: "Sayfa", label: "Tahmin Karnesi", href: "/karne", keywords: "karne isabet kalibrasyon brier" },
  { group: "Sayfa", label: "Tokenlar", href: "/tokenlar", keywords: "token evren liste" },
  { group: "Sayfa", label: "Sistem durumu", href: "/sistem", keywords: "sistem telemetri atk gecikme mimari" },
];

function score(item: Item, q: string): number {
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 60;
  if (label.includes(q)) return 30;
  if (item.keywords.includes(q)) return 10;
  return 0;
}

/** Ctrl/⌘+K (or "/") opens a keyboard-driven jump list over pages, tokens, stories and analyses. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [data, setData] = useState<{ tokens: UniverseToken[]; news: StoryRow[]; analyses: AnalysisSummary[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("signalmind:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("signalmind:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    setTimeout(() => input.current?.focus(), 0);
    Promise.all([
      fetch("/api/universe").then((r) => r.json()),
      fetch("/api/news").then((r) => r.json()),
      fetch("/api/analyze").then((r) => r.json()),
    ])
      .then(([u, n, a]) => setData({ tokens: u.tokens ?? [], news: n.news ?? [], analyses: a.analyses ?? [] }))
      .catch(() => setData({ tokens: [], news: [], analyses: [] }));
  }, [open]);

  const items = useMemo(() => {
    const all: Item[] = [...PAGES];
    for (const t of data?.tokens ?? [])
      all.push({ group: "Token", label: t.symbol, hint: `${t.change24h >= 0 ? "+" : ""}${(t.change24h * 100).toFixed(2)}%`, href: `/token/${t.symbol}`, keywords: t.symbol.toLowerCase() });
    for (const a of data?.analyses ?? [])
      all.push({ group: "Analiz", label: a.headline ?? a.title, hint: a.tokens.join(" "), href: `/analiz/${a.id}`, keywords: `${a.title} ${a.tokens.join(" ")}`.toLowerCase() });
    for (const n of data?.news ?? [])
      all.push({
        group: "Haber",
        label: n.title,
        hint: n.sources.length > 1 ? `${n.sources.length} kaynak` : n.source,
        href: n.analysis_id ? `/analiz/${n.analysis_id}` : `/?q=${encodeURIComponent(n.title.slice(0, 40))}`,
        keywords: `${n.title} ${n.summary}`.toLowerCase(),
      });
    const query = q.trim().toLowerCase();
    // Grouped results: fixed group order, best matches first within a group, capped per group.
    const ORDER = ["Sayfa", "Token", "Analiz", "Haber"];
    const CAP: Record<string, number> = query ? { Sayfa: 4, Token: 6, Analiz: 5, Haber: 8 } : { Sayfa: 4, Token: 4, Analiz: 3, Haber: 0 };
    const scored = all.map((it) => ({ it, s: score(it, query) })).filter((x) => x.s > 0);
    return ORDER.flatMap((g) =>
      scored
        .filter((x) => x.it.group === g)
        .sort((a, b) => b.s - a.s)
        .slice(0, CAP[g])
        .map((x) => x.it),
    );
  }, [data, q]);

  useEffect(() => setSel(0), [q]);

  function go(it: Item) {
    setOpen(false);
    if (it.href.startsWith("/?q=")) {
      // A story without an analysis: open the feed filtered to it.
      const query = decodeURIComponent(it.href.slice(4));
      router.push("/");
      setTimeout(() => window.dispatchEvent(new CustomEvent("signalmind:filter", { detail: query })), 50);
      return;
    }
    router.push(it.href);
  }

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/70 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Komut paleti"
        className="w-full max-w-xl overflow-hidden rounded-2xl bg-ink-900 shadow-2xl ring-1 ring-ink-600"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-ink-700 px-4">
          <span className="text-ink-500">⌕</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(items.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter" && items[sel]) go(items[sel]);
            }}
            placeholder="Token, haber, analiz veya sayfa ara…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-500"
            aria-activedescendant={items[sel] ? `cp-${sel}` : undefined}
          />
          <kbd className="num rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">esc</kbd>
        </div>
        <ul role="listbox" className="max-h-[55vh] overflow-y-auto py-2">
          {!data && <li className="px-4 py-3 text-sm text-ink-500">Yükleniyor…</li>}
          {data && items.length === 0 && <li className="px-4 py-3 text-sm text-ink-500">Sonuç yok.</li>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <li key={`${it.group}-${it.href}-${i}`}>
                {header && <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{it.group}</div>}
                <button
                  id={`cp-${i}`}
                  role="option"
                  aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(it)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === sel ? "bg-ink-800 text-ink-100" : "text-ink-200"}`}
                >
                  <span className={`min-w-0 flex-1 truncate ${it.group === "Token" ? "num font-semibold" : ""}`}>{it.label}</span>
                  {it.hint && (
                    <span className={`num shrink-0 text-[11px] ${it.group === "Token" ? (it.hint.startsWith("+") ? "text-up" : "text-down") : "text-ink-500"}`}>{it.hint}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="num flex gap-4 border-t border-ink-800 px-4 py-2 text-[10.5px] text-ink-500">
          <span>↑↓ gez</span>
          <span>↵ aç</span>
          <span>ctrl+k / “/” aç-kapa</span>
        </div>
      </div>
    </div>
  );
}

/** Small header button that opens the palette (for mouse users). */
export function PaletteButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("signalmind:palette"))}
      className="hidden items-center gap-2 rounded-md bg-ink-850 px-2 py-1 text-[11px] text-ink-400 ring-1 ring-ink-700 hover:text-ink-100 lg:inline-flex"
      aria-label="Komut paletini aç"
    >
      ⌕ Ara <kbd className="num rounded bg-ink-800 px-1 text-[10px]">Ctrl K</kbd>
    </button>
  );
}
