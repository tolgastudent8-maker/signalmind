import { NextResponse } from "next/server";
import { hashVerdict } from "@/lib/guard/agent.ts";
import { getCheck } from "@/lib/guard/queries.ts";
import { chainStatus, readVerdict, EXPLORER_BASE } from "@/lib/chain.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Independent check of one verdict: recompute keccak256 from the stored record, then read
 * Fuji for that hash (contract state + VerdictRecorded event) and compare decision and agent.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getCheck(id);
  if (!r) return NextResponse.json({ error: "Denetim bulunamadı" }, { status: 404 });
  const c = r.check;
  if (!c.verdict || !c.final_decision || !c.verdict_hash) return NextResponse.json({ error: "Bu denetimin henüz nihai kararı yok" }, { status: 409 });

  const recomputed = hashVerdict(c.id, c.proposal, c.verdict, c.final_decision);
  const hashMatches = recomputed.toLowerCase() === c.verdict_hash.toLowerCase();
  const st = chainStatus();
  try {
    const onChain = await readVerdict(recomputed as `0x${string}`, c.chain_tx);
    const decisionMatches = onChain.decision === null ? null : onChain.decision === c.final_decision;
    const agentMatches = onChain.agentId === null ? null : onChain.agentId === st.agentId;
    return NextResponse.json({
      ok: hashMatches && onChain.recorded && decisionMatches !== false && agentMatches !== false,
      recomputed,
      stored: c.verdict_hash,
      hashMatches,
      decision: c.final_decision,
      onChain,
      decisionMatches,
      agentMatches,
      registry: st.registry,
      explorerUrl: c.chain_tx ? `${EXPLORER_BASE}/tx/${c.chain_tx}` : null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, recomputed, stored: c.verdict_hash, hashMatches, error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
