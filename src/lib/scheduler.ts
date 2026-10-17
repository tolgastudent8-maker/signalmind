import { evaluateDue } from "./scorecard.ts";
import { refreshFeeds } from "./news.ts";
import { autopilotTick, type AutopilotTick } from "./autopilot.ts";
import { recoverInterruptedRuns } from "./agents/pipeline.ts";
import { recordTurkeyHistory } from "./turkey.ts";

/**
 * Background loop: scores due predictions every minute, pulls RSS every
 * 5 minutes and, when autonomous mode is on, starts analyses by itself.
 */

type State = { started?: boolean; lastEval?: number; lastFeed?: number; lastError?: string; lastAutopilot?: AutopilotTick & { at: number } };
const g = globalThis as unknown as { __signalmindScheduler?: State };
const state: State = (g.__signalmindScheduler ??= {});

export function schedulerStatus(): State {
  return { ...state };
}

const FEED_EVERY_MS = 5 * 60_000;
let feeding: Promise<void> | null = null;

/**
 * Pulls every RSS source when the last pull is older than 5 minutes. The background loop calls
 * it each minute; on serverless hosts (no loop) the news and Guard endpoints call it on demand.
 * Concurrent callers share one pull.
 */
export async function ensureFeeds(): Promise<void> {
  if (state.lastFeed && Date.now() - state.lastFeed < FEED_EVERY_MS) return;
  feeding ??= (async () => {
    state.lastFeed = Date.now();
    await refreshFeeds();
  })()
    .catch((e) => {
      state.lastError = e instanceof Error ? e.message : String(e);
    })
    .finally(() => {
      feeding = null;
    });
  await feeding;
}

async function tick() {
  try {
    await evaluateDue();
    state.lastEval = Date.now();
    await ensureFeeds();
    await recordTurkeyHistory().catch(() => false);
    state.lastAutopilot = { ...autopilotTick(), at: Date.now() };
    state.lastError = undefined;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
  }
}

export function startScheduler() {
  if (state.started) return;
  state.started = true;
  try {
    recoverInterruptedRuns();
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
  }
  setTimeout(tick, 3000);
  setInterval(tick, 60_000);
}
