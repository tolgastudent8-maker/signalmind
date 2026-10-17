import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { db } from "./db.ts";

export type NewsItem = {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string | null;
  published_at: number | null;
  fetched_at: number;
};

export type Lang = "en" | "tr";

/** RSS sources. Each was checked to serve current items; Turkish ones are original Turkish coverage. */
export const FEEDS: { source: string; url: string; lang: Lang }[] = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", lang: "en" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss", lang: "en" },
  { source: "The Block", url: "https://www.theblock.co/rss.xml", lang: "en" },
  { source: "Decrypt", url: "https://decrypt.co/feed", lang: "en" },
  { source: "Blockworks", url: "https://blockworks.co/feed", lang: "en" },
  { source: "The Defiant", url: "https://thedefiant.io/api/feed", lang: "en" },
  { source: "Bitcoin Magazine", url: "https://bitcoinmagazine.com/feed", lang: "en" },
  { source: "CryptoSlate", url: "https://cryptoslate.com/feed/", lang: "en" },
  { source: "CryptoPotato", url: "https://cryptopotato.com/feed/", lang: "en" },
  { source: "CryptoBriefing", url: "https://cryptobriefing.com/feed/", lang: "en" },
  { source: "Crypto.news", url: "https://crypto.news/feed/", lang: "en" },
  { source: "U.Today", url: "https://u.today/rss", lang: "en" },
  { source: "BeInCrypto", url: "https://beincrypto.com/feed/", lang: "en" },
  { source: "BeInCrypto TR", url: "https://tr.beincrypto.com/feed/", lang: "tr" },
  { source: "Koin Bülteni", url: "https://koinbulteni.com/feed", lang: "tr" },
  { source: "Coin-Turk", url: "https://coin-turk.com/feed", lang: "tr" },
  { source: "Coinkolik", url: "https://www.coinkolik.com/feed/", lang: "tr" },
  { source: "Uzmancoin", url: "https://uzmancoin.com/feed/", lang: "tr" },
];

const SOURCE_LANG = new Map<string, Lang>(FEEDS.map((f) => [f.source, f.lang]));
export const langOf = (source: string): Lang => SOURCE_LANG.get(source) ?? "tr";

export function newsId(title: string, url: string | null): string {
  return createHash("sha256").update(`${title.trim().toLowerCase()}|${url ?? ""}`).digest("hex").slice(0, 16);
}

const NAMED: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", ndash: "–", mdash: "—" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function stripHtml(s: string): string {
  // Decode twice: some feeds double-escape (&amp;#8217;).
  return decodeEntities(decodeEntities(s.replace(/<[^>]+>/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

const parser = new XMLParser({ ignoreAttributes: true, cdataPropName: false, processEntities: true });

export function parseFeed(xml: string, source: string, now = Date.now()): NewsItem[] {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const items = Array.isArray(raw) ? raw : [raw];
  return items
    .map((it: Record<string, unknown>) => {
      const title = stripHtml(text(it.title));
      const url = text(it.link) || text(it.guid) || null;
      const summary = stripHtml(text(it.description) || text(it.summary) || text(it["content:encoded"])).slice(0, 1200);
      const dateStr = text(it.pubDate) || text(it.published) || text(it.updated);
      const ts = dateStr ? Date.parse(dateStr) : NaN;
      return {
        id: newsId(title, url),
        source,
        title,
        summary,
        url,
        published_at: Number.isFinite(ts) ? ts : null,
        fetched_at: now,
      } satisfies NewsItem;
    })
    .filter((n) => n.title.length > 0);
}

export function saveNews(items: NewsItem[]): void {
  // Dedupe by content hash and, when present, by URL (a title can re-encode differently between fetches).
  const stmt = db().prepare(
    `INSERT INTO news (id, source, title, summary, url, published_at, fetched_at)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM news WHERE id = ? OR (url IS NOT NULL AND url = ?))`,
  );
  for (const n of items) stmt.run(n.id, n.source, n.title, n.summary, n.url, n.published_at, n.fetched_at, n.id, n.url);
  assignStories();
}

/*
 * Story clustering: the same event is reported by several outlets within hours.
 * Two headlines belong to one story when they share at least 3 keywords and the
 * shared words cover half of the shorter headline. Deterministic and explainable.
 */

const STOP = new Set(
  // Generic words plus words that appear in most crypto headlines and so carry no story identity.
  "the a an and or of to in on for with by from at as is are was were be been it its this that these those after before over under into amid about says said could would will may might can new than then more most just still again here what how why who crypto cryptocurrency token market price".split(
    " ",
  ),
);

export function keywords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9$%.]+/)
    .map((w) => w.replace(/\.+$/, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return new Set(words);
}

export function sameStory(a: string, b: string): boolean {
  const ka = keywords(a);
  const kb = keywords(b);
  let shared = 0;
  for (const w of ka) if (kb.has(w)) shared++;
  return shared >= 3 && shared / Math.min(ka.size, kb.size) >= 0.5;
}

const STORY_WINDOW_MS = 48 * 3_600_000;

function assignStories(): void {
  const pending = db()
    .prepare(`SELECT id, title, COALESCE(published_at, fetched_at) AS t FROM news WHERE story_id IS NULL ORDER BY t`)
    .all() as { id: string; title: string; t: number }[];
  if (!pending.length) return;
  const assigned = db()
    .prepare(`SELECT id, title, story_id, COALESCE(published_at, fetched_at) AS t FROM news WHERE story_id IS NOT NULL AND COALESCE(published_at, fetched_at) > ?`)
    .all(pending[0].t - STORY_WINDOW_MS) as { id: string; title: string; story_id: string; t: number }[];
  const update = db().prepare(`UPDATE news SET story_id = ? WHERE id = ?`);
  for (const p of pending) {
    const match = assigned.find((a) => Math.abs(a.t - p.t) <= STORY_WINDOW_MS && sameStory(a.title, p.title));
    const story = match?.story_id ?? p.id;
    update.run(story, p.id);
    assigned.push({ id: p.id, title: p.title, story_id: story, t: p.t });
  }
}

/** Other outlets' headlines for the same story (used as corroboration). */
export function storyMates(id: string): Pick<NewsItem, "id" | "source" | "title" | "url">[] {
  return db()
    .prepare(`SELECT id, source, title, url FROM news WHERE story_id = (SELECT story_id FROM news WHERE id = ?) AND id <> ? ORDER BY COALESCE(published_at, fetched_at)`)
    .all(id, id) as never;
}

export type FeedResult = { source: string; ok: boolean; count: number; error?: string };

export async function refreshFeeds(): Promise<FeedResult[]> {
  return Promise.all(
    FEEDS.map(async (f): Promise<FeedResult> => {
      try {
        const res = await fetch(f.url, {
          headers: { "User-Agent": "Mozilla/5.0 SignalMind/0.1 (+news analysis)" },
          signal: AbortSignal.timeout(12000),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = parseFeed(await res.text(), f.source);
        saveNews(items);
        return { source: f.source, ok: true, count: items.length };
      } catch (e) {
        return { source: f.source, ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

export function addManualNews(title: string, body: string, publishedAt: number | null): NewsItem {
  const item: NewsItem = {
    id: newsId(title, null),
    source: "Manuel",
    title: title.trim(),
    summary: body.trim(),
    url: null,
    published_at: publishedAt,
    fetched_at: Date.now(),
  };
  saveNews([item]);
  return item;
}

export type StoryRow = NewsItem & {
  story_id: string;
  analysis_id: string | null;
  analysis_status: string | null;
  lang: Lang;
  sources: { id: string; source: string; title: string; url: string | null; lang: Lang }[];
};

/** One row per story: the first report, plus every outlet that carried it. */
export function listNews(limit = 60): StoryRow[] {
  const rows = db()
    .prepare(
      `SELECT n.*, a.id AS analysis_id, a.status AS analysis_status, a.created_at AS analysis_at
       FROM news n
       LEFT JOIN analyses a ON a.id = (SELECT id FROM analyses WHERE news_id = n.id ORDER BY created_at DESC LIMIT 1)
       ORDER BY COALESCE(n.published_at, n.fetched_at) ASC`,
    )
    .all() as (NewsItem & { story_id: string | null; analysis_id: string | null; analysis_status: string | null; analysis_at: number | null })[];
  const stories = new Map<string, StoryRow & { analysis_at: number | null; latest: number }>();
  for (const r of rows) {
    const key = r.story_id ?? r.id;
    const t = r.published_at ?? r.fetched_at;
    const s = stories.get(key);
    if (!s) {
      stories.set(key, { ...r, story_id: key, lang: langOf(r.source), sources: [{ id: r.id, source: r.source, title: r.title, url: r.url, lang: langOf(r.source) }], latest: t });
      continue;
    }
    s.sources.push({ id: r.id, source: r.source, title: r.title, url: r.url, lang: langOf(r.source) });
    s.latest = Math.max(s.latest, t);
    if (!s.summary && r.summary) s.summary = r.summary;
    if (r.analysis_id && (r.analysis_at ?? 0) > (s.analysis_at ?? 0)) {
      s.analysis_id = r.analysis_id;
      s.analysis_status = r.analysis_status;
      s.analysis_at = r.analysis_at;
    }
  }
  return [...stories.values()]
    .sort((a, b) => b.latest - a.latest)
    .slice(0, limit)
    .map(({ analysis_at: _a, latest: _l, ...s }) => s);
}

export function getNews(id: string): NewsItem | undefined {
  return db().prepare(`SELECT * FROM news WHERE id = ?`).get(id) as NewsItem | undefined;
}
