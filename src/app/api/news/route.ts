import { NextResponse } from "next/server";
import { FEEDS, listNews, addManualNews, refreshFeeds, type FeedResult } from "@/lib/news.ts";
import { ensureFeeds } from "@/lib/scheduler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  let feeds: FeedResult[] | null = null;
  if (url.searchParams.get("refresh") === "1") feeds = await refreshFeeds();
  else await ensureFeeds();
  const limit = Math.max(10, Math.min(500, Number(url.searchParams.get("limit")) || 300));
  return NextResponse.json({ news: listNews(limit), feeds, sources: FEEDS.map((f) => ({ source: f.source, lang: f.lang })) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { title?: string; body?: string; publishedAt?: number | null };
  if (!body.title || body.title.trim().length < 8) {
    return NextResponse.json({ error: "Başlık en az 8 karakter olmalı" }, { status: 400 });
  }
  const item = addManualNews(body.title, body.body ?? "", body.publishedAt ?? null);
  return NextResponse.json({ news: item });
}
