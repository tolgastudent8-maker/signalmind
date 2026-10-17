import { db, kvGet, kvSet } from "../db.ts";
import type { OrderProposal } from "./types.ts";

/**
 * Deterministic policy: what a trading agent may do, and how its authority
 * grows. Limits widen only with a provable record — orders the Guard (or a
 * human) approved — never because the model says so.
 */

export const ALLOWED_ASSETS = ["BTC", "ETH", "SOL", "AVAX", "OKB", "XRP", "DOGE", "LINK", "ADA", "TON"];
export const TIERS = [
  { tier: 0, name: "Yeni", maxOrderUsd: 250, dailyUsd: 500, needApproved: 0 },
  { tier: 1, name: "Gözlemde", maxOrderUsd: 500, dailyUsd: 1500, needApproved: 3 },
  { tier: 2, name: "Güvenilir", maxOrderUsd: 1500, dailyUsd: 5000, needApproved: 8 },
  { tier: 3, name: "Kanıtlı", maxOrderUsd: 5000, dailyUsd: 15000, needApproved: 20 },
] as const;
export const MIN_INDEPENDENT_SOURCES = 2;

export type Trust = {
  bot: string;
  approved: number;
  rejected: number;
  tier: (typeof TIERS)[number];
  next: (typeof TIERS)[number] | null;
  approvedTodayUsd: number;
};

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const epochKey = (bot: string) => `guard_trust_since:${bot}`;

/** Audits created before this time no longer count toward the bot's trust (demo reset). */
export function trustSince(bot: string): number {
  return kvGet<number>(epochKey(bot)) ?? 0;
}

/** Restarts the bot's earned trust from "Yeni" without deleting any audit record. */
export function resetTrust(bot: string): void {
  kvSet(epochKey(bot), Date.now());
}

export function trustOf(bot: string): Trust {
  const rows = db()
    .prepare(`SELECT final_decision, proposal_json, finished_at FROM guard_checks WHERE bot = ? AND final_decision IS NOT NULL AND created_at >= ?`)
    .all(bot, trustSince(bot)) as { final_decision: "approve" | "reject"; proposal_json: string; finished_at: number | null }[];
  const approved = rows.filter((r) => r.final_decision === "approve");
  const today = startOfToday();
  const approvedTodayUsd = approved
    .filter((r) => (r.finished_at ?? 0) >= today)
    .reduce((s, r) => s + ((JSON.parse(r.proposal_json) as OrderProposal).notionalUsd || 0), 0);
  const tier = [...TIERS].reverse().find((t) => approved.length >= t.needApproved) ?? TIERS[0];
  const next = TIERS.find((t) => t.tier === tier.tier + 1) ?? null;
  return { bot, approved: approved.length, rejected: rows.length - approved.length, tier, next, approvedTodayUsd };
}

export type PolicyResult = {
  ok: boolean;
  asset: string;
  assetAllowed: boolean;
  withinOrderLimit: boolean;
  withinDailyLimit: boolean;
  violations: string[];
  trust: Trust;
};

export function checkPolicy(p: OrderProposal): PolicyResult {
  const asset = p.instId.split("-")[0].toUpperCase();
  const trust = trustOf(p.bot);
  const assetAllowed = ALLOWED_ASSETS.includes(asset);
  const withinOrderLimit = p.notionalUsd <= trust.tier.maxOrderUsd;
  const withinDailyLimit = trust.approvedTodayUsd + p.notionalUsd <= trust.tier.dailyUsd;
  const violations: string[] = [];
  if (!assetAllowed) violations.push(`${asset} izinli varlık listesinde değil`);
  if (!withinOrderLimit) violations.push(`Emir büyüklüğü ${p.notionalUsd} USD, "${trust.tier.name}" seviyesinin emir limiti ${trust.tier.maxOrderUsd} USD`);
  if (!withinDailyLimit) violations.push(`Günlük limit aşılıyor: bugün onaylanan ${trust.approvedTodayUsd} + ${p.notionalUsd} > ${trust.tier.dailyUsd} USD`);
  return { ok: violations.length === 0, asset, assetAllowed, withinOrderLimit, withinDailyLimit, violations, trust };
}
