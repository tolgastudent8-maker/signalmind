import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/agents/llm.ts";
import { backtestCandidates, batchStatus, startBatch, stopBatch } from "@/lib/batch.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...batchStatus(), candidates: backtestCandidates(20).length });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { count?: number; stop?: boolean };
  if (body.stop) {
    stopBatch();
    return NextResponse.json(batchStatus());
  }
  if (!aiConfigured()) return NextResponse.json({ error: "Yapay zekâ API anahtarı tanımlı değil" }, { status: 400 });
  return NextResponse.json(startBatch(body.count ?? 5));
}
