import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { getNews, storyMates, type NewsItem } from "../news.ts";
import { universe, snapshot, priceAt, tickers, type Snapshot, type UniverseToken } from "../market.ts";
import { atkCall, atkTools } from "../atk.ts";
import { turkeySnapshot, type TurkeySnapshot } from "../turkey.ts";
import { baseRate, evaluateDue, gatePrediction, MIN_EDGE, trackRecordMemory, type AbstainCode, type BaseRate } from "../scorecard.ts";
import { structured, structuredWithTools, aiConfigured, aiInfo, AgentError, type ToolCallLog, type ToolSpec, type Usage } from "./llm.ts";
import {
  NewsAnalysisSchema,
  ImpactSchema,
  CaseSchema,
  VerdictSchema,
  StrategySchema,
  type NewsAnalysis,
  type Impact,
  type Case,
  type Verdict,
  type Strategy,
} from "./schemas.ts";

export type AgentId = "system" | "news" | "impact" | "bull" | "bear" | "judge" | "strategy";
export type Mode = "live" | "backtest";

export type TokenSnapshot = Snapshot & { symbol: string; moveSinceNews: number | null; base1h?: BaseRate | null; base24h?: BaseRate | null };

export type AnalysisResult = {
  news: NewsAnalysis;
  impact: Impact;
  snapshots: TokenSnapshot[];
  bull: Case;
  bear: Case;
  verdict: Verdict;
  strategy: Strategy;
  trackRecord: string;
  toolCalls: ToolCallLog[];
  usage: Usage;
  droppedTokens: string[];
  model?: string;
};

export const MAX_TOKENS = 6;
export const AGENT_TOOLS = ["market_get_ticker", "market_get_candles", "market_get_indicator", "market_get_orderbook"];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x / 100));

function emit(analysisId: string, agent: AgentId, kind: "start" | "done" | "tool" | "error" | "info", title: string, payload?: unknown) {
  db()
    .prepare(`INSERT INTO events (analysis_id, ts, agent, kind, title, payload_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(analysisId, Date.now(), agent, kind, title, payload === undefined ? null : JSON.stringify(payload));
}

const fmtPct = (x: number | null) => (x === null ? "?" : `${(x * 100).toFixed(2)}%`);

function newsBlock(n: NewsItem, mates: { source: string; title: string }[] = []): string {
  const when = n.published_at ? new Date(n.published_at).toISOString() : "bilinmiyor";
  const others = mates.length
    ? `\n<ayni_olayi_aktaran_diger_kaynaklar>\n${mates.map((m) => `- ${m.source}: ${m.title}`).join("\n")}\n</ayni_olayi_aktaran_diger_kaynaklar>`
    : "";
  return `<haber kaynak="${n.source}" yayin="${when}">\nBaşlık: ${n.title}\n${n.summary ? `Metin: ${n.summary}\n` : ""}${n.url ? `URL: ${n.url}\n` : ""}</haber>${others}`;
}

const fmtBase = (b: BaseRate | null | undefined) =>
  b ? `yatay %${Math.round(b.flat * 100)} / yükseliş %${Math.round(b.up * 100)} / düşüş %${Math.round(b.down * 100)}` : "?";

function snapshotLines(snaps: TokenSnapshot[]): string {
  const rows = snaps.map(
    (s) =>
      `${s.symbol} (${s.instId}): fiyat ${s.price ?? "?"} | 1s ${fmtPct(s.ret1h)} | 4s ${fmtPct(s.ret4h)} | 24s ${fmtPct(s.ret24h)} | saatlik oynaklık ${fmtPct(s.hourlyVol)} | haberden beri ${fmtPct(s.moveSinceNews)}\n` +
      `   taban oran (haber yokmuş gibi, yalnız oynaklıktan): 1h → ${fmtBase(s.base1h)} · 24h → ${fmtBase(s.base24h)}`,
  );
  return rows.join("\n");
}

function turkeyLines(t: TurkeySnapshot, tokens: string[]): string {
  const p = (x: number | null) => (x === null ? "?" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`);
  const lines = [
    `USDT/TRY ${t.usdtTry.toFixed(3)} · TCMB USD ${t.tcmb ? t.tcmb.mid.toFixed(3) : "?"} → USDT primi ${p(t.usdtPremium)}`,
    `Likit TRY paritelerinde hacim ağırlıklı sepet primi: ${p(t.basketPremium)}`,
  ];
  for (const sym of tokens) {
    const x = t.tokens.find((k) => k.symbol === sym);
    if (x) lines.push(`${sym}: OKX TR TRY paritesi primi ${p(x.premium)} (24s TRY hacmi ${Math.round(x.tryVol24h).toLocaleString("tr-TR")}${x.liquid ? "" : ", sığ parite"})`);
  }
  lines.push("Not: Prim = TRY fiyatı / (USDT fiyatı × USDT/TRY) − 1. Pozitif prim Türkiye'deki yerel talep baskısına işaret eder; tek başına yön kanıtı değildir.");
  return lines.join("\n");
}

const LANG ="Tüm serbest metin alanlarını Türkçe yaz. Habere ve sana verilen veriye dayan; bilmediğin bir olguyu uydurma.";

const NEWS_SYSTEM = `Sen SignalMind'ın News Analyst ajanısın. Bir kripto/finans haberini piyasa etkisi açısından ayrıştırırsın.
- Olayı sınıflandır, önemini (materiality) ve yeniliğini değerlendir.
- Güvenilirlik puanı (0-100): kaynağın itibarı, resmi doğrulama, isimli kaynak, söylenti işaretleri ("iddia", "kulis", tek kaynak) üzerinden ver ve gerekçelendir.
  Aynı olayı başka bağımsız kaynaklar da aktarıyorsa (diğer kaynaklar bölümü) bu doğrulamadır; gerekçede kaç kaynağın aktardığını belirt. Tek kaynaklı iddia ise bunu da yaz.
- Somut olguları belirsizliklerden ayır.
- information_type alanında haberin türünü dürüstçe belirle. Birçok kripto haberi yeni bilgi değildir: "X %16 yükseldi" türü başlıklar fiyat özetidir (price_recap); bu hareket zaten fiyatlarda vardır.
${LANG}`;

const IMPACT_SYSTEM = `Sen SignalMind'ın Impact Radar ajanısın. Haberin hangi tokenları, hangi yönde ve hangi mekanizmayla etkileyeceğini çıkarırsın.
- Yalnızca EVREN listesindeki sembolleri kullan (OKX TR'de işlem gören tokenlar).
- En fazla ${MAX_TOKENS} token seç; az ama iyi gerekçelendirilmiş liste tercih et. BTC ve ETH'yi korelasyon çapası olarak her zaman değerlendir (etki yoksa "flat").
- relation: direct (haberde adı geçiyor), ecosystem (aynı zincir/ekosistem), sector (aynı sektör), macro (faiz/düzenleme), correlation (genel piyasa).
- mechanism alanında neden-sonuç zincirini açıkça yaz: haber → mekanizma → talep/arz → fiyat.
- confidence: yön tahmininin doğru çıkma olasılığı (0-100). Zayıf bağlantıya yüksek güven verme.
- News Analyst'in information_type alanına göre davran:
  · new_information: piyasanın yeni öğrendiği gelişme; neden-sonuç zinciri kurulabilir.
  · price_recap: haber, olmuş bir hareketin özetidir; geçmiş yükseliş tek başına devam edeceğinin kanıtı DEĞİLDİR. "Momentum sürer" gerekçesiyle 60 üzeri güven verme; fiyatlanmış olma ve geri çekilme ihtimalini mekanizmada açıkça tart.
  · opinion_analysis / educational: piyasaya yeni bilgi girmez; etkileri çoğunlukla zayıf ya da "flat" olur.
${LANG}`;

const BULL_SYSTEM = `Sen SignalMind'ın Bull (boğa) ajanısın. Bu haberin fiyatları YÜKSELTECEĞİ yönündeki en güçlü argümanı kurarsın.
- Her argümanı habere ya da verilen piyasa verisine dayanan bir kanıtla destekle; spekülatif olanların gücünü "low" işaretle.
- Tezini neyin çürüteceğini dürüstçe yaz.
${LANG}`;

const BEAR_SYSTEM = `Sen SignalMind'ın Bear (ayı) ajanısın. Bu haberin fiyatları DÜŞÜRECEĞİ ya da etkisinin abartıldığı/zaten fiyatlandığı yönündeki en güçlü argümanı kurarsın.
- Her argümanı habere ya da verilen piyasa verisine dayanan bir kanıtla destekle; spekülatif olanların gücünü "low" işaretle.
- Tezini neyin çürüteceğini dürüstçe yaz.
${LANG}`;

const JUDGE_SYSTEM = `Sen SignalMind'ın tarafsız hakemisin. Boğa ve ayı argümanlarını retoriğe değil kanıt kalitesine göre puanlarsın.
- Doğrulanabilir olguya dayanan argüman, spekülasyondan güçlüdür. Verilen piyasa verisiyle çelişen argümanı zayıf say.
- Geçmiş fiyat hareketi ("son 24 saatte %30 yükseldi", "momentum sürüyor") gelecekteki hareketin kanıtı değildir; bunu tek başına kanıt sayan argümanı zayıf say. Haber fiyat özetiyse (price_recap) bu kurala özellikle dikkat et.
- Kararı belirleyen noktaları ve iki taraftaki zayıf argümanları listele.
${LANG}`;

function strategySystem(mode: Mode): string {
  const tools =
    mode === "live"
      ? `- Sende OKX Agent Trade Kit (ATK) piyasa araçları var (OKX TR, salt okunur). Son karardan önce ana tokenlar için gerçek veriye bak:
  market_get_candles (5m veya 1H) ile haberden beri hareketi ve fiyatlanmayı, market_get_indicator ile RSI/MACD'yi, market_get_orderbook ile likiditeyi kontrol et.
  Odaklı ol: toplam en fazla 8 araç çağrısı. instId biçimi SEMBOL-USDT.`
      : `- Bu bir GERİYE DÖNÜK TESTTİR: yalnızca sana verilen haber anı öncesi piyasa verisini kullan; haberden sonra olanları bildiğini varsayma.`;
  return `Sen SignalMind'ın Strategy & Risk Analyst ajanısın. News Analyst, Impact Radar ve Boğa/Ayı tartışmasının çıktısını piyasa verisiyle birleştirip ölçülebilir tahminler üretirsin.
${tools}
- Her tahmin bir token, yön (up/down/flat), ufuk (1h veya 24h) ve güven (0-100) içerir. Tahminler sonradan gerçek fiyatla puanlanır:
  ufuk sonunda değişim 1h için ±%0,4, 24h için ±%1,5 bandının içindeyse gerçekleşen yön "flat" sayılır; dışındaysa up/down.
- Güven, yönün doğru çıkma olasılığıdır ve TABAN ORANDAN başlar: piyasa verisindeki "taban oran" satırı, haber hiç yokmuş gibi yalnız oynaklıktan hesaplanan olasılıklardır.
  Örneğin 1h için "yatay %58" yazıyorsa, hiçbir bilgi olmadan "flat" demenin isabeti zaten ~%58'dir. Güveni taban oranın üstüne ancak haberden veya ATK verisinden gelen somut bir kanıtla çıkar;
  kanıt zayıfsa taban orana yakın kal. Taban oranı %30 olan bir yöne 70 güven vermek çok güçlü bir iddiadır, gerekçesini yaz.
- Yön olarak EN OLASI sonucu seç: önce üç sonuca (up/flat/down) kafanda olasılık ver, sonra en yükseğini yön, onun olasılığını güven yap.
  Seçtiğin yönün güveni başka bir sonucun olasılığından düşükse yönü değiştir (ör. "down %35" diyorsan ve yatay daha olasıysa "flat" seç).
- ÇEKİMSER KALMAK DOĞRU BİR SONUÇTUR. Somut bir avantajın yoksa o token ve ufuk için tahmin listesine hiç ekleme. Kod şunları karneye almaz, çekimser sayar:
  güveni kendi taban oranının en az ${Math.round(MIN_EDGE * 100)} puan üstünde olmayan tahminler ve başka bir sonucun taban oranından düşük güvenli tahminler.
  Az ama gerçekten avantajlı tahmin, çok sayıda yazı-tura tahminden değerlidir. Tahminlerin yalnızca haber "yeni bilgi" ise karneye girer.
- GEÇMİŞ KARNE bölümündeki isabet ve kalibrasyon bilgisine göre güvenini ayrıca ayarla: fazla emin olduğun alanlarda düşür.
- Haber zaten fiyatlandıysa (haberden beri hareket oynaklığa göre büyükse) bunu priced_in alanında belirt ve yönü buna göre seç.
- Yalnızca Impact Radar'ın seçtiği tokenlar için tahmin ver; en fazla ${MAX_TOKENS} token, token başına her ufuk için en fazla bir tahmin.
- Senaryoların olasılık toplamı 100 olmalı. Bu bir karar destek analizidir, yatırım tavsiyesi değildir; stance alanını buna göre yaz.
${LANG}`;
}

function compactToolResult(raw: unknown): string {
  const env = raw as { data?: { data?: unknown } } | undefined;
  const body = env && typeof env === "object" && env.data && "data" in env.data ? env.data.data : raw;
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.length > 6000 ? `${s.slice(0, 6000)}…(kısaltıldı)` : s;
}

async function buildSnapshots(tokens: string[], uni: Map<string, UniverseToken>, mode: Mode, asOf: number, publishedAt: number | null): Promise<TokenSnapshot[]> {
  const live = mode === "live" ? await tickers() : null;
  return Promise.all(
    tokens.map(async (symbol) => {
      const instId = uni.get(symbol)!.instId;
      const snap = await snapshot(instId, asOf, live?.get(instId)?.last);
      let moveSinceNews: number | null = null;
      if (mode === "live" && publishedAt && asOf - publishedAt < 72 * 3_600_000 && snap.price) {
        const atNews = await priceAt(instId, publishedAt).catch(() => null);
        if (atNews) moveSinceNews = snap.price / atNews - 1;
      }
      return { ...snap, symbol, moveSinceNews, base1h: baseRate(snap.hourlyVol, 1), base24h: baseRate(snap.hourlyVol, 24) };
    }),
  );
}

export async function runAnalysis(analysisId: string): Promise<void> {
  const row = db().prepare(`SELECT * FROM analyses WHERE id = ?`).get(analysisId) as { news_id: string; mode: Mode; as_of: number };
  const news = getNews(row.news_id)!;
  const { mode, as_of: asOf } = row;
  const usage: Usage = { input: 0, output: 0 };
  const add = (u: Usage) => {
    usage.input += u.input;
    usage.output += u.output;
    if (u.models?.length) usage.models = [...new Set([...(usage.models ?? []), ...u.models])];
  };

  const ai = aiInfo();
  emit(analysisId, "system", "info", `${mode === "live" ? "Canlı analiz" : "Geriye dönük test"} başladı · ${ai.label} ${ai.model}`, { asOf, model: ai.model });

  // 1 — News Analyst
  emit(analysisId, "news", "start", "Haber ayrıştırılıyor");
  const mates = storyMates(news.id);
  const na = await structured({ system: NEWS_SYSTEM, user: newsBlock(news, mates), schema: NewsAnalysisSchema, effort: "low", agent: "news" });
  add(na.usage);
  emit(analysisId, "news", "done", na.data.headline, na.data);

  // 2 — Impact Radar over the OKX TR universe
  emit(analysisId, "impact", "start", "OKX TR evreninde etki taranıyor");
  const uniList = await universe();
  const uni = new Map(uniList.map((u) => [u.symbol, u]));
  const uniText = uniList.map((u) => `${u.symbol}(24s ${(u.change24h * 100).toFixed(1)}%, hacim $${Math.round(u.volUsd24h / 1e6)}M)`).join(", ");
  const imp = await structured({
    agent: "impact",
    system: IMPACT_SYSTEM,
    user: `${newsBlock(news)}\n\n<news_analyst>\n${JSON.stringify(na.data)}\n</news_analyst>\n\n<evren>\n${uniText}\n</evren>`,
    schema: ImpactSchema,
    effort: "medium",
  });
  add(imp.usage);
  const dropped: string[] = [];
  const seen = new Set<string>();
  imp.data.impacts = imp.data.impacts
    .map((i) => ({ ...i, token: i.token.trim().toUpperCase() }))
    .filter((i) => {
      if (!uni.has(i.token) || seen.has(i.token)) {
        if (!uni.has(i.token)) dropped.push(i.token);
        return false;
      }
      seen.add(i.token);
      return true;
    })
    .slice(0, MAX_TOKENS);
  if (dropped.length) emit(analysisId, "impact", "info", `Evren dışı semboller atıldı: ${dropped.join(", ")}`);
  if (!imp.data.impacts.length) throw new AgentError("Impact Radar OKX TR evreninden token bulamadı");
  emit(analysisId, "impact", "done", `${imp.data.impacts.length} token etkileniyor`, imp.data);

  // Market snapshot (code, not LLM) — strictly as of the analysis moment
  const tokens = imp.data.impacts.map((i) => i.token);
  const snaps = await buildSnapshots(tokens, uni, mode, asOf, news.published_at);
  emit(analysisId, "system", "info", "Piyasa anlık görüntüsü alındı", snaps);
  // Türkiye primi is a live-only signal: today's premium would leak into a backtest.
  const turkey = mode === "live" ? await turkeySnapshot().catch(() => null) : null;
  const turkeyBlock = turkey ? `\n\n<turkiye_primi>\n${turkeyLines(turkey, tokens)}\n</turkiye_primi>` : "";
  const context = `${newsBlock(news)}\n\n<news_analyst>\n${JSON.stringify(na.data)}\n</news_analyst>\n\n<impact_radar>\n${JSON.stringify(imp.data)}\n</impact_radar>\n\n<piyasa_verisi zaman="${new Date(asOf).toISOString()}">\n${snapshotLines(snaps)}\n</piyasa_verisi>${turkeyBlock}`;

  // 3 — Bull vs Bear in parallel, then the judge
  emit(analysisId, "bull", "start", "Boğa tezi kuruluyor");
  emit(analysisId, "bear", "start", "Ayı tezi kuruluyor");
  const [bull, bear] = await Promise.all([
    structured({ system: BULL_SYSTEM, user: context, schema: CaseSchema, effort: "medium", agent: "bull" }).then((r) => {
      emit(analysisId, "bull", "done", r.data.thesis, r.data);
      return r;
    }),
    structured({ system: BEAR_SYSTEM, user: context, schema: CaseSchema, effort: "medium", agent: "bear" }).then((r) => {
      emit(analysisId, "bear", "done", r.data.thesis, r.data);
      return r;
    }),
  ]);
  add(bull.usage);
  add(bear.usage);

  emit(analysisId, "judge", "start", "Hakem kanıtları tartıyor");
  const judge = await structured({
    agent: "judge",
    system: JUDGE_SYSTEM,
    user: `${context}\n\n<bull>\n${JSON.stringify(bull.data)}\n</bull>\n\n<bear>\n${JSON.stringify(bear.data)}\n</bear>`,
    schema: VerdictSchema,
    effort: "medium",
  });
  add(judge.usage);
  emit(analysisId, "judge", "done", judge.data.reasoning.slice(0, 160), judge.data);

  // 4 — Strategy & Risk with ATK tools in its decision loop (live only)
  const memory = trackRecordMemory(na.data.event_type, tokens);
  const strategyUser = `${context}\n\n<bull>\n${JSON.stringify(bull.data)}\n</bull>\n\n<bear>\n${JSON.stringify(bear.data)}\n</bear>\n\n<hakem>\n${JSON.stringify(judge.data)}\n</hakem>\n\n<gecmis_karne>\n${memory}\n</gecmis_karne>`;
  emit(analysisId, "strategy", "start", mode === "live" ? "ATK ile piyasa kontrol ediliyor" : "Senaryolar ve tahminler hazırlanıyor");
  let strategy: Strategy;
  let toolCalls: ToolCallLog[] = [];
  if (mode === "live") {
    const available = (await atkTools()).filter((t) => AGENT_TOOLS.includes(t.name));
    const tools: ToolSpec[] = available.map((t) => ({ name: t.name, description: t.description ?? t.name, inputSchema: t.inputSchema }));
    const r = await structuredWithTools({
      agent: "strategy",
      system: strategySystem(mode),
      user: strategyUser,
      schema: StrategySchema,
      tools,
      effort: "high",
      runTool: async (name, input) => {
        if (!AGENT_TOOLS.includes(name)) throw new Error(`İzin verilmeyen araç: ${name}`);
        return compactToolResult(await atkCall(name, input));
      },
      onToolCall: (log) => emit(analysisId, "strategy", "tool", `ATK · ${log.name}`, log),
    });
    strategy = r.data;
    toolCalls = r.toolCalls;
    add(r.usage);
  } else {
    const r = await structured({ system: strategySystem(mode), user: strategyUser, schema: StrategySchema, effort: "high", agent: "strategy" });
    strategy = r.data;
    add(r.usage);
  }

  // Validate and persist predictions (prices come from the exchange, never from the model)
  const snapBy = new Map(snaps.map((s) => [s.symbol, s]));
  const insert = db().prepare(
    `INSERT OR IGNORE INTO predictions (analysis_id, news_id, mode, token, inst_id, direction, confidence, horizon_h, event_type, mechanism, rationale, entry_ts, entry_price, momentum_dir, model_direction, model_confidence, base_prob)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const abstain = db().prepare(
    `INSERT OR IGNORE INTO abstentions (analysis_id, news_id, mode, token, horizon_h, reason, reason_code, model_direction, model_confidence, base_prob, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const newInfo = na.data.information_type === "new_information";
  const decided = new Set<string>();
  let saved = 0;
  let abstained = 0;
  const skip = (token: string, horizonH: number, code: AbstainCode, reason: string, dir: string | null, conf: number | null, base: number | null) => {
    abstained += Number(abstain.run(analysisId, news.id, mode, token, horizonH, reason, code, dir, conf, base, Date.now()).changes);
  };

  for (const p of strategy.predictions) {
    const token = p.token.trim().toUpperCase();
    const snap = snapBy.get(token);
    const horizonH = p.horizon === "1h" ? 1 : 24;
    const key = `${token}:${horizonH}`;
    if (!snap || decided.has(key)) continue;
    decided.add(key);
    const conf = clamp01(p.confidence);
    const base = horizonH === 1 ? (snap.base1h ?? null) : (snap.base24h ?? null);
    const baseProb = base ? base[p.direction] : null;

    if (!snap.price) {
      skip(token, horizonH, "no_price", "Haber anına ait borsa fiyatı alınamadı.", p.direction, conf, baseProb);
      continue;
    }
    if (!newInfo) {
      skip(token, horizonH, "not_new_information", "Haber yeni bilgi içermiyor (fiyat özeti / yorum / eğitim); tahminler karneye girmez.", p.direction, conf, baseProb);
      continue;
    }
    const gate = gatePrediction(p.direction, conf, base);
    if (!gate.record) {
      skip(token, horizonH, gate.code, gate.reason, p.direction, conf, baseProb);
      continue;
    }
    const mech = imp.data.impacts.find((i) => i.token === token)?.mechanism ?? p.rationale;
    saved += Number(
      insert.run(analysisId, news.id, mode, token, snap.instId, p.direction, conf, horizonH, na.data.event_type, mech, p.rationale, asOf, snap.price, snap.momentumDir, p.direction, conf, baseProb).changes,
    );
  }
  // Every impacted token × horizon is an opportunity; the ones the model didn't call count as abstentions.
  for (const i of imp.data.impacts) {
    for (const h of [1, 24]) {
      if (decided.has(`${i.token}:${h}`)) continue;
      skip(i.token, h, "not_called", "Strategy ajanı bu token ve ufuk için tahmin vermedi.", null, null, null);
    }
  }
  emit(analysisId, "strategy", "done", `${saved} tahmin karneye kaydedildi · ${abstained} çekimser${newInfo ? "" : " (haber yeni bilgi değil)"}`, strategy);

  const result: AnalysisResult = {
    news: na.data,
    impact: imp.data,
    snapshots: snaps,
    bull: bull.data,
    bear: bear.data,
    verdict: judge.data,
    strategy,
    trackRecord: memory,
    toolCalls,
    usage,
    droppedTokens: dropped,
    model: `${ai.label} · ${usage.models?.length ? usage.models.join(", ") : ai.model}`,
  };
  db().prepare(`UPDATE analyses SET status = 'done', finished_at = ?, result_json = ? WHERE id = ?`).run(Date.now(), JSON.stringify(result), analysisId);

  if (mode === "backtest") {
    const r = await evaluateDue();
    emit(analysisId, "system", "info", `Geriye dönük test puanlandı (${r.evaluated} tahmin)`);
  }
  emit(analysisId, "system", "done", "Analiz tamamlandı");
}

export class StartError extends Error {}

export function startAnalysis(newsId: string, mode: Mode, trigger: "manual" | "auto" | "batch" = "manual"): string {
  if (!aiConfigured()) throw new StartError("Yapay zekâ API anahtarı tanımlı değil (GEMINI_API_KEY veya ANTHROPIC_API_KEY). .env.local dosyasına ekleyip sunucuyu yeniden başlatın.");
  const news = getNews(newsId);
  if (!news) throw new StartError("Haber bulunamadı");
  const already = db().prepare(`SELECT id FROM analyses WHERE news_id = ? AND mode = ? AND status = 'running'`).get(newsId, mode) as { id: string } | undefined;
  if (already) return already.id; // same request again: follow the run in progress
  if (running.size >= MAX_CONCURRENT) throw new StartError(`Aynı anda en fazla ${MAX_CONCURRENT} analiz çalışabilir. Biri bitince tekrar deneyin.`);
  const now = Date.now();
  let asOf = now;
  if (mode === "backtest") {
    if (!news.published_at) throw new StartError("Geriye dönük test için haberin yayın zamanı gerekli");
    if (now - news.published_at < 3_600_000) throw new StartError("Geriye dönük test için haber en az 1 saat önce yayınlanmış olmalı");
    asOf = news.published_at;
  }
  const id = randomUUID();
  db()
    .prepare(`INSERT INTO analyses (id, news_id, mode, status, as_of, created_at, trigger) VALUES (?, ?, ?, 'running', ?, ?, ?)`)
    .run(id, newsId, mode, asOf, now, trigger);
  const done = runAnalysis(id).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    emit(id, "system", "error", msg);
    db().prepare(`UPDATE analyses SET status = 'error', finished_at = ?, error = ? WHERE id = ?`).run(Date.now(), msg, id);
  });
  running.set(id, done.finally(() => running.delete(id)));
  return id;
}

export const MAX_CONCURRENT = 2;
const gRun = globalThis as unknown as { __signalmindRunning?: Map<string, Promise<void>> };
const running: Map<string, Promise<void>> = (gRun.__signalmindRunning ??= new Map());

/** Runs that were 'running' when the server stopped can never finish: close them out. */
export function recoverInterruptedRuns(): number {
  const ids = (db().prepare(`SELECT id FROM analyses WHERE status = 'running'`).all() as { id: string }[]).map((r) => r.id).filter((id) => !running.has(id));
  for (const id of ids) {
    emit(id, "system", "error", "Sunucu yeniden başladığı için analiz yarıda kaldı");
    db().prepare(`UPDATE analyses SET status = 'error', finished_at = ?, error = ? WHERE id = ?`).run(Date.now(), "Sunucu yeniden başladığı için analiz yarıda kaldı. Tekrar deneyin.", id);
  }
  return ids.length;
}

/** Resolves when the analysis finishes (successfully or not). */
export function waitForAnalysis(id: string): Promise<void> {
  return running.get(id) ?? Promise.resolve();
}

export function runningCount(): number {
  return running.size;
}
