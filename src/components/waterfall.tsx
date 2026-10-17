"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AGENTS } from "@/lib/labels";
import type { EventRow } from "@/lib/queries";

/**
 * Execution timeline of one analysis: a bar per agent from its "start" to its
 * "done" event, with ATK tool calls as ticks on the Strategy row. Shows the
 * Bull ∥ Bear parallelism and where the time actually went.
 */
export function Waterfall({ events, start, end }: { events: EventRow[]; start: number; end: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (end) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [end]);

  const finish = end ?? now;
  const total = Math.max(1, finish - start);
  const rows = AGENTS.map((a) => {
    const s = events.find((e) => e.agent === a.id && e.kind === "start")?.ts;
    const d = [...events].reverse().find((e) => e.agent === a.id && e.kind === "done")?.ts;
    const tools = events.filter((e) => e.agent === a.id && e.kind === "tool").map((e) => e.ts);
    return { ...a, s, d, tools };
  });
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const fmt = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} sn`);

  return (
    <div className="num text-[11px]">
      <div className="relative ml-[120px] h-5 border-b border-ink-800">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 text-ink-500" style={{ left: `${t * 100}%` }}>
            {((t * total) / 1000).toFixed(0)}s
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-[120px] right-0">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-y-0 border-l border-dashed border-ink-800" style={{ left: `${t * 100}%` }} />
          ))}
        </div>
        {rows.map((r) => {
          const left = r.s ? ((r.s - start) / total) * 100 : 0;
          const width = r.s ? (((r.d ?? finish) - r.s) / total) * 100 : 0;
          return (
            <div key={r.id} className="relative flex h-8 items-center">
              <div className="w-[120px] shrink-0 truncate pr-3 font-sans text-[12px] text-ink-300">{r.name}</div>
              <div className="relative h-full flex-1">
                {r.s && (
                  <div
                    className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm ${r.d ? "" : "shimmer"}`}
                    style={{ left: `${left}%`, width: `${Math.max(0.6, width)}%`, background: r.color, opacity: r.d ? 0.85 : 0.5 }}
                    title={`${r.name}: ${fmt((r.d ?? finish) - r.s)}`}
                  />
                )}
                {r.s && r.d &&
                  (left + width > 86 ? (
                    // Bar reaches the right edge: label sits inside its end in dark ink.
                    <span className="absolute top-1/2 -translate-x-full -translate-y-1/2 pr-1.5 font-semibold text-ink-950" style={{ left: `${left + Math.max(0.6, width)}%` }}>
                      {fmt(r.d - r.s)}
                    </span>
                  ) : (
                    <span className="absolute top-1/2 -translate-y-1/2 pl-1.5 text-ink-400" style={{ left: `${left + width}%` }}>
                      {fmt(r.d - r.s)}
                    </span>
                  ))}
                {r.tools.map((ts, i) => (
                  <span
                    key={i}
                    className="absolute top-1 h-6 w-[2px] rounded bg-atk"
                    style={{ left: `${((ts - start) / total) * 100}%` }}
                    title={`ATK çağrısı · +${((ts - start) / 1000).toFixed(1)}s`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-ink-500">
        <span>
          toplam <span className="text-ink-200">{fmt(finish - start)}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-[2px] bg-atk" /> ATK çağrısı
        </span>
      </div>
    </div>
  );
}

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

/** Minimal JSON syntax colouring for one pretty-printed line: keys, strings, numbers, literals. */
function highlight(line: string) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    if (m[1]) {
      out.push(
        <span key={i} className={m[2] ? "text-atk" : "text-up"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3]) {
      out.push(
        <span key={i} className="text-judge">
          {m[3]}
        </span>,
      );
    } else if (m[4]) {
      out.push(
        <span key={i} className="text-bear">
          {m[4]}
        </span>,
      );
    }
    last = i + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Raw agent outputs, one tab per agent, with copy-to-clipboard. */
export function RawOutputs({ outputs }: { outputs: { id: string; label: string; data: unknown }[] }) {
  const available = outputs.filter((o) => o.data !== null && o.data !== undefined);
  const [active, setActive] = useState(available[0]?.id);
  const [copied, setCopied] = useState(false);
  const current = available.find((o) => o.id === active) ?? available[0];
  if (!current) return null;
  const json = JSON.stringify(current.data, null, 2);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {available.map((o) => (
          <button
            key={o.id}
            onClick={() => setActive(o.id)}
            className={`num rounded-md px-2 py-1 text-[11px] ${o.id === current.id ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
          >
            {o.label}
          </button>
        ))}
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(json);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable */
            }
          }}
          className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-400 ring-1 ring-ink-700 hover:text-ink-100"
        >
          {copied ? "kopyalandı ✓" : "kopyala"}
        </button>
      </div>
      <pre className="num max-h-[420px] overflow-auto rounded-lg bg-ink-950 p-3 text-[11.5px] leading-relaxed text-ink-200 ring-1 ring-ink-800">
        {json.split("\n").map((line, i) => (
          <div key={i} className="flex">
            <span className="w-9 shrink-0 select-none pr-3 text-right text-ink-600">{i + 1}</span>
            <span className="whitespace-pre-wrap break-all">{highlight(line)}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
