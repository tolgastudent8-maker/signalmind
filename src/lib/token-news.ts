import { listNews } from "./news.ts";
import { tagTokens } from "./tagging.ts";
import { atkCall } from "./atk.ts";
import { MIN_INDEPENDENT_SOURCES } from "./guard/policy.ts";

/** A story from the RSS archive that names the token; corroborated = carried by ≥2 distinct outlets (the Guard's rule). */
export type TokenStory = {
  id: string;
  title: string;
  publishedAt: number;
  outlets: number;
  corroborated: boolean;
  sources: { source: string; title: string; url: string | null }[];
};

/** OKX Agent Trade Kit news item for the token (news_get_by_coin). */
export type OkxNewsItem = {
  id: string;
  title: string;
  summary: string;
  importance: string;
  sentiment: string | null;
  publishedAt: number;
  url: string | null;
};

const HOURS = 72;

export function tokenStories(symbol: string, limit = 12): TokenStory[] {
  const sym = new Set([symbol]);
  const since = Date.now() - HOURS * 3_600_000;
  return listNews(400)
    .filter((s) => (s.published_at ?? s.fetched_at) >= since && s.sources.some((x) => tagTokens(x.title, sym).length > 0))
    .map((s) => {
      const outlets = new Set(s.sources.map((x) => x.source)).size;
      return {
        id: s.story_id,
        title: s.title,
        publishedAt: s.published_at ?? s.fetched_at,
        outlets,
        corroborated: outlets >= MIN_INDEPENDENT_SOURCES,
        sources: s.sources.map(({ source, title, url }) => ({ source, title, url })),
      };
    })
    .sort((a, b) => Number(b.corroborated) - Number(a.corroborated) || b.outlets - a.outlets || b.publishedAt - a.publishedAt)
    .slice(0, limit);
}

type ByCoin = { data?: { data?: { details?: Record<string, unknown>[] }[] } };

/** Live OKX ATK news for the token. Never throws: the page still renders without it. */
export async function okxCoinNews(symbol: string, limit = 8): Promise<{ items: OkxNewsItem[]; error?: string }> {
  try {
    const r = await atkCall<ByCoin>("news_get_by_coin", { coins: symbol, language: "en-US", importance: "low" }, 12_000);
    const details = r?.data?.data?.[0]?.details ?? [];
    const items = details.slice(0, limit).map((d) => {
      const sentiments = (d.ccySentiments as { ccy: string; sentiment: string }[] | undefined) ?? [];
      return {
        id: String(d.id),
        title: String(d.title ?? ""),
        summary: String(d.summary ?? ""),
        importance: String(d.importance ?? "low"),
        sentiment: sentiments.find((x) => x.ccy === symbol)?.sentiment ?? null,
        publishedAt: Number(d.cTime) || 0,
        url: typeof d.sourceUrl === "string" ? d.sourceUrl : null,
      };
    });
    return { items };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message.slice(0, 160) : String(e) };
  }
}
