import { NextResponse } from "next/server";
import { LIQUID_TRY_VOL, recordTurkeyHistory, turkeyHistory, turkeySnapshot } from "@/lib/turkey.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const hours = Math.max(1, Math.min(168, Number(new URL(req.url).searchParams.get("hours")) || 48));
  await recordTurkeyHistory().catch(() => false);
  return NextResponse.json({ snapshot: await turkeySnapshot(), history: turkeyHistory(hours), liquidTryVol: LIQUID_TRY_VOL });
}
