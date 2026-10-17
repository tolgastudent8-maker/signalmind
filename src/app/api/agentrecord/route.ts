import { NextResponse } from "next/server";
import { agentRecord } from "@/lib/agent-record.ts";
import { reactionByKind } from "@/lib/eventstudy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const record = await agentRecord();
  const reaction = await reactionByKind(0); // agentRecord already computed what it could; reuse the cache
  return NextResponse.json({ record, reaction });
}
