"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Card, usePoll } from "./ui";
import type { BatchItem } from "@/lib/batch";

type Batch = { items: BatchItem[]; active: boolean; stopReason?: string; candidates: number };

const TONE: Record<BatchItem["status"], "neutral" | "signal" | "up" | "down" | "judge"> = {
  queued: "neutral",
  running: "signal",
  done: "up",
  error: "down",
  skipped: "judge",
};
const LABEL: Record<BatchItem["status"], string> = { queued: "sırada", running: "çalışıyor", done: "tamam", error: "hata", skipped: "atlandı" };

export function BatchPanel({ onFinished }: { onFinished: () => void }) {
  const [count, setCount] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [interval, setIntervalMs] = useState(0);
  const { data, reload } = usePoll<Batch>("/api/batch", interval);
  const wasActive = useRef(false);

  useEffect(() => {
    if (!data) return;
    setIntervalMs(data.active ? 3000 : 0);
    if (wasActive.current && !data.active) onFinished();
    wasActive.current = data.active;
  }, [data, onFinished]);

  async function send(body: object) {
    setError(null);
    const res = await fetch("/api/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json();
    if (!res.ok) setError(b.error ?? "Başlatılamadı");
    reload();
    setIntervalMs(3000);
  }

  const done = data?.items.filter((i) => i.status === "done").length ?? 0;

  return (
    <Card
      title="Toplu geriye dönük test"
      action={
        data?.active ? (
          <button onClick={() => send({ stop: true })} className="rounded-lg px-2.5 py-1 text-xs text-ink-200 ring-1 ring-ink-600 hover:bg-ink-800">
            Durdur
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="rounded-lg bg-ink-900 px-2 py-1 text-xs ring-1 ring-ink-600 outline-none"
            >
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} haber
                </option>
              ))}
            </select>
            <button
              onClick={() => send({ count })}
              disabled={!data?.candidates}
              className="rounded-lg bg-signal px-3 py-1 text-xs font-semibold text-ink-950 hover:bg-signal-dim disabled:opacity-40"
            >
              Başlat
            </button>
          </div>
        )
      }
    >
      <p className="text-sm text-ink-300">
        Henüz test edilmemiş en güncel haberleri, yalnız haber anına kadarki piyasa verisiyle sırayla analiz eder ve ufku dolan tahminleri hemen puanlar.
        Uygun haber: <span className="num text-ink-100">{data?.candidates ?? "…"}</span>. Her analiz yaklaşık 8–10 yapay zekâ isteği kullanır.
      </p>
      {error && <div className="mt-3 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-sm text-down">{error}</div>}
      {data && data.items.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-xs text-ink-400">
            <span>
              {done}/{data.items.length} tamamlandı
            </span>
            {data.stopReason && <span className="text-judge">{data.stopReason}</span>}
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink-800">
            <div className="h-full bg-signal transition-all" style={{ width: `${(done / data.items.length) * 100}%` }} />
          </div>
          <ul className="space-y-1.5">
            {data.items.map((i) => (
              <li key={i.newsId} className="flex items-start gap-2 text-[13px]">
                <Badge tone={TONE[i.status]} className="mt-0.5 shrink-0">
                  {LABEL[i.status]}
                </Badge>
                <div className="min-w-0">
                  {i.analysisId ? (
                    <Link href={`/analiz/${i.analysisId}`} className="line-clamp-1 text-ink-200 hover:text-signal">
                      {i.title}
                    </Link>
                  ) : (
                    <span className="line-clamp-1 text-ink-300">{i.title}</span>
                  )}
                  {i.error && <div className="line-clamp-2 text-xs text-down">{i.error}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
