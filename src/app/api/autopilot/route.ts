import { NextResponse } from "next/server";
import { autopilotCandidates, autopilotSettings, autoRunsToday, saveAutopilotSettings, type AutopilotSettings } from "@/lib/autopilot.ts";
import { schedulerStatus } from "@/lib/scheduler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function status() {
  const settings = autopilotSettings();
  return {
    settings,
    today: autoRunsToday(),
    candidates: autopilotCandidates(settings).slice(0, 5),
    last: schedulerStatus().lastAutopilot ?? null,
  };
}

export async function GET() {
  return NextResponse.json(status());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<AutopilotSettings>;
  const patch: Partial<AutopilotSettings> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.dailyCap === "number") patch.dailyCap = body.dailyCap;
  if (typeof body.minSources === "number") patch.minSources = body.minSources;
  saveAutopilotSettings(patch);
  return NextResponse.json(status());
}
