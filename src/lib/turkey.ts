import { XMLParser } from "fast-xml-parser";
import { db } from "./db.ts";
import { midOf, tickers, type Ticker } from "./market.ts";

/**
 * Türkiye primi — OKX TR specific signals.
 *
 *  Token premium = TRY mid / (USDT mid × USDT/TRY mid) − 1
 *    How much more (or less) a token costs on the TRY book than its global USDT
 *    price implies. Persistent positive premium = local demand pressure.
 *  USDT premium  = USDT/TRY mid / TCMB USD mid − 1
 *    Price of crypto dollars vs the official dollar: a classic Turkish demand gauge.
 *  Basket premium = TRY-volume-weighted token premium over liquid pairs.
 */

export const LIQUID_TRY_VOL = 1_000_000; // 24h TRY volume below which a pair's premium is mostly noise

export type TokenPremium = {
  symbol: string;
  tryMid: number;
  usdtMid: number;
  premium: number;
  tryVol24h: number;
  liquid: boolean;
};

export type Tcmb = { date: string; buy: number; sell: number; mid: number };

export type TurkeySnapshot = {
  at: number;
  usdtTry: number;
  tcmb: Tcmb | null;
  usdtPremium: number | null;
  basketPremium: number | null;
  tokens: TokenPremium[];
};

export function tokenPremium(tryT: Ticker, usdtT: Ticker, usdtTry: number): number | null {
  const a = midOf(tryT);
  const b = midOf(usdtT);
  if (!(a > 0 && b > 0 && usdtTry > 0)) return null;
  return a / (b * usdtTry) - 1;
}

/** Volume-weighted mean premium over liquid pairs. */
export function basketPremium(tokens: TokenPremium[]): number | null {
  const liquid = tokens.filter((t) => t.liquid);
  const w = liquid.reduce((a, t) => a + t.tryVol24h, 0);
  return w > 0 ? liquid.reduce((a, t) => a + t.premium * t.tryVol24h, 0) / w : null;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
const g = globalThis as unknown as { __signalmindTcmb?: { at: number; value: Tcmb | null } };

/** TCMB indicative USD/TRY (forex buying/selling), cached for an hour. */
export async function tcmbUsd(): Promise<Tcmb | null> {
  const c = g.__signalmindTcmb;
  if (c && Date.now() - c.at < 3_600_000) return c.value;
  let value: Tcmb | null = null;
  try {
    const res = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const doc = parser.parse(await res.text());
    const list = doc?.Tarih_Date?.Currency;
    const usd = (Array.isArray(list) ? list : [list]).find((x: Record<string, unknown>) => x?.CurrencyCode === "USD" || x?.Kod === "USD");
    const buy = Number(usd?.ForexBuying);
    const sell = Number(usd?.ForexSelling);
    if (buy > 0 && sell > 0) value = { date: String(doc.Tarih_Date.Tarih ?? ""), buy, sell, mid: (buy + sell) / 2 };
  } catch {
    value = c?.value ?? null; // keep the last good rate on a transient failure
  }
  g.__signalmindTcmb = { at: Date.now(), value };
  return value;
}

export async function turkeySnapshot(): Promise<TurkeySnapshot> {
  const [all, tcmb] = await Promise.all([tickers(), tcmbUsd()]);
  const usdtTryT = all.get("USDT-TRY");
  const usdtTry = usdtTryT ? midOf(usdtTryT) : 0;
  const tokens: TokenPremium[] = [];
  for (const t of all.values()) {
    if (!t.instId.endsWith("-TRY")) continue;
    const symbol = t.instId.slice(0, -4);
    if (symbol === "USDT" || symbol === "USDC") continue;
    const u = all.get(`${symbol}-USDT`);
    if (!u) continue;
    const p = tokenPremium(t, u, usdtTry);
    if (p === null) continue;
    tokens.push({ symbol, tryMid: midOf(t), usdtMid: midOf(u), premium: p, tryVol24h: t.volQuote24h, liquid: t.volQuote24h >= LIQUID_TRY_VOL });
  }
  tokens.sort((a, b) => b.tryVol24h - a.tryVol24h);
  return {
    at: Date.now(),
    usdtTry,
    tcmb,
    usdtPremium: tcmb && usdtTry ? usdtTry / tcmb.mid - 1 : null,
    basketPremium: basketPremium(tokens),
    tokens,
  };
}

/* ---- History: one row every 5 minutes, written by the scheduler ---- */

const HISTORY_EVERY_MS = 5 * 60_000;

export async function recordTurkeyHistory(now = Date.now()): Promise<boolean> {
  const last = db().prepare(`SELECT MAX(ts) AS ts FROM tr_premium`).get() as { ts: number | null };
  if (last.ts && now - last.ts < HISTORY_EVERY_MS) return false;
  const s = await turkeySnapshot();
  const pick = (sym: string) => s.tokens.find((t) => t.symbol === sym)?.premium ?? null;
  db()
    .prepare(`INSERT OR IGNORE INTO tr_premium (ts, usdt_try, tcmb_mid, usdt_premium, basket_premium, btc_premium, eth_premium) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(now, s.usdtTry, s.tcmb?.mid ?? null, s.usdtPremium, s.basketPremium, pick("BTC"), pick("ETH"));
  return true;
}

export type PremiumPoint = { ts: number; usdt_try: number; tcmb_mid: number | null; usdt_premium: number | null; basket_premium: number | null; btc_premium: number | null; eth_premium: number | null };

export function turkeyHistory(hours = 48): PremiumPoint[] {
  return (db().prepare(`SELECT * FROM tr_premium WHERE ts >= ? ORDER BY ts`).all(Date.now() - hours * 3_600_000) as PremiumPoint[]).map((r) => ({ ...r }));
}
