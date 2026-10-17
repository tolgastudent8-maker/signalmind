import { db } from "../db.ts";
import { ALLOWED_ASSETS, TIERS, trustOf } from "./policy.ts";
import { DEMO_BOT, SCENARIOS } from "./scenarios.ts";
import type { FinalVerdict, OrderProposal } from "./types.ts";
import { chainInfo, waitForCheck, type EvidenceRef } from "./agent.ts";
import { atkHasCredentials } from "../atk.ts";
import { aiInfo } from "../agents/llm.ts";

export type CheckRow = {
  id: string;
  bot: string;
  scenario: string | null;
  proposal: OrderProposal;
  status: "running" | "awaiting_human" | "done" | "error";
  decision: string | null;
  final_decision: string | null;
  decided_by: string | null;
  verdict: (FinalVerdict & { toolCalls?: number; evidence?: Record<string, EvidenceRef> }) | null;
  verdict_hash: string | null;
  chain_tx: string | null;
  chain_error: string | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
};

type Raw = Omit<CheckRow, "proposal" | "verdict"> & { proposal_json: string; verdict_json: string | null };
const parse = ({ proposal_json, verdict_json, ...r }: Raw): CheckRow => ({ ...r, proposal: JSON.parse(proposal_json), verdict: verdict_json ? JSON.parse(verdict_json) : null });

const gRun = globalThis as unknown as { __signalmindGuardRunning?: Map<string, Promise<void>> };

/** Checks left 'running' by a restarted server can never finish. */
function closeOrphans() {
  const running = gRun.__signalmindGuardRunning ?? new Map();
  const ids = (db().prepare(`SELECT id FROM guard_checks WHERE status = 'running'`).all() as { id: string }[]).map((r) => r.id).filter((id) => !running.has(id));
  for (const id of ids) db().prepare(`UPDATE guard_checks SET status = 'error', error = 'Sunucu yeniden başladığı için denetim yarıda kaldı', finished_at = ? WHERE id = ?`).run(Date.now(), id);
}

export function listChecks(limit = 30): CheckRow[] {
  closeOrphans();
  return (db().prepare(`SELECT * FROM guard_checks ORDER BY created_at DESC LIMIT ?`).all(limit) as Raw[]).map(parse);
}

export function getCheck(id: string): { check: CheckRow; events: { id: number; ts: number; kind: string; title: string; payload: unknown }[] } | null {
  const row = db().prepare(`SELECT * FROM guard_checks WHERE id = ?`).get(id) as Raw | undefined;
  if (!row) return null;
  const events = (db().prepare(`SELECT id, ts, kind, title, payload_json FROM guard_events WHERE check_id = ? ORDER BY id`).all(id) as { id: number; ts: number; kind: string; title: string; payload_json: string | null }[]).map(
    ({ payload_json, ...e }) => ({ ...e, payload: payload_json ? JSON.parse(payload_json) : null }),
  );
  return { check: parse(row), events };
}

export function guardOverview() {
  return {
    bot: DEMO_BOT,
    trust: trustOf(DEMO_BOT),
    tiers: TIERS,
    allowedAssets: ALLOWED_ASSETS,
    scenarios: SCENARIOS.map(({ id, title, expectation }) => ({ id, title, expectation })),
    checks: listChecks(20),
    layers: { chain: chainInfo(), atkNewsCredentials: atkHasCredentials(), ai: aiInfo() },
  };
}

/** Demo reset: clears local audit history (and with it the bot's earned tier). On-chain records stay. */
export function resetGuardHistory(): number {
  const running = gRun.__signalmindGuardRunning ?? new Map();
  if (running.size) return -1;
  db().exec(`DELETE FROM guard_events; `);
  return Number(db().prepare(`DELETE FROM guard_checks`).run().changes);
}

export { waitForCheck };
