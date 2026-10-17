import { NextResponse } from "next/server";
import { allPredictions, computeStats, coverage, evaluateDue } from "@/lib/scorecard.ts";
import { accuracyOverTime } from "@/lib/telemetry.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const m = url.searchParams.get("mode");
  const mode = m === "live" || m === "backtest" ? m : undefined;
  if (url.searchParams.get("evaluate") === "1") await evaluateDue();
  const rows = allPredictions({ mode });
  return NextResponse.json({ stats: computeStats(rows), predictions: rows.slice(0, 300), timeline: accuracyOverTime(), coverage: coverage(mode) });
}
