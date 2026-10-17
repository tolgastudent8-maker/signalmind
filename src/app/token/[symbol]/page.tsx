"use client";

import Link from "next/link";
import { use, useState } from "react";
import { BookLadder, DepthChart, TechChart, fmtBand, type Indicators } from "@/components/tech-chart";
import { fmtPrem } from "@/components/turkey-card";
import { Badge, Card, Empty, Pct, fmtPrice, timeAgo, usePoll } from "@/components/ui";
import type { OkxNewsItem, TokenStory } from "@/lib/token-news";
import type { Candle, UniverseToken } from "@/lib/market";
import type { BookStats, DepthPoint } from "@/lib/indicators";

type Readout = {
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  hist: number | null;
  prevHist: number | null;
  atr: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  ema20: number | null;
  ema50: number | null;
};

type Data = {
  token: UniverseToken;
  bar: "15m" | "1H" | "4H";
  ticker: { high24h: number; low24h: number; open24h: number } | null;
  turkey: { premium: number; tryMid: number; tryVol24h: number; liquid: boolean } | null;
  candles: Candle[];
  indicators: Indicators;
  readout: Readout;
  book: {
    bids: { px: number; sz: number }[];
    asks: { px: number; sz: number }[];
    levels: { bids: number; asks: number };
    ts: number;
    stats: BookStats | null;
    curve: { bids: DepthPoint[]; asks: DepthPoint[]; range: number } | null;
  } | null;
  news: { archive: TokenStory[]; okx: { items: OkxNewsItem[]; error?: string } };
};

const SENTIMENT: Record<string, { label: string; tone: "up" | "down" | "neutral" }> = {
  bullish: { label: "olumlu", tone: "up" },
  bearish: { label: "olumsuz", tone: "down" },
  neutral: { label: "nötr", tone: "neutral" },
};

/** Archive stories about the token (corroborated first) and live OKX ATK news for it. */
function TokenNews({ symbol, news }: { symbol: string; news: Data["news"] }) {
  const verified = news.archive.filter((s) => s.corroborated);
  const single = news.archive.filter((s) => !s.corroborated);
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card title={`${symbol} · doğrulanmış haberler`} action={<span className="text-[11px] text-ink-500">≥2 bağımsız yayın · son 72 saat</span>}>
        {verified.length === 0 ? (
          <Empty>Son 72 saatte {symbol} hakkında birden çok yayında geçen haber yok.</Empty>
        ) : (
          <ul className="space-y-3">
            {verified.map((s) => (
              <li key={s.id} className="rounded-xl bg-ink-900/60 p-3.5 ring-1 ring-ink-800">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="up">✓ {s.outlets} yayın</Badge>
                  <span className="num text-[11px] text-ink-500">{timeAgo(s.publishedAt)}</span>
                </div>
                <p className="mt-1.5 text-[13.5px] text-ink-100">{s.title}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.sources.map((x, i) =>
                    x.url ? (
                      <a key={i} href={x.url} target="_blank" rel="noreferrer" title={x.title} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300 hover:text-ink-100">
                        {x.source} ↗
                      </a>
                    ) : (
                      <span key={i} title={x.title} className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300">
                        {x.source}
                      </span>
                    ),
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {single.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] text-ink-400 hover:text-ink-200">Tek kaynaklı haberler ({single.length}) · doğrulanmış sayılmaz</summary>
            <ul className="mt-2 space-y-1.5">
              {single.map((s) => (
                <li key={s.id} className="flex gap-2 text-[12.5px]">
                  <span className="num w-16 shrink-0 text-[11px] text-ink-500">{timeAgo(s.publishedAt)}</span>
                  {s.sources[0]?.url ? (
                    <a href={s.sources[0].url} target="_blank" rel="noreferrer" className="text-ink-300 hover:text-ink-100">
                      {s.title} <span className="text-ink-500">· {s.sources[0].source}</span>
                    </a>
                  ) : (
                    <span className="text-ink-300">
                      {s.title} <span className="text-ink-500">· {s.sources[0]?.source}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title={`${symbol} · OKX ATK haberleri`} action={<Badge tone="atk">canlı · news_get_by_coin</Badge>}>
        {news.okx.items.length === 0 ? (
          <Empty>{news.okx.error ? `OKX haber modülüne ulaşılamadı: ${news.okx.error}` : `OKX'te ${symbol} için haber yok.`}</Empty>
        ) : (
          <ul className="space-y-3">
            {news.okx.items.map((n) => {
              const s = n.sentiment ? SENTIMENT[n.sentiment] : undefined;
              return (
                <li key={n.id} className="rounded-xl bg-ink-900/60 p-3.5 ring-1 ring-ink-800">
                  <div className="flex flex-wrap items-center gap-2">
                    {s && <Badge tone={s.tone}>{s.label}</Badge>}
                    {n.importance === "high" && <Badge tone="judge">önemli</Badge>}
                    <span className="num text-[11px] text-ink-500">{timeAgo(n.publishedAt)}</span>
                  </div>
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noreferrer" className="mt-1.5 block text-[13.5px] text-ink-100 hover:underline">
                      {n.title}
                    </a>
                  ) : (
                    <p className="mt-1.5 text-[13.5px] text-ink-100">{n.title}</p>
                  )}
                  {n.summary && <p className="mt-1 line-clamp-2 text-[12px] text-ink-400">{n.summary}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

const BARS = [
  { id: "15m", label: "15dk" },
  { id: "1H", label: "1s" },
  { id: "4H", label: "4s" },
] as const;

const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}k`);

type Signal = { label: string; value: string; read: string; tone: "up" | "down" | "flat" };

/** Plain-language reading of each indicator. Descriptive only — not a recommendation. */
function signals(r: Readout, price: number): Signal[] {
  const out: Signal[] = [];
  if (r.rsi !== null) {
    out.push({
      label: "RSI 14",
      value: r.rsi.toFixed(1),
      read: r.rsi >= 70 ? "aşırı alım bölgesi" : r.rsi <= 30 ? "aşırı satım bölgesi" : r.rsi >= 55 ? "alıcılar baskın" : r.rsi <= 45 ? "satıcılar baskın" : "nötr",
      tone: r.rsi >= 55 ? "up" : r.rsi <= 45 ? "down" : "flat",
    });
  }
  if (r.hist !== null) {
    const crossUp = r.prevHist !== null && r.prevHist <= 0 && r.hist > 0;
    const crossDown = r.prevHist !== null && r.prevHist >= 0 && r.hist < 0;
    out.push({
      label: "MACD",
      value: `${r.hist >= 0 ? "+" : ""}${r.hist.toPrecision(2)}`,
      read: crossUp ? "yukarı kesişim (son mum)" : crossDown ? "aşağı kesişim (son mum)" : r.hist > 0 ? "sinyal çizgisinin üstünde" : "sinyal çizgisinin altında",
      tone: r.hist > 0 ? "up" : "down",
    });
  }
  if (r.ema20 !== null && r.ema50 !== null) {
    const gap = r.ema20 / r.ema50 - 1;
    out.push({
      label: "Trend",
      value: `${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(2)}%`,
      read: gap > 0.002 ? "EMA20 > EMA50 · yükseliş" : gap < -0.002 ? "EMA20 < EMA50 · düşüş" : "EMA'lar iç içe · yatay",
      tone: gap > 0.002 ? "up" : gap < -0.002 ? "down" : "flat",
    });
  }
  if (r.bbUpper !== null && r.bbLower !== null && r.bbUpper > r.bbLower) {
    const b = (price - r.bbLower) / (r.bbUpper - r.bbLower);
    out.push({
      label: "Bollinger %B",
      value: b.toFixed(2),
      read: b > 1 ? "üst bandın dışında" : b < 0 ? "alt bandın dışında" : b > 0.8 ? "üst banda yakın" : b < 0.2 ? "alt banda yakın" : "bant ortasında",
      tone: b > 0.8 ? "up" : b < 0.2 ? "down" : "flat",
    });
  }
  if (r.atr !== null && price > 0) {
    out.push({ label: "ATR 14", value: `${((r.atr / price) * 100).toFixed(2)}%`, read: "mum başına ortalama gerçek aralık", tone: "flat" });
  }
  return out;
}

export default function TokenPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const [bar, setBar] = useState<Data["bar"]>("1H");
  const { data, error } = usePoll<Data>(`/api/token/${symbol}?bar=${bar}`, 30000);

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <div className="shimmer h-[640px] rounded-2xl bg-ink-850" />;
  const { token, candles, indicators, readout, book, ticker } = data;
  const sig = signals(readout, token.last);
  const bs = book?.stats ?? null;

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="card flex flex-wrap items-end gap-x-8 gap-y-3 px-5 py-4">
        <div>
          <Link href="/tokenlar" className="text-xs text-ink-400 hover:text-ink-200">
            ← Tokenlar
          </Link>
          <div className="mt-0.5 flex items-baseline gap-2">
            <h1 className="num text-3xl font-semibold">{token.symbol}</h1>
            <span className="num text-xs text-ink-500">{token.instId} · OKX TR</span>
          </div>
        </div>
        <div>
          <div className="num text-2xl text-ink-100">${fmtPrice(token.last)}</div>
          <Pct value={token.change24h} className="text-sm" />
        </div>
        {[
          ["24s yüksek", ticker ? `$${fmtPrice(ticker.high24h)}` : "—"],
          ["24s düşük", ticker ? `$${fmtPrice(ticker.low24h)}` : "—"],
          ["24s hacim", usd(token.volUsd24h)],
          ["Spread", bs ? `${bs.spreadBps.toFixed(2)} bp` : "—"],
          ["TRY fiyatı", data.turkey ? `₺${fmtPrice(data.turkey.tryMid)}` : "—"],
          ["TR primi", data.turkey ? `${fmtPrem(data.turkey.premium, 3)}${data.turkey.liquid ? "" : " · sığ"}` : "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{k}</div>
            <div className="num text-sm text-ink-100">{v}</div>
          </div>
        ))}
        <div className="ml-auto flex rounded-lg bg-ink-900 p-1 ring-1 ring-ink-700">
          {BARS.map((b) => (
            <button
              key={b.id}
              onClick={() => setBar(b.id)}
              className={`num rounded-md px-3 py-1 text-xs ${bar === b.id ? "bg-ink-700 text-ink-100" : "text-ink-400 hover:text-ink-100"}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Indicator readout */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {sig.map((s) => (
          <div key={s.label} className="card px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-500">{s.label}</div>
            <div className={`num mt-1 text-lg ${s.tone === "up" ? "text-up" : s.tone === "down" ? "text-down" : "text-ink-100"}`}>{s.value}</div>
            <div className="text-[11px] text-ink-400">{s.read}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title={`Fiyat · ${BARS.find((b) => b.id === bar)?.label} mum · ${candles.length} mum`} action={<span className="num text-[11px] text-ink-500">kaynak: ATK MCP · göstergeler kodla hesaplanır</span>}>
          <div className="grid-bg -m-1 rounded-lg p-1">
            <TechChart
              candles={candles}
              ind={indicators}
              bar={bar}
              markers={[]}
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Emir defteri" action={book ? <span className="num text-[11px] text-ink-500">{timeAgo(book.ts)} · {book.levels.bids}+{book.levels.asks} kademe</span> : undefined}>
            {book ? <BookLadder bids={book.bids} asks={book.asks} /> : <Empty>Emir defteri alınamadı.</Empty>}
          </Card>
          {book?.curve && bs && (
            <Card title={`Derinlik · ±${fmtBand(book.curve.range)}`}>
              <DepthChart curve={book.curve} mid={bs.mid} range={book.curve.range} />
              <div className="num mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <span className="text-ink-500">bant</span>
                <span className="text-right text-up">alış</span>
                <span className="text-right text-down">satış</span>
                {bs.depth.map((d) => (
                  <div key={d.pct} className="contents">
                    <span className="text-ink-400">±%{d.pct * 100}</span>
                    <span className="text-right text-ink-200">
                      {d.covered ? "" : "≥ "}
                      {usd(d.bid)}
                    </span>
                    <span className="text-right text-ink-200">
                      {d.covered ? "" : "≥ "}
                      {usd(d.ask)}
                    </span>
                  </div>
                ))}
              </div>
              {bs.depth.some((d) => !d.covered) && (
                <p className="mt-1.5 text-[11px] text-ink-500">
                  İlk {book.levels.bids} kademe fiyatın yalnızca ±{fmtBand(bs.coverage)} yakınını kapsıyor; daha geniş bantlar en az bu kadar derin.
                </p>
              )}
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px]">
                  <span className="text-ink-400">Dengesizlik (±%1)</span>
                  <span className={`num ${bs.imbalance > 0 ? "text-up" : bs.imbalance < 0 ? "text-down" : "text-ink-200"}`}>
                    {bs.imbalance > 0 ? "+" : ""}
                    {(bs.imbalance * 100).toFixed(0)}%
                  </span>
                </div>
                {/* Diverging bar: centre is balance, left = sell-heavy, right = buy-heavy. */}
                <div className="relative h-1.5 rounded-full bg-ink-800">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-ink-500" />
                  <div
                    className={`absolute inset-y-0 rounded-full ${bs.imbalance >= 0 ? "bg-up" : "bg-down"}`}
                    style={bs.imbalance >= 0 ? { left: "50%", width: `${bs.imbalance * 50}%` } : { right: "50%", width: `${-bs.imbalance * 50}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-ink-500">Pozitif: fiyata %1 mesafede bekleyen alış emri satıştan fazla.</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      <TokenNews symbol={token.symbol} news={data.news} />

      <p className="text-[11px] text-ink-500">Göstergeler betimleyicidir: OKX TR mumlarından kodla hesaplanır, yatırım tavsiyesi değildir.</p>
    </div>
  );
}
