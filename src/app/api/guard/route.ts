import { NextResponse } from "next/server";
import { GuardError, startCheck } from "@/lib/guard/agent.ts";
import { guardOverview, resetGuardHistory } from "@/lib/guard/queries.ts";
import { SCENARIOS } from "@/lib/guard/scenarios.ts";
import type { OrderProposal } from "@/lib/guard/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(guardOverview());
}

/** Demo reset of the local audit history; refuses while an audit is running. */
export async function DELETE() {
  const n = resetGuardHistory();
  if (n < 0) return NextResponse.json({ error: "Çalışan bir denetim var; bitince tekrar deneyin." }, { status: 409 });
  return NextResponse.json({ deleted: n });
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
  try {
    return NextResponse.json({ id: startCheck(proposal, scenario?.id ?? null) });
  } catch (e) {
    if (e instanceof GuardError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
