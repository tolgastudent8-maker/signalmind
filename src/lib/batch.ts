import { db } from "./db.ts";
import { listNews } from "./news.ts";
import { startAnalysis, waitForAnalysis } from "./agents/pipeline.ts";

/**
 * Batch backtest: analyses several past stories one after another so the
 * scorecard fills up quickly. Runs sequentially to respect free-tier quotas and
 * stops early once the provider reports its daily quota is spent.
 */

export type BatchItem = { newsId: string; title: string; status: "queued" | "running" | "done" | "error" | "skipped"; analysisId?: string; error?: string };
type State = { items: BatchItem[]; active: boolean; startedAt?: number; stopReason?: string };

const g = globalThis as unknown as { __signalmindBatch?: State };
const state: State = (g.__signalmindBatch ??= { items: [], active: false });

export function batchStatus(): State {
  return { ...state, items: state.items.map((i) => ({ ...i })) };
}

/** Past stories (≥1h old) that have no backtest yet, newest first. */
export function backtestCandidates(limit: number): { id: string; title: string }[] {
  const tested = new Set(
    (db().prepare(`SELECT DISTINCT news_id FROM analyses WHERE mode = 'backtest' AND status <> 'error'`).all() as { news_id: string }[]).map((r) => r.news_id),
  );
  const cutoff = Date.now() - 3_600_000;
  return listNews(200)
    .filter((s) => s.published_at !== null && s.published_at < cutoff && !s.sources.some((x) => tested.has(x.id)))
    .slice(0, limit)
    .map((s) => ({ id: s.id, title: s.title }));
}

const QUOTA_STOP = /kotası doldu|quota/i;

export function startBatch(count: number): State {
  if (state.active) return batchStatus();
  const picks = backtestCandidates(Math.max(1, Math.min(count, 20)));
  state.items = picks.map((p) => ({ newsId: p.id, title: p.title, status: "queued" }));
  state.active = picks.length > 0;
  state.startedAt = Date.now();
  state.stopReason = picks.length ? undefined : "Geriye dönük test edilecek uygun haber yok";
  if (state.active) void run();
  return batchStatus();
}

export function stopBatch(): void {
  if (!state.active) return;
  state.stopReason = "Kullanıcı durdurdu";
  for (const i of state.items) if (i.status === "queued") i.status = "skipped";
}

async function run(): Promise<void> {
  try {
    for (const item of state.items) {
      if (item.status !== "queued") continue;
      item.status = "running";
      try {
        item.analysisId = startAnalysis(item.newsId, "backtest", "batch");
        await waitForAnalysis(item.analysisId);
        const row = db().prepare(`SELECT status, error FROM analyses WHERE id = ?`).get(item.analysisId) as { status: string; error: string | null };
        item.status = row.status === "done" ? "done" : "error";
        item.error = row.error ?? undefined;
      } catch (e) {
        item.status = "error";
        item.error = e instanceof Error ? e.message : String(e);
      }
      if (item.error && QUOTA_STOP.test(item.error)) {
        state.stopReason = "Yapay zekâ kotası doldu; kalan haberler atlandı";
        for (const rest of state.items) if (rest.status === "queued") rest.status = "skipped";
      }
    }
  } finally {
    state.active = false;
  }
}
