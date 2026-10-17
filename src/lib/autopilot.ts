import { db, kvGet, kvSet } from "./db.ts";
import { listNews } from "./news.ts";
import { aiConfigured } from "./agents/llm.ts";
import { runningCount, startAnalysis } from "./agents/pipeline.ts";

/**
 * Autonomous mode: the background loop analyses fresh, corroborated stories on
 * its own. Off by default; a daily cap bounds API spend. Only one analysis is
 * started per tick and only when nothing else is running.
 */

export type AutopilotSettings = { enabled: boolean; dailyCap: number; minSources: number };
const DEFAULTS: AutopilotSettings = { enabled: false, dailyCap: 5, minSources: 2 };
const FRESH_MS = 90 * 60_000;

export function autopilotSettings(): AutopilotSettings {
  return { ...DEFAULTS, ...(kvGet<Partial<AutopilotSettings>>("autopilot") ?? {}) };
}

export function saveAutopilotSettings(patch: Partial<AutopilotSettings>): AutopilotSettings {
  const next = { ...autopilotSettings(), ...patch };
  next.dailyCap = Math.max(1, Math.min(50, Math.round(next.dailyCap)));
  next.minSources = Math.max(1, Math.min(5, Math.round(next.minSources)));
  kvSet("autopilot", next);
  return next;
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function autoRunsToday(): number {
  return (db().prepare(`SELECT COUNT(*) AS n FROM analyses WHERE trigger = 'auto' AND created_at >= ?`).get(startOfToday()) as { n: number }).n;
}

/** Stories the autopilot would pick next, most corroborated first. */
export function autopilotCandidates(s = autopilotSettings()): { id: string; title: string; sources: number }[] {
  const cutoff = Date.now() - FRESH_MS;
  return listNews(120)
    .filter((n) => !n.analysis_id && n.sources.length >= s.minSources && (n.published_at ?? n.fetched_at) >= cutoff)
    .sort((a, b) => b.sources.length - a.sources.length)
    .map((n) => ({ id: n.id, title: n.title, sources: n.sources.length }));
}

export type AutopilotTick = { started?: string; reason: string };

export function autopilotTick(): AutopilotTick {
  const s = autopilotSettings();
  if (!s.enabled) return { reason: "kapalı" };
  if (!aiConfigured()) return { reason: "API anahtarı yok" };
  if (autoRunsToday() >= s.dailyCap) return { reason: "günlük sınıra ulaşıldı" };
  if (runningCount() > 0) return { reason: "başka analiz sürüyor" };
  const next = autopilotCandidates(s)[0];
  if (!next) return { reason: "uygun yeni hikâye yok" };
  const id = startAnalysis(next.id, "live", "auto");
  return { started: id, reason: `${next.sources} kaynaklı hikâye otomatik analiz edildi` };
}
