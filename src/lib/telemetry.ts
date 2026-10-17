import { db } from "./db.ts";
import type { AnalysisResult } from "./agents/pipeline.ts";

/**
 * Operational metrics derived from what the app already records: analysis rows,
 * the per-agent event log (start/done/tool timestamps) and stored results.
 */

const AGENTS = ["news", "impact", "bull", "bear", "judge", "strategy"] as const;

function pctile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

export type Telemetry = {
  analyses: { total: number; done: number; error: number; running: number; live: number; backtest: number; auto: number; avgDurationMs: number | null };
  agents: { agent: string; runs: number; avgMs: number | null; p95Ms: number | null }[];
  tools: { name: string; calls: number; errors: number; avgMs: number | null }[];
  tokens: { input: number; output: number; perAnalysis: number | null; models: { model: string; analyses: number }[] };
  predictions: { total: number; pending: number; correct: number; wrong: number; nodata: number; corrected: number };
  news: { items: number; stories: number; multiSource: number; bySource: { source: string; n: number }[] };
};

export function telemetry(): Telemetry {
  const d = db();
  const a = d
    .prepare(
      `SELECT COUNT(*) total,
        SUM(status='done') done, SUM(status='error') error, SUM(status='running') running,
        SUM(mode='live') live, SUM(mode='backtest') backtest, SUM(trigger='auto') auto,
        AVG(CASE WHEN status='done' THEN finished_at - created_at END) avgMs
       FROM analyses`,
    )
    .get() as Record<string, number | null>;

  // Agent durations: first "start" to last "done" event of that agent within one analysis.
  const spans = d
    .prepare(
      `SELECT analysis_id, agent, MIN(CASE WHEN kind='start' THEN ts END) s, MAX(CASE WHEN kind='done' THEN ts END) e
       FROM events WHERE agent IN (${AGENTS.map(() => "?").join(",")}) GROUP BY analysis_id, agent`,
    )
    .all(...AGENTS) as { agent: string; s: number | null; e: number | null }[];
  const agents = AGENTS.map((agent) => {
    const ms = spans.filter((x) => x.agent === agent && x.s && x.e).map((x) => x.e! - x.s!);
    return { agent, runs: ms.length, avgMs: mean(ms), p95Ms: pctile(ms, 95) };
  });

  const toolRows = (d.prepare(`SELECT payload_json FROM events WHERE kind='tool'`).all() as { payload_json: string | null }[])
    .map((r) => (r.payload_json ? (JSON.parse(r.payload_json) as { name: string; ok: boolean; ms: number }) : null))
    .filter((x): x is { name: string; ok: boolean; ms: number } => Boolean(x));
  const toolMap = new Map<string, { calls: number; errors: number; ms: number[] }>();
  for (const t of toolRows) {
    const cur = toolMap.get(t.name) ?? { calls: 0, errors: 0, ms: [] };
    cur.calls++;
    if (!t.ok) cur.errors++;
    cur.ms.push(t.ms);
    toolMap.set(t.name, cur);
  }
  const tools = [...toolMap.entries()].map(([name, v]) => ({ name, calls: v.calls, errors: v.errors, avgMs: mean(v.ms) })).sort((x, y) => y.calls - x.calls);

  const results = (d.prepare(`SELECT result_json FROM analyses WHERE result_json IS NOT NULL`).all() as { result_json: string }[]).map(
    (r) => JSON.parse(r.result_json) as AnalysisResult,
  );
  let input = 0;
  let output = 0;
  const modelCount = new Map<string, number>();
  for (const r of results) {
    input += r.usage?.input ?? 0;
    output += r.usage?.output ?? 0;
    for (const m of r.usage?.models ?? []) modelCount.set(m, (modelCount.get(m) ?? 0) + 1);
  }

  const p = d
    .prepare(
      `SELECT COUNT(*) total, SUM(status='pending') pending, SUM(status='correct') correct, SUM(status='wrong') wrong,
        SUM(status='nodata') nodata, SUM(rule_note IS NOT NULL) corrected FROM predictions`,
    )
    .get() as Record<string, number | null>;

  const n = d
    .prepare(
      `SELECT COUNT(*) items, COUNT(DISTINCT COALESCE(story_id, id)) stories,
        (SELECT COUNT(*) FROM (SELECT story_id FROM news WHERE story_id IS NOT NULL GROUP BY story_id HAVING COUNT(*) > 1)) multi
       FROM news`,
    )
    .get() as Record<string, number>;
  const bySource = d.prepare(`SELECT source, COUNT(*) n FROM news GROUP BY source ORDER BY n DESC`).all() as { source: string; n: number }[];

  const num = (x: number | null | undefined) => Number(x ?? 0);
  return {
    analyses: {
      total: num(a.total),
      done: num(a.done),
      error: num(a.error),
      running: num(a.running),
      live: num(a.live),
      backtest: num(a.backtest),
      auto: num(a.auto),
      avgDurationMs: a.avgMs ?? null,
    },
    agents,
    tools,
    tokens: {
      input,
      output,
      perAnalysis: results.length ? (input + output) / results.length : null,
      models: [...modelCount.entries()].map(([model, analyses]) => ({ model, analyses })).sort((x, y) => y.analyses - x.analyses),
    },
    predictions: {
      total: num(p.total),
      pending: num(p.pending),
      correct: num(p.correct),
      wrong: num(p.wrong),
      nodata: num(p.nodata),
      corrected: num(p.corrected),
    },
    news: { items: num(n.items), stories: num(n.stories), multiSource: num(n.multi), bySource },
  };
}

export type Accuracy = { ts: number; cumulative: number; n: number };

/** Cumulative accuracy after each scored prediction, in the order outcomes became known. */
export function accuracyOverTime(): Accuracy[] {
  const rows = db()
    .prepare(`SELECT status, entry_ts + horizon_h * 3600000 AS t FROM predictions WHERE status IN ('correct','wrong') ORDER BY t`)
    .all() as { status: string; t: number }[];
  let hits = 0;
  return rows.map((r, i) => {
    if (r.status === "correct") hits++;
    return { ts: r.t, cumulative: hits / (i + 1), n: i + 1 };
  });
}
