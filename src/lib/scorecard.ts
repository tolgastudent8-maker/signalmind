import { db } from "./db.ts";
import { priceAt } from "./market.ts";

/**
 * Prediction scorecard.
 *
 * Outcome rule: change = exit / entry - 1 over the horizon. If |change| is below
 * the horizon's flat band the actual direction is "flat", otherwise up/down.
 * A prediction is correct when its direction equals the actual direction.
 * Confidence is the stated probability of being correct, so Brier = mean((p - hit)^2).
 */

export const FLAT_BAND: Record<number, number> = { 1: 0.004, 24: 0.015 };
const EVAL_GRACE_MS = 2 * 60_000;

export type Dir = "up" | "down" | "flat";

export type PredictionRow = {
  id: number;
  analysis_id: string;
  news_id: string;
  mode: "live" | "backtest";
  token: string;
  inst_id: string;
  direction: Dir;
  confidence: number;
  horizon_h: number;
  event_type: string;
  mechanism: string;
  rationale: string;
  entry_ts: number;
  entry_price: number;
  momentum_dir: Dir;
  status: "pending" | "correct" | "wrong" | "nodata";
  actual_dir: Dir | null;
  exit_price: number | null;
  change_pct: number | null;
  evaluated_at: number | null;
  model_direction: Dir | null;
  model_confidence: number | null;
  rule_note: string | null;
  base_prob: number | null;
};

export function actualDirection(change: number, horizonH: number): Dir {
  const band = FLAT_BAND[horizonH] ?? 0.01;
  if (Math.abs(change) < band) return "flat";
  return change > 0 ? "up" : "down";
}

/** Abramowitz–Stegun 7.1.26 approximation (|error| < 1.5e-7). */
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

export type BaseRate = { flat: number; up: number; down: number };

/**
 * Statistical prior for a horizon, assuming driftless normal returns with the
 * token's recent hourly volatility scaled by √h. This is what "no edge" looks
 * like; agents must justify any confidence above it.
 */
export function baseRate(hourlyVol: number | null, horizonH: number): BaseRate | null {
  if (!hourlyVol || hourlyVol <= 0) return null;
  const sigma = hourlyVol * Math.sqrt(horizonH);
  const band = FLAT_BAND[horizonH] ?? 0.01;
  const flat = erf(band / (sigma * Math.SQRT2));
  return { flat, up: (1 - flat) / 2, down: (1 - flat) / 2 };
}

/** A prediction must beat its own no-news base rate by this much to be recorded. */
export const MIN_EDGE = 0.05;

export type AbstainCode = "contradiction" | "no_edge" | "not_new_information" | "not_called" | "no_price";

export type Gate = { record: true } | { record: false; code: AbstainCode; reason: string };

const DIR_TR: Record<Dir, string> = { up: "yükseliş", down: "düşüş", flat: "yatay" };
const pctOf = (x: number) => `%${Math.round(x * 100)}`;

/**
 * Recording gate, enforced by code rather than the prompt. A stated confidence is
 * the probability of the chosen outcome, so:
 *  - if another outcome is more likely than that even with no news, the model
 *    contradicted itself → abstain;
 *  - if it beats its own base rate by less than MIN_EDGE, it claims no edge → abstain.
 * Abstentions are kept (with the reason) so coverage is reported honestly.
 */
export function gatePrediction(direction: Dir, confidence: number, base: BaseRate | null): Gate {
  if (!base) return { record: true };
  const others = (["up", "flat", "down"] as Dir[]).filter((d) => d !== direction);
  const best = others.reduce((a, b) => (base[b] > base[a] ? b : a));
  if (confidence < base[best]) {
    return {
      record: false,
      code: "contradiction",
      reason: `"${DIR_TR[direction]}" için ${pctOf(confidence)} güven, "${DIR_TR[best]}" sonucunun haber yokken bile beklenen olasılığından (${pctOf(base[best])}) düşük: model kendisiyle çelişiyor.`,
    };
  }
  const edge = confidence - base[direction];
  if (edge < MIN_EDGE) {
    return {
      record: false,
      code: "no_edge",
      reason: `${pctOf(confidence)} güven, taban oranın (${pctOf(base[direction])}) yalnızca ${Math.round(edge * 100)} puan üstünde; en az ${Math.round(MIN_EDGE * 100)} puan gerekir.`,
    };
  }
  return { record: true };
}

export type AbstentionRow = {
  id: number;
  analysis_id: string;
  news_id: string;
  mode: "live" | "backtest";
  token: string;
  horizon_h: number;
  reason: string;
  reason_code: AbstainCode;
  model_direction: Dir | null;
  model_confidence: number | null;
  base_prob: number | null;
  created_at: number;
};

export type Coverage = {
  opportunities: number;
  predicted: number;
  abstained: number;
  rate: number | null;
  byReason: { code: AbstainCode; n: number }[];
};

/**
 * Coverage is measured from the analyses run under the recording gate (those
 * that left at least one abstention or a gated prediction), so it reflects how
 * often the system chose to speak.
 */
export function coverage(mode?: "live" | "backtest"): Coverage {
  const where = mode ? "WHERE mode = ?" : "";
  const args = mode ? [mode] : [];
  const abst = (
    db().prepare(`SELECT reason_code AS code, COUNT(*) AS n FROM abstentions ${where} GROUP BY reason_code ORDER BY n DESC`).all(...args) as {
      code: AbstainCode;
      n: number;
    }[]
  ).map((r) => ({ code: r.code, n: Number(r.n) }));
  const abstained = abst.reduce((a, r) => a + r.n, 0);
  const predicted = (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM predictions WHERE base_prob IS NOT NULL ${mode ? "AND mode = ?" : ""}`)
      .get(...args) as { n: number }
  ).n;
  const opportunities = predicted + abstained;
  return { opportunities, predicted, abstained, rate: opportunities ? predicted / opportunities : null, byReason: abst };
}

export function abstentionsFor(analysisId: string): AbstentionRow[] {
  return db().prepare(`SELECT * FROM abstentions WHERE analysis_id = ? ORDER BY token, horizon_h`).all(analysisId) as AbstentionRow[];
}

export async function evaluateDue(now = Date.now(), getPrice = priceAt): Promise<{ evaluated: number; nodata: number }> {
  const due = db()
    .prepare(`SELECT * FROM predictions WHERE status = 'pending' AND entry_ts + horizon_h * 3600000 <= ? ORDER BY entry_ts LIMIT 200`)
    .all(now - EVAL_GRACE_MS) as PredictionRow[];
  const update = db().prepare(
    `UPDATE predictions SET status = ?, actual_dir = ?, exit_price = ?, change_pct = ?, evaluated_at = ? WHERE id = ? AND status = 'pending'`,
  );
  let evaluated = 0;
  let nodata = 0;
  for (const p of due) {
    const target = p.entry_ts + p.horizon_h * 3_600_000;
    let exit: number | null = null;
    try {
      exit = await getPrice(p.inst_id, target);
    } catch {
      continue; // transient network issue: retry on the next tick
    }
    if (exit === null || !(p.entry_price > 0)) {
      // Give the exchange a day to backfill before declaring no data.
      if (now - target > 24 * 3_600_000) {
        update.run("nodata", null, null, null, now, p.id);
        nodata++;
      }
      continue;
    }
    const change = exit / p.entry_price - 1;
    const actual = actualDirection(change, p.horizon_h);
    update.run(actual === p.direction ? "correct" : "wrong", actual, exit, change, now, p.id);
    evaluated++;
  }
  return { evaluated, nodata };
}

export type Bucket = { label: string; lo: number; hi: number; n: number; avgConfidence: number; hitRate: number | null };

export type Stats = {
  n: number;
  correct: number;
  accuracy: number | null;
  brier: number | null;
  pending: number;
  baselines: { momentum: number | null; alwaysUp: number | null; alwaysFlat: number | null };
  /** Accuracy minus the strongest simple rule on the same predictions (positive = real skill). */
  skill: { vsBest: number | null; best: "momentum" | "alwaysUp" | "alwaysFlat" | null };
  /**
   * Brier skill score vs the no-news base-rate forecast, over predictions that
   * stored their base rate: 1 − Brier(model) / Brier(base). >0 = adds information.
   */
  bss: { value: number | null; n: number };
  byHorizon: { horizon: number; n: number; accuracy: number | null }[];
  byEventType: { eventType: string; n: number; accuracy: number | null }[];
  byToken: { token: string; n: number; accuracy: number | null }[];
  calibration: Bucket[];
};

const rate = (hits: number, n: number) => (n ? hits / n : null);

export function computeStats(rows: PredictionRow[]): Stats {
  const done = rows.filter((r) => r.status === "correct" || r.status === "wrong");
  const hit = (r: PredictionRow) => (r.status === "correct" ? 1 : 0);
  const correct = done.reduce((a, r) => a + hit(r), 0);

  const group = <K extends string | number>(key: (r: PredictionRow) => K) => {
    const m = new Map<K, { n: number; hits: number }>();
    for (const r of done) {
      const k = key(r);
      const cur = m.get(k) ?? { n: 0, hits: 0 };
      cur.n++;
      cur.hits += hit(r);
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  };

  const edges = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
  const calibration: Bucket[] = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const inB = done.filter((r) => r.confidence >= lo && r.confidence < hi);
    const label = i === 0 ? "<50" : `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}`;
    return {
      label,
      lo,
      hi: Math.min(hi, 1),
      n: inB.length,
      avgConfidence: inB.length ? inB.reduce((a, r) => a + r.confidence, 0) / inB.length : (lo + Math.min(hi, 1)) / 2,
      hitRate: rate(inB.reduce((a, r) => a + hit(r), 0), inB.length),
    };
  });

  const baselines = {
    momentum: rate(done.filter((r) => r.momentum_dir === r.actual_dir).length, done.length),
    alwaysUp: rate(done.filter((r) => r.actual_dir === "up").length, done.length),
    alwaysFlat: rate(done.filter((r) => r.actual_dir === "flat").length, done.length),
  };
  const accuracy = rate(correct, done.length);
  const bestKey = (Object.keys(baselines) as (keyof typeof baselines)[]).reduce<keyof typeof baselines | null>(
    (best, k) => (baselines[k] !== null && (best === null || baselines[k]! > baselines[best]!) ? k : best),
    null,
  );
  const withBase = done.filter((r) => r.base_prob !== null && r.base_prob !== undefined);
  const brierModel = withBase.reduce((a, r) => a + (r.confidence - hit(r)) ** 2, 0);
  const brierRef = withBase.reduce((a, r) => a + (r.base_prob! - hit(r)) ** 2, 0);

  return {
    n: done.length,
    correct,
    accuracy,
    brier: done.length ? done.reduce((a, r) => a + (r.confidence - hit(r)) ** 2, 0) / done.length : null,
    pending: rows.filter((r) => r.status === "pending").length,
    baselines,
    skill: { vsBest: accuracy !== null && bestKey ? accuracy - baselines[bestKey]! : null, best: bestKey },
    bss: { value: withBase.length && brierRef > 0 ? 1 - brierModel / brierRef : null, n: withBase.length },
    byHorizon: group((r) => r.horizon_h).map(([horizon, v]) => ({ horizon, n: v.n, accuracy: rate(v.hits, v.n) })),
    byEventType: group((r) => r.event_type).map(([eventType, v]) => ({ eventType, n: v.n, accuracy: rate(v.hits, v.n) })),
    byToken: group((r) => r.token).map(([token, v]) => ({ token, n: v.n, accuracy: rate(v.hits, v.n) })),
    calibration,
  };
}

export function allPredictions(filter: { mode?: "live" | "backtest"; token?: string } = {}): PredictionRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.mode) {
    where.push("mode = ?");
    args.push(filter.mode);
  }
  if (filter.token) {
    where.push("token = ?");
    args.push(filter.token);
  }
  const sql = `SELECT * FROM predictions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY entry_ts DESC`;
  return db().prepare(sql).all(...args) as PredictionRow[];
}

const pct = (x: number | null) => (x === null ? "—" : `%${Math.round(x * 100)}`);

/**
 * Track-record memory handed to the Strategy agent: how well past calls of this
 * kind did, where confidence was miscalibrated, and the latest misses.
 */
export function trackRecordMemory(eventType: string, tokens: string[]): string {
  const rows = allPredictions();
  const s = computeStats(rows);
  if (s.n === 0) return "Henüz puanlanmış tahmin yok. Güven değerlerini temkinli ver (çoğunlukla 50-70 arası).";

  const lines: string[] = [];
  lines.push(`Genel: ${s.n} puanlanmış tahmin, isabet ${pct(s.accuracy)}, Brier ${s.brier?.toFixed(3)}.`);
  lines.push(
    `Basit kurallar aynı tahminlerde: momentum ${pct(s.baselines.momentum)}, hep-yükseliş ${pct(s.baselines.alwaysUp)}, hep-yatay ${pct(s.baselines.alwaysFlat)}.`,
  );
  const ev = s.byEventType.find((e) => e.eventType === eventType);
  if (ev) lines.push(`Bu olay tipinde (${eventType}): ${ev.n} tahmin, isabet ${pct(ev.accuracy)}.`);
  for (const t of tokens) {
    const tk = s.byToken.find((x) => x.token === t);
    if (tk && tk.n >= 3) lines.push(`${t}: ${tk.n} tahmin, isabet ${pct(tk.accuracy)}.`);
  }
  const miscal = s.calibration.filter((b) => b.n >= 5 && b.hitRate !== null && Math.abs(b.hitRate - b.avgConfidence) > 0.12);
  for (const b of miscal) {
    lines.push(
      `Kalibrasyon: ${b.label} güven aralığında ortalama güven ${pct(b.avgConfidence)}, gerçekleşen ${pct(b.hitRate)} → ${
        (b.hitRate ?? 0) < b.avgConfidence ? "fazla emin" : "fazla temkinli"
      }.`,
    );
  }
  const misses = rows.filter((r) => r.status === "wrong").slice(0, 6);
  if (misses.length) {
    lines.push("Son yanlış tahminler:");
    for (const m of misses) {
      lines.push(
        `- ${m.token} ${m.horizon_h}s: "${m.direction}" dendi (güven ${pct(m.confidence)}), gerçekleşen ${m.actual_dir} (${((m.change_pct ?? 0) * 100).toFixed(2)}%). Mekanizma: ${m.mechanism.slice(0, 140)}`,
      );
    }
  }
  return lines.join("\n");
}
