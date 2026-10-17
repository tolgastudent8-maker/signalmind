import { NextResponse } from "next/server";
import { GuardError, startCheck } from "@/lib/guard/agent.ts";
import { guardOverview, resetGuardHistory } from "@/lib/guard/queries.ts";
import { SCENARIOS } from "@/lib/guard/scenarios.ts";
import type { OrderProposal } from "@/lib/guard/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function invalidProposal(p: OrderProposal): string | null {
  if (!/^[A-Z0-9]{2,10}-USDT$/i.test(p.instId)) return "instId 'ETH-USDT' biçiminde olmalı";
  if (p.notionalUsd > 1_000_000) return "Tutar en fazla 1.000.000 USD olabilir";
  if (typeof p.reason !== "string" || p.reason.trim().length < 5 || p.reason.length > 600) return "Gerekçe 5–600 karakter olmalı";
  if (p.evidence.length > 5) return "En fazla 5 kanıt gönderilebilir";
  if (p.evidence.some((e) => typeof e?.text !== "string" || !e.text.trim() || e.text.length > 600)) return "Her kanıtın metni 1–600 karakter olmalı";
  return null;
}

export async function GET() {
  return NextResponse.json(guardOverview());
}

/** Demo reset of the local audit history; refuses while an audit is running. */
export async function DELETE() {
  const n = resetGuardHistory();
  if (n < 0) return NextResponse.json({ error: "Çalışan bir denetim var; bitince tekrar deneyin." }, { status: 409 });
  return NextResponse.json({ kept: n });
}

/** Start an audit: either a demo scenario id or a full order proposal from a trading agent. */
export async function POST(req: Request) {
  const body = (await req.json()) as { scenario?: string; proposal?: OrderProposal };
  let proposal = body.proposal;
  const scenario = body.scenario ? SCENARIOS.find((s) => s.id === body.scenario) : undefined;
  if (body.scenario && !scenario) return NextResponse.json({ error: "Senaryo bulunamadı" }, { status: 400 });
  if (scenario) proposal = scenario.build();
  if (!proposal || !proposal.instId || !(proposal.notionalUsd > 0) || !Array.isArray(proposal.evidence)) {
    return NextResponse.json({ error: "Geçerli bir emir önerisi gerekli (bot, side, instId, notionalUsd, reason, evidence[])" }, { status: 400 });
  }
  if (!scenario) {
    // An order from outside (another agent, or typed in the console): bound its size before it reaches the model.
    const bad = invalidProposal(proposal);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    proposal = {
      bot: String(proposal.bot || "MomentumBot").slice(0, 40),
      side: proposal.side === "sell" ? "sell" : "buy",
      instId: proposal.instId.toUpperCase(),
      notionalUsd: Math.round(proposal.notionalUsd * 100) / 100,
      reason: proposal.reason.trim(),
      evidence: proposal.evidence.map((e) => ({ source: String(e.source || "kaynak belirtilmedi").slice(0, 80), text: String(e.text).trim(), url: e.url ?? null, published_at: e.published_at ?? null })),
    };
  }
  try {
    return NextResponse.json({ id: startCheck(proposal, scenario?.id ?? null) });
  } catch (e) {
    if (e instanceof GuardError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
