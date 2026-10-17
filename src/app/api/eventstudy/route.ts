import { NextResponse } from "next/server";
import { eventStudy, reactionByKind } from "@/lib/eventstudy.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?analysis=<id> → one event study; no parameter → reaction averages by news kind. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("analysis");
  if (id) {
    const study = await eventStudy(id);
    if (!study) return NextResponse.json({ error: "Tamamlanmış analiz bulunamadı" }, { status: 404 });
    return NextResponse.json(study);
  }
  return NextResponse.json(await reactionByKind());
}
