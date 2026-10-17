import { NextResponse } from "next/server";
import { aiInfo } from "@/lib/agents/llm.ts";
import { geminiQuotaStatus } from "@/lib/agents/providers/gemini.ts";
import { atkCall, atkStatus, atkTools } from "@/lib/atk.ts";
import { autopilotSettings, autoRunsToday } from "@/lib/autopilot.ts";
import { schedulerStatus } from "@/lib/scheduler.ts";
import { telemetry } from "@/lib/telemetry.ts";
import { FLAT_BAND } from "@/lib/scorecard.ts";
import { AGENT_TOOLS, MAX_CONCURRENT, MAX_TOKENS } from "@/lib/agents/pipeline.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number | null; ok: boolean; error?: string }> {
  const t0 = performance.now();
  try {
    await fn();
    return { ms: Math.round(performance.now() - t0), ok: true };
  } catch (e) {
    return { ms: null, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET() {
  // Live probes: one ATK MCP round trip and one direct REST round trip to OKX TR.
  const [atkProbe, restProbe] = await Promise.all([
    timed(() => atkCall("market_get_ticker", { instId: "BTC-USDT" }, 8000)),
    timed(async () => {
      const r = await fetch("https://tr.okx.com/api/v5/market/ticker?instId=BTC-USDT", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }),
  ]);
  let tools: { name: string; description?: string }[] = [];
  try {
    tools = (await atkTools()).map((t) => ({ name: t.name, description: t.description?.split(". ")[0] }));
  } catch {
    /* reported by atkStatus */
  }
  const ai = aiInfo();
  return NextResponse.json({
    now: Date.now(),
    ai,
    gemini: ai.provider === "gemini" ? geminiQuotaStatus() : null,
    atk: { ...atkStatus(), tools, probe: atkProbe, args: "--site tr --modules market --read-only" },
    rest: { probe: restProbe },
    scheduler: schedulerStatus(),
    autopilot: { ...autopilotSettings(), today: autoRunsToday() },
    runtime: { node: process.version, uptimeSec: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1e6) },
    config: {
      flatBand: FLAT_BAND,
      maxTokensPerAnalysis: MAX_TOKENS,
      maxConcurrent: MAX_CONCURRENT,
      agentTools: AGENT_TOOLS,
      evalIntervalSec: 60,
      rssIntervalMin: 5,
      storyWindowH: 48,
      autopilotFreshMin: 90,
    },
    telemetry: telemetry(),
  });
}
