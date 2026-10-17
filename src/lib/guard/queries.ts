import { ALLOWED_ASSETS, TIERS, resetTrust, trustOf, trustSince } from "./policy.ts";
import { DEMO_BOT, SCENARIOS } from "./scenarios.ts";
import type { FinalVerdict, OrderProposal } from "./types.ts";
import { chainInfo, waitForCheck, type EvidenceRef } from "./agent.ts";
import { store, type CheckRecord } from "./store.ts";
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

const parse = ({ proposal_json, verdict_json, ...r }: CheckRecord): CheckRow => ({ ...r, proposal: JSON.parse(proposal_json), verdict: verdict_json ? JSON.parse(verdict_json) : null });

const gRun = globalThis as unknown as { __signalmindGuardRunning?: Map<string, Promise<void>> };

/**
 * An audit still 'running' long after any audit could finish was cut off (server restart,
 * serverless timeout). Age-based, so one instance never closes another instance's live audit.
 */
const ORPHAN_MS = 3 * 60_000;
async function closeOrphans(rows: CheckRecord[]): Promise<CheckRecord[]> {
  const running = gRun.__signalmindGuardRunning ?? new Map();
  const now = Date.now();
  for (const r of rows) {
    if (r.status === "running" && !running.has(r.id) && now - r.created_at > ORPHAN_MS) {
      const patch = { status: "error" as const, error: "Denetim yarıda kaldı (sunucu yeniden başladı ya da süre doldu)", finished_at: now };
      await store().updateCheck(r.id, patch);
      Object.assign(r, patch);
    }
  }
  return rows;
}

export async function listChecks(limit = 30): Promise<CheckRow[]> {
  return (await closeOrphans(await store().listChecks(limit))).map(parse);
}

export async function getCheck(id: string): Promise<{ check: CheckRow; events: { id: number; ts: number; kind: string; title: string; payload: unknown }[] } | null> {
  const row = await store().getCheck(id);
  if (!row) return null;
  const events = (await store().listEvents(id)).map(({ payload_json, ...e }) => ({ ...e, payload: payload_json ? JSON.parse(payload_json) : null }));
  return { check: parse(row), events };
}

export async function guardOverview() {
  const [trust, since, checks] = await Promise.all([trustOf(DEMO_BOT), trustSince(DEMO_BOT), listChecks(20)]);
  return {
    bot: DEMO_BOT,
    trust,
    trustSince: since,
    tiers: TIERS,
    allowedAssets: ALLOWED_ASSETS,
    scenarios: SCENARIOS.map(({ id, title, expectation }) => ({ id, title, expectation })),
    checks,
    layers: { chain: chainInfo(), atkNewsCredentials: atkHasCredentials(), ai: aiInfo() },
  };
}

/**
 * Demo reset: the bot's earned tier starts again from "Yeni". Audit history (and its Fuji
 * records) is kept; earlier audits are shown as "önceki demo" and no longer count as trust.
 */
export async function resetGuardHistory(): Promise<number> {
  const running = gRun.__signalmindGuardRunning ?? new Map();
  if (running.size) return -1;
  await resetTrust(DEMO_BOT);
  return (await store().checksOf(DEMO_BOT)).length;
}

export { waitForCheck };
