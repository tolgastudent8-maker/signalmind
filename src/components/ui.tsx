"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DIR_LABEL, STATUS_LABEL } from "@/lib/labels";

export function usePoll<T>(url: string | null, intervalMs = 0): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!url) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (!alive.current) return;
        if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
        else {
          setData(body as T);
          setError(null);
        }
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : String(e));
      }
      if (intervalMs > 0 && alive.current) timer = setTimeout(load, intervalMs);
    };
    load();
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
    };
  }, [url, intervalMs, nonce]);
  return { data, error, reload: () => setNonce((n) => n + 1) };
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b hairline px-5 py-3.5">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-300">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Badge({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "signal" | "judge" | "atk"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-700/60 text-ink-200 ring-ink-600",
    up: "bg-up/10 text-up ring-up/30",
    down: "bg-down/10 text-down ring-down/30",
    signal: "bg-signal/10 text-signal ring-signal/30",
    judge: "bg-judge/10 text-judge ring-judge/30",
    atk: "bg-atk/10 text-atk ring-atk/30",
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tones[tone]} ${className}`}>{children}</span>;
}

export function DirPill({ dir, size = "sm" }: { dir: string; size?: "sm" | "lg" }) {
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "◆";
  const tone = dir === "up" ? "text-up bg-up/10 ring-up/30" : dir === "down" ? "text-down bg-down/10 ring-down/30" : "text-flat bg-flat/10 ring-flat/30";
  const sz = size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md font-semibold ring-1 ring-inset ${tone} ${sz}`}>
      <span className="text-[0.8em]">{arrow}</span>
      {DIR_LABEL[dir] ?? dir}
    </span>
  );
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, "up" | "down" | "neutral" | "judge"> = { correct: "up", wrong: "down", pending: "judge", nodata: "neutral" };
  return <Badge tone={map[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function Pct({ value, digits = 2, signed = true, className = "" }: { value: number | null | undefined; digits?: number; signed?: boolean; className?: string }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className={`num text-ink-400 ${className}`}>—</span>;
  const color = !signed ? "" : value > 0 ? "text-up" : value < 0 ? "text-down" : "text-ink-300";
  const s = `${signed && value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
  return <span className={`num ${color} ${className}`}>{s}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const v = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-700">
        <div className="h-full rounded-full bg-signal" style={{ width: `${v}%` }} />
      </div>
      <span className="num text-xs text-ink-200">{v}%</span>
    </div>
  );
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "zaman bilinmiyor";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "az önce";
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  const digits = p >= 1000 ? 1 : p >= 1 ? 3 : p >= 0.01 ? 5 : 8;
  return p.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) });
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-ink-600 px-5 py-8 text-center text-sm text-ink-300">{children}</div>;
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</div>
      <div className={`mt-1.5 font-display text-3xl font-semibold ${accent ? "text-signal" : "text-ink-100"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-300">{hint}</div>}
    </div>
  );
}
