import { NextResponse } from "next/server";
import { GuardError, resolveHuman } from "@/lib/guard/agent.ts";
import { getCheck } from "@/lib/guard/queries.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = getCheck(id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "Denetim bulunamadı" }, { status: 404 });
}

/** Human-in-the-loop answer to an escalated audit. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { approve } = (await req.json()) as { approve?: boolean };
  if (typeof approve !== "boolean") return NextResponse.json({ error: "approve (true/false) gerekli" }, { status: 400 });
  try {
    await resolveHuman(id, approve);
    return NextResponse.json(getCheck(id));
  } catch (e) {
    if (e instanceof GuardError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
