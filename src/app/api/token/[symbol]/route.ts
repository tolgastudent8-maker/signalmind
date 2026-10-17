import { NextResponse } from "next/server";
import { candles, midOf, orderbook, tickers, universe } from "@/lib/market.ts";
import { LIQUID_TRY_VOL, tokenPremium } from "@/lib/turkey.ts";
import { okxCoinNews, tokenStories } from "@/lib/token-news.ts";
import { ensureFeeds } from "@/lib/scheduler.ts";
import { atr, bollinger, bookCoverage, bookStats, depthCurve, ema, last, macd, rsi } from "@/lib/indicators.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BARS = { "15m": 200, "1H": 200, "4H": 180 } as const;
type Bar = keyof typeof BARS;

export async function GET(req: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = (await ctx.params).symbol.toUpperCase();
  const q = new URL(req.url).searchParams.get("bar");
  const bar: Bar = q === "15m" || q === "4H" ? q : "1H";
  const uni = await universe();
  const token = uni.find((u) => u.symbol === symbol);
  if (!token) return NextResponse.json({ error: "Token OKX TR evreninde değil" }, { status: 404 });

  const [, series, book, all, okxNews] = await Promise.all([
    ensureFeeds(), // archive stories for the news card (on demand on serverless hosts)
    candles(token.instId, bar, BARS[bar]),
    orderbook(token.instId, 400).catch(() => null),
    tickers(),
    okxCoinNews(symbol),
  ]);
  const closes = series.map((c) => c.c);
  const bb = bollinger(closes);
  const m = macd(closes);
  const r = rsi(closes);
  const a = atr(series);
  const t = all.get(token.instId);
  const tryT = all.get(`${symbol}-TRY`);
  const usdtTry = all.get("USDT-TRY");
  const prem = tryT && t && usdtTry ? tokenPremium(tryT, t, midOf(usdtTry)) : null;

  return NextResponse.json({
    token,
    bar,
    ticker: t ? { high24h: t.high24h, low24h: t.low24h, open24h: t.open24h } : null,
    turkey: tryT && prem !== null ? { premium: prem, tryMid: midOf(tryT), tryVol24h: tryT.volQuote24h, liquid: tryT.volQuote24h >= LIQUID_TRY_VOL } : null,
    candles: series,
    indicators: { ema20: ema(closes, 20), ema50: ema(closes, 50), bbUpper: bb.upper, bbMid: bb.mid, bbLower: bb.lower, rsi: r, macd: m.macd, signal: m.signal, hist: m.hist },
    readout: {
      rsi: last(r),
      macd: last(m.macd),
      signal: last(m.signal),
      hist: last(m.hist),
      prevHist: m.hist.length > 1 ? m.hist[m.hist.length - 2] : null,
      atr: last(a),
      bbUpper: last(bb.upper),
      bbLower: last(bb.lower),
      ema20: last(ema(closes, 20)),
      ema50: last(ema(closes, 50)),
    },
    book: book
      ? {
          bids: book.bids.slice(0, 20),
          asks: book.asks.slice(0, 20),
          levels: { bids: book.bids.length, asks: book.asks.length },
          ts: book.ts,
          stats: bookStats(book.bids, book.asks),
          // Chart only the band the fetched levels actually cover (≤ ±2%); a fixed ±2% made every
          // liquid book a flat block, since 400 levels of BTC/ETH span only a few hundredths of a percent.
          curve: (() => {
            const range = Math.min(0.02, Math.max(0.0002, bookCoverage(book.bids, book.asks)));
            const c = depthCurve(book.bids, book.asks, range);
            return c ? { ...c, range } : null;
          })(),
        }
      : null,
    news: { archive: tokenStories(symbol), okx: okxNews },
  });
}
