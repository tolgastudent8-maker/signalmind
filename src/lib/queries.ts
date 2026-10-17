import { db } from "./db.ts";
import type { NewsItem } from "./news.ts";
import { abstentionsFor, type AbstentionRow, type PredictionRow } from "./scorecard.ts";
import type { AnalysisResult, AgentId, Mode } from "./agents/pipeline.ts";

export type EventRow = { id: number; ts: number; agent: AgentId; kind: string; title: string; payload: unknown };

export type AnalysisDetail = {
  id: string;
  mode: Mode;
  trigger: "manual" | "auto" | "batch";
  status: "running" | "done" | "error";
  as_of: number;
  created_at: number;
  finished_at: number | null;
  error: string | null;
  news: NewsItem;
  result: AnalysisResult | null;
  events: EventRow[];
  predictions: PredictionRow[];
  abstentions: AbstentionRow[];
};

type AnalysisRow = Omit<AnalysisDetail, "news" | "result" | "events" | "predictions" | "abstentions"> & { news_id: string; result_json: string | null };

export function getAnalysis(id: string): AnalysisDetail | null {
  const a = db().prepare(`SELECT * FROM analyses WHERE id = ?`).get(id) as AnalysisRow | undefined;
  if (!a) return null;
  const news = db().prepare(`SELECT * FROM news WHERE id = ?`).get(a.news_id) as NewsItem;
  const events = (
    db().prepare(`SELECT id, ts, agent, kind, title, payload_json FROM events WHERE analysis_id = ? ORDER BY id`).all(id) as (Omit<EventRow, "payload"> & {
      payload_json: string | null;
    })[]
  ).map(({ payload_json, ...e }) => ({ ...e, payload: payload_json ? JSON.parse(payload_json) : null }));
  const predictions = db().prepare(`SELECT * FROM predictions WHERE analysis_id = ? ORDER BY token, horizon_h`).all(id) as PredictionRow[];
  return {
    id: a.id,
    mode: a.mode,
    trigger: a.trigger ?? "manual",
    status: a.status,
    as_of: a.as_of,
    created_at: a.created_at,
    finished_at: a.finished_at,
    error: a.error,
    news,
    result: a.result_json ? (JSON.parse(a.result_json) as AnalysisResult) : null,
    events,
    predictions,
    abstentions: abstentionsFor(id),
  };
}

export type AnalysisSummary = {
  id: string;
  mode: Mode;
  trigger: string;
  status: string;
  created_at: number;
  title: string;
  source: string;
  headline: string | null;
  event_type: string | null;
  winner: string | null;
  tokens: string[];
  impacts: { token: string; direction: string; confidence: number; relation: string; mechanism: string }[];
  correct: number;
  wrong: number;
  pending: number;
};

/** Recent analyses; failed runs are left out unless `includeErrors`. */
export function listAnalyses(limit = 30, includeErrors = false): AnalysisSummary[] {
  const rows = db()
    .prepare(
      `SELECT a.id, a.mode, a.trigger, a.status, a.created_at, a.result_json, n.title, n.source,
        (SELECT COUNT(*) FROM predictions p WHERE p.analysis_id = a.id AND p.status = 'correct') AS correct,
        (SELECT COUNT(*) FROM predictions p WHERE p.analysis_id = a.id AND p.status = 'wrong') AS wrong,
        (SELECT COUNT(*) FROM predictions p WHERE p.analysis_id = a.id AND p.status = 'pending') AS pending
       FROM analyses a JOIN news n ON n.id = a.news_id ${includeErrors ? "" : "WHERE a.status <> 'error'"} ORDER BY a.created_at DESC LIMIT ?`,
    )
    .all(limit) as (Omit<AnalysisSummary, "headline" | "event_type" | "winner" | "tokens" | "impacts"> & { result_json: string | null })[];
  return rows.map(({ result_json, ...r }): AnalysisSummary => {
    const res = result_json ? (JSON.parse(result_json) as AnalysisResult) : null;
    return {
      ...r,
      headline: res?.news.headline ?? null,
      event_type: res?.news.event_type ?? null,
      winner: res?.verdict.winner ?? null,
      tokens: res?.impact.impacts.map((i) => i.token) ?? [],
      impacts:
        res?.impact.impacts.map((i) => ({ token: i.token, direction: i.direction, confidence: i.confidence, relation: i.relation, mechanism: i.mechanism })) ?? [],
    };
  });
}

export function failedAnalysisCount(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM analyses WHERE status = 'error'`).get() as { n: number }).n;
}
