import { NextResponse } from "next/server";
import { aiInfo } from "@/lib/agents/llm.ts";
import { geminiQuotaStatus } from "@/lib/agents/providers/gemini.ts";
import { atkStatus, atkTools } from "@/lib/atk.ts";
import { lastDataSource, tickers } from "@/lib/market.ts";
import { schedulerStatus } from "@/lib/scheduler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let atkToolCount = 0;
  try {
    atkToolCount = (await atkTools()).length;
  } catch {
    /* reported via atkStatus */
  }
  let btc: number | null = null;
  try {
    btc = (await tickers()).get("BTC-USDT")?.last ?? null;
  } catch {
    /* offline */
  }
  return NextResponse.json({
    ai: aiInfo(),
    gemini: aiInfo().provider === "gemini" ? geminiQuotaStatus() : null,
    atk: { ...atkStatus(), tools: atkToolCount },
    dataSource: lastDataSource() ?? null,
    btc,
    scheduler: schedulerStatus(),
  });
}
