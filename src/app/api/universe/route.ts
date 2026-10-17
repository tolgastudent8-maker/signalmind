import { NextResponse } from "next/server";
import { universe } from "@/lib/market.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tokens: await universe() });
}
