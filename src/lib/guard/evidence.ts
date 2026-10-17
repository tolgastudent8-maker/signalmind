import { db } from "../db.ts";
import type { BotEvidence } from "./types.ts";

/**
 * Deterministic evidence helpers the Guard agent calls as tools. They never
 * judge; they measure (overlap, duplicates, timestamps) so the agent's verdict
 * can cite numbers instead of impressions.
 */

const STOP = new Set(
  "ve ile için bir bu şu da de mi mu ama gibi olan oldu olarak daha çok en son the a an and or of to in on for with by from at as is are was were be it its this that will says said".split(" "),
);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase("tr-TR")
      .split(/[^\p{L}\p{N}$%]+/u)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Groups the bot's evidence into clusters of near-identical texts (copies of one message). */
export function independence(evidence: BotEvidence[]): { clusters: { ids: string[]; sources: string[]; similarity: number }[]; independent: number } {
  const toks = evidence.map((e) => tokens(e.text));
  const parent = evidence.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const sim: number[][] = evidence.map(() => evidence.map(() => 0));
  for (let i = 0; i < evidence.length; i++)
    for (let j = i + 1; j < evidence.length; j++) {
      sim[i][j] = sim[j][i] = jaccard(toks[i], toks[j]);
      if (sim[i][j] >= 0.55) parent[find(j)] = find(i);
    }
  const groups = new Map<number, number[]>();
  evidence.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
  const clusters = [...groups.values()].map((idx) => ({
    ids: idx.map((i) => `bot:${i + 1}`),
    sources: idx.map((i) => evidence[i].source),
    similarity: idx.length > 1 ? Math.round(Math.min(...idx.flatMap((i) => idx.filter((j) => j !== i).map((j) => sim[i][j]))) * 100) / 100 : 1,
  }));
  return { clusters, independent: clusters.length };
}

const INJECTION = [
  /(önceki|tüm|bütün)\s+(talimat|kural)\w*\s+(yok\s*say|unut|görmezden)/iu,
  /\b(ignore|disregard)\s+(all\s+|any\s+)?(previous|prior|above)\s+(instructions|rules)/i,
  /\bsystem\s*:/i,
  /(denetle\w*|denetçi|guard|yapay\s*zek[aâ])[^.\n]{0,60}\b(onayla|approve|izin\s*ver)/iu,
  /\b(emri|bu\s+emri|this\s+order)\s+(onayla|approve)/iu,
];

/** Instruction-like text aimed at the auditor inside evidence. Evidence is data, never instructions. */
export function injectionHits(evidence: BotEvidence[]): { id: string; excerpt: string }[] {
  const hits: { id: string; excerpt: string }[] = [];
  evidence.forEach((e, i) => {
    for (const re of INJECTION) {
      const m = e.text.match(re);
      if (m) {
        const at = Math.max(0, (m.index ?? 0) - 30);
        hits.push({ id: `bot:${i + 1}`, excerpt: e.text.slice(at, at + 140) });
        break;
      }
    }
  });
  return hits;
}

export type LocalHit = { story: string; sources: { id: string; source: string; title: string; url: string | null; published_at: number | null }[]; score: number };

/** Searches SignalMind's own multi-outlet RSS archive; results are grouped per story (copies collapse). */
export function searchLocalNews(query: string, hours = 72, limit = 6): LocalHit[] {
  const q = tokens(query);
  if (!q.size) return [];
  const since = Date.now() - hours * 3_600_000;
  const rows = db()
    .prepare(`SELECT id, source, title, summary, url, published_at, COALESCE(story_id, id) AS story FROM news WHERE COALESCE(published_at, fetched_at) >= ?`)
    .all(since) as { id: string; source: string; title: string; summary: string; url: string | null; published_at: number | null; story: string }[];
  const scored = rows
    .map((r) => {
      const t = tokens(`${r.title} ${r.summary.slice(0, 300)}`);
      let shared = 0;
      for (const w of q) if (t.has(w)) shared++;
      return { r, score: shared / q.size };
    })
    .filter((x) => x.score >= 0.25);
  const byStory = new Map<string, LocalHit>();
  for (const { r, score } of scored) {
    const hit = byStory.get(r.story) ?? { story: r.story, sources: [], score: 0 };
    hit.sources.push({ id: `rss:${r.id}`, source: r.source, title: r.title, url: r.url, published_at: r.published_at });
    hit.score = Math.max(hit.score, Math.round(score * 100) / 100);
    byStory.set(r.story, hit);
  }
  return [...byStory.values()].sort((a, b) => b.score - a.score || b.sources.length - a.sources.length).slice(0, limit);
}
