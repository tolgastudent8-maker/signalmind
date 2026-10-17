"use client";

import Link from "next/link";
import { useState } from "react";
import type { AnalysisSummary } from "@/lib/queries";
import { DIR_LABEL, RELATION_LABEL } from "@/lib/labels";
import { timeAgo } from "./ui";

/**
 * Token × analysis matrix. Each cell is the Impact Radar call for that token in
 * that analysis: hue = direction (diverging green/red, grey for flat),
 * opacity = confidence. Rows are the tokens touched most often.
 */
export function ImpactMatrix({ analyses, columns = 10, rows = 10 }: { analyses: AnalysisSummary[]; columns?: number; rows?: number }) {
  const [hover, setHover] = useState<{ a: AnalysisSummary; i: AnalysisSummary["impacts"][number] } | null>(null);
  const cols = analyses.filter((a) => a.status === "done" && a.impacts.length).slice(0, columns);
  if (!cols.length) return null;

  const freq = new Map<string, number>();
  for (const a of cols) for (const i of a.impacts) freq.set(i.token, (freq.get(i.token) ?? 0) + 1);
  const tokens = [...freq.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, rows)
    .map(([t]) => t);

  const cell = (dir: string, conf: number) => {
    const a = 0.18 + 0.7 * Math.min(1, Math.max(0, conf / 100));
    return dir === "up" ? `rgba(47,214,138,${a})` : dir === "down" ? `rgba(255,92,108,${a})` : `rgba(154,164,184,${a * 0.6})`;
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="num border-separate border-spacing-[3px] text-[11px]">
          <thead>
            <tr>
              <th className="w-14" />
              {cols.map((a, k) => (
                <th key={a.id} className="w-10 pb-1 text-center font-normal text-ink-500">
                  <Link href={`/analiz/${a.id}`} className="hover:text-ink-100" title={a.headline ?? a.title}>
                    #{cols.length - k}
                  </Link>
                </th>
              ))}
              <th className="pl-2 text-left font-normal text-ink-500">net</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              let net = 0;
              return (
                <tr key={t}>
                  <td className="pr-2 text-right font-semibold text-ink-200">
                    <Link href={`/token/${t}`} className="hover:text-signal">
                      {t}
                    </Link>
                  </td>
                  {cols.map((a) => {
                    const i = a.impacts.find((x) => x.token === t);
                    if (!i) return <td key={a.id} className="h-7 w-10 rounded bg-ink-900/60" />;
                    net += (i.direction === "up" ? 1 : i.direction === "down" ? -1 : 0) * (i.confidence / 100);
                    return (
                      <td key={a.id} className="h-7 w-10 p-0">
                        <Link
                          href={`/analiz/${a.id}`}
                          onMouseEnter={() => setHover({ a, i })}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover({ a, i })}
                          onBlur={() => setHover(null)}
                          aria-label={`${t}: ${DIR_LABEL[i.direction]} %${Math.round(i.confidence)} — ${a.headline ?? a.title}`}
                          className="flex h-7 w-10 items-center justify-center rounded text-[10px] text-ink-100 ring-1 ring-inset ring-black/20 hover:ring-ink-100/60"
                          style={{ background: cell(i.direction, i.confidence) }}
                        >
                          {i.direction === "up" ? "▲" : i.direction === "down" ? "▼" : "◆"}
                        </Link>
                      </td>
                    );
                  })}
                  <td className={`pl-2 ${net > 0.05 ? "text-up" : net < -0.05 ? "text-down" : "text-ink-400"}`}>
                    {net > 0 ? "+" : ""}
                    {net.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 min-h-[38px] rounded-lg bg-ink-900/60 px-3 py-2 text-[12px] ring-1 ring-ink-800">
        {hover ? (
          <>
            <span className="font-semibold text-ink-100">{hover.i.token}</span>{" "}
            <span className={hover.i.direction === "up" ? "text-up" : hover.i.direction === "down" ? "text-down" : "text-ink-300"}>
              {DIR_LABEL[hover.i.direction]} · %{Math.round(hover.i.confidence)}
            </span>{" "}
            <span className="text-ink-500">
              · {RELATION_LABEL[hover.i.relation] ?? hover.i.relation} · {timeAgo(hover.a.created_at)}
            </span>
            <div className="line-clamp-2 text-ink-300">{hover.i.mechanism}</div>
          </>
        ) : (
          <span className="text-ink-500">
            Bir hücrenin üzerine gelin: o analizde tokenin neden etkilendiği burada görünür. Renk yön, koyuluk güven; “net” = güvenle ağırlıklı yön toplamı.
          </span>
        )}
      </div>
    </div>
  );
}
