import { NextResponse } from "next/server";
import { getAnalysis } from "@/lib/queries.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const a = getAnalysis(id);
  if (!a) return NextResponse.json({ error: "Analiz bulunamadı" }, { status: 404 });
  return NextResponse.json(a);
}
