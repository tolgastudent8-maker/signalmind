import { db, kvGet } from "./db.ts";
import { eventStudy, type EventStudy } from "./eventstudy.ts";
import { actualDirection, type Dir } from "./scorecard.ts";
import type { AnalysisResult } from "./agents/pipeline.ts";

/**
 * Agent track record: every agent's own claim is checked against what the
 * price then did (from the event study), at 1h and 24h after the news.
 *   Impact Radar — direction it gave each token
 *   Judge        — winner mapped to the primary token's direction (bull→up, bear→down, balanced→flat)
 *   Bull / Bear  — which side's thesis the primary token's move supported
 * The Strategy agent's record is the scorecard itself.
 */

export type Score = { n: number; hits: number; rate: number | null };
export type AgentRecord = {
  impact: Record<"1h" | "24h", Score>;
  judge: Record<"1h" | "24h", Score>;
  sides: Record<"1h" | "24h", { bull: number; bear: number; flat: number }>;
  analyses: number;
  studied: number;
};

const empty = (): Score => ({ n: 0, hits: 0, rate: null });
const H = { "1h": { minute: "60", hours: 1 }, "24h": { minute: "1440", hours: 24 } } as const;

/** The token the story is mostly about: a direct mention first, then the highest-confidence call. */
export function primaryToken(result: AnalysisResult): string | null {
  const imps = [...result.impact.impacts].sort((a, b) => Number(b.relation === "direct") - Number(a.relation === "direct") || b.confidence - a.confidence);
  return imps[0]?.token ?? null;
}

export function judgeDirection(winner: string): Dir {
  return winner === "bull" ? "up" : winner === "bear" ? "down" : "flat";
}

export function scoreAnalysis(result: AnalysisResult, study: EventStudy, rec: AgentRecord): void {
  const primary = primaryToken(result);
  for (const key of ["1h", "24h"] as const) {
    const { minute, hours } = H[key];
    for (const imp of result.impact.impacts) {
      const t = study.tokens.find((x) => x.symbol === imp.token);
      const r = t?.at[minute];
      if (r === null || r === undefined) continue;
      const s = rec.impact[key];
      s.n++;
      if (imp.direction === actualDirection(r, hours)) s.hits++;
    }
    const pt = primary ? study.tokens.find((x) => x.symbol === primary) : undefined;
    const pr = pt?.at[minute];
    if (pr !== null && pr !== undefined) {
      const actual = actualDirection(pr, hours);
      const j = rec.judge[key];
      j.n++;
      if (judgeDirection(result.verdict.winner) === actual) j.hits++;
      rec.sides[key][actual === "up" ? "bull" : actual === "down" ? "bear" : "flat"]++;
    }
  }
}

export async function agentRecord(maxCompute = 6): Promise<AgentRecord> {
  const rec: AgentRecord = {
    impact: { "1h": empty(), "24h": empty() },
    judge: { "1h": empty(), "24h": empty() },
    sides: { "1h": { bull: 0, bear: 0, flat: 0 }, "24h": { bull: 0, bear: 0, flat: 0 } },
    analyses: 0,
    studied: 0,
  };
  const rows = db()
    .prepare(`SELECT id, result_json FROM analyses WHERE status = 'done' AND result_json IS NOT NULL ORDER BY created_at DESC LIMIT 60`)
    .all() as { id: string; result_json: string }[];
  rec.analyses = rows.length;
  let computed = 0;
  for (const r of rows) {
    let study = kvGet<{ study: EventStudy }>(`es:${r.id}`)?.study ?? null;
    if (!study && computed < maxCompute) {
      study = await eventStudy(r.id).catch(() => null);
      computed++;
    }
    if (!study) continue;
    rec.studied++;
    scoreAnalysis(JSON.parse(r.result_json) as AnalysisResult, study, rec);
  }
  for (const k of ["1h", "24h"] as const) {
    for (const s of [rec.impact[k], rec.judge[k]]) s.rate = s.n ? s.hits / s.n : null;
  }
  return rec;
}
