"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CommandPalette, PaletteButton } from "./command-palette";
import { TickerTape } from "./market";
import { usePoll, fmtPrice, timeAgo } from "./ui";

type Status = {
  ai: { provider: "claude" | "gemini"; label: string; model: string; configured: boolean };
  gemini: { model: string; exhaustedUntil: number | null }[] | null;
  atk: { connected: boolean; tools: number; lastError?: string };
  dataSource: "atk" | "rest" | null;
  btc: number | null;
  scheduler: { lastEval?: number; lastFeed?: number; lastError?: string };
};

const NAV = [
  { href: "/", label: "Komuta Merkezi" },
  { href: "/karne", label: "Tahmin Karnesi" },
  { href: "/tokenlar", label: "Tokenlar" },
  { href: "/sistem", label: "Sistem" },
];

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  const tr = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Istanbul" });
  const utc = now.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return (
    <span className="num hidden items-center gap-2 rounded-md bg-ink-850 px-2 py-1 ring-1 ring-ink-700 xl:inline-flex">
      <span className="text-ink-100">{tr}</span>
      <span className="text-ink-500">TRT</span>
      <span className="text-ink-400">{utc}</span>
      <span className="text-ink-500">UTC</span>
    </span>
  );
}

function Dot({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? (warn ? "bg-judge" : "bg-up") : "bg-down"}`} />;
}

function GeminiQuota({ models }: { models: { model: string; exhaustedUntil: number | null }[] }) {
  const ready = models.filter((m) => !m.exhaustedUntil).length;
  const nextOpen = Math.min(...models.map((m) => m.exhaustedUntil ?? Infinity));
  const fmt = (t: number) => new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const detail = models.map((m) => `${m.model}: ${m.exhaustedUntil ? `kota doldu (açılış ${fmt(m.exhaustedUntil)})` : "hazır"}`).join("\n");
  return (
    <span title={detail} className="inline-flex cursor-help items-center gap-1.5 rounded-md bg-ink-850 px-2 py-1 ring-1 ring-ink-700">
      <Dot ok={ready > 0} warn={ready > 0 && ready < models.length} />
      <span className="text-ink-300">Kota</span>
      <span className="num text-ink-100">
        {ready}/{models.length} model
        {ready === 0 && Number.isFinite(nextOpen) ? ` · ${fmt(nextOpen)}` : ""}
      </span>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { data: s } = usePoll<Status>("/api/status", 15000);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b hairline bg-ink-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="relative grid h-8 w-8 place-items-center rounded-lg bg-signal text-ink-950">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M3 12h3l3-7 4 14 3-7h5" />
              </svg>
            </span>
            <span className="font-display text-[17px] font-semibold tracking-tight">
              SignalMind <span className="text-signal">AI</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-ink-800 text-ink-100" : "text-ink-300 hover:text-ink-100"}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2 text-[11px]">
            <PaletteButton />
            <Clock />
            <span className="hidden items-center gap-1.5 rounded-md bg-ink-850 px-2 py-1 ring-1 ring-ink-700 lg:inline-flex">
              <Dot ok={Boolean(s?.atk.connected)} />
              <span className="text-ink-300">ATK MCP</span>
              <span className="text-ink-100">{s ? (s.atk.connected ? `${s.atk.tools} araç · OKX TR` : "bağlı değil") : "…"}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-ink-850 px-2 py-1 ring-1 ring-ink-700">
              <Dot ok={Boolean(s?.ai.configured)} />
              <span className="text-ink-300">{s?.ai.label ?? "AI"}</span>
              <span className="text-ink-100">{s ? (s.ai.configured ? (s.gemini ? "ücretsiz katman" : s.ai.model) : "anahtar yok") : "…"}</span>
            </span>
            {s?.ai.configured && s.gemini && <GeminiQuota models={s.gemini} />}
            <span className="inline-flex items-center gap-1.5 rounded-md bg-ink-850 px-2 py-1 ring-1 ring-ink-700">
              <span className="text-ink-300">BTC</span>
              <span className="num text-ink-100">{s?.btc ? `$${fmtPrice(s.btc)}` : "…"}</span>
            </span>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm ${path === n.href ? "bg-ink-800" : "text-ink-300"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <TickerTape />
      </header>
      {s && !s.ai.configured && (
        <div className="border-b border-judge/30 bg-judge/10">
          <div className="mx-auto max-w-[1440px] px-4 py-2.5 text-sm text-judge sm:px-6">
            Yapay zekâ API anahtarı tanımlı değil — ajanlar çalışmaz. <code className="num rounded bg-ink-900 px-1.5 py-0.5 text-xs">.env.local</code> dosyasına{" "}
            <code className="num rounded bg-ink-900 px-1.5 py-0.5 text-xs">GEMINI_API_KEY=…</code> (ücretsiz) ya da{" "}
            <code className="num rounded bg-ink-900 px-1.5 py-0.5 text-xs">ANTHROPIC_API_KEY=…</code> ekleyip sunucuyu yeniden başlatın. Haber akışı, piyasa verisi ve karne anahtarsız çalışır.
          </div>
        </div>
      )}
      <main className="mx-auto max-w-[1440px] px-4 py-6 pb-14 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-[1440px] px-4 pb-12 pt-2 text-xs text-ink-400 sm:px-6">
        SignalMind bir karar destek aracıdır; yatırım tavsiyesi değildir ve emir göndermez. Piyasa verisi OKX Agent Trade Kit (salt okunur) üzerinden OKX TR&apos;den alınır.
      </footer>
      <CommandPalette />
      <div className="num fixed inset-x-0 bottom-0 z-30 border-t hairline bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 overflow-x-auto whitespace-nowrap px-4 py-1.5 text-[10.5px] text-ink-400 sm:px-6">
          <span className="flex items-center gap-1.5">
            <Dot ok={Boolean(s?.atk.connected)} /> veri: {s?.dataSource === "atk" ? "ATK MCP" : s?.dataSource === "rest" ? "OKX REST (yedek)" : "…"}
          </span>
          <span>puanlama: {s?.scheduler.lastEval ? timeAgo(s.scheduler.lastEval) : "bekleniyor"}</span>
          <span>rss: {s?.scheduler.lastFeed ? timeAgo(s.scheduler.lastFeed) : "bekleniyor"}</span>
          {s?.scheduler.lastError && <span className="text-down">hata: {s.scheduler.lastError.slice(0, 80)}</span>}
          <Link href="/sistem" className="ml-auto text-ink-500 hover:text-ink-200">
            sistem durumu →
          </Link>
        </div>
      </div>
    </div>
  );
}
