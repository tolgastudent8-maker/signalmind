import { NextResponse } from "next/server";
import { startAnalysis, StartError } from "@/lib/agents/pipeline.ts";
import { failedAnalysisCount, listAnalyses } from "@/lib/queries.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ analyses: listAnalyses(40), failed: failedAnalysisCount() });
}

export async function POST(req: Request) {
  const { newsId, mode } = (await req.json()) as { newsId?: string; mode?: "live" | "backtest" };
  if (!newsId) return NextResponse.json({ error: "newsId gerekli" }, { status: 400 });
  try {
    const id = startAnalysis(newsId, mode === "backtest" ? "backtest" : "live");
    return NextResponse.json({ id });
  } catch (e) {
    if (e instanceof StartError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
