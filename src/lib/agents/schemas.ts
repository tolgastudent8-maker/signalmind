import { z } from "zod";

/*
 * Output contracts for every agent. Claude fills these via structured outputs;
 * numeric ranges are enforced in code afterwards (see clamp helpers in pipeline).
 */

export const EVENT_TYPES = [
  "regulation",
  "etf_institutional",
  "hack_exploit",
  "macro_rates",
  "listing_delisting",
  "partnership_adoption",
  "tech_upgrade",
  "tokenomics_unlock",
  "legal_enforcement",
  "market_flow",
  "stablecoin",
  "rumor",
  "other",
] as const;

export const Level = z.enum(["low", "medium", "high"]);
export const Direction = z.enum(["up", "down", "flat"]);
export const Horizon = z.enum(["1h", "24h"]);

export const NewsAnalysisSchema = z.object({
  headline: z.string().describe("Haberin tek cümlelik Türkçe özeti"),
  summary: z.string().describe("2-4 cümlelik Türkçe özet: ne oldu, kim, ne zaman"),
  event_type: z.enum(EVENT_TYPES),
  information_type: z
    .enum(["new_information", "price_recap", "opinion_analysis", "educational"])
    .describe(
      "new_information: piyasanın henüz bilmediği yeni bir gelişme (onay, hack, listeleme, açıklama). price_recap: zaten olmuş fiyat hareketinin özeti. opinion_analysis: yorum, tahmin, analist görüşü. educational: rehber/açıklayıcı içerik.",
    ),
  materiality: Level.describe("Piyasa için önem derecesi"),
  credibility_score: z.number().describe("0-100 arası kaynak/iddia güvenilirliği"),
  credibility_reasons: z.array(z.string()).describe("Güvenilirlik puanının gerekçeleri"),
  novelty: z.enum(["new", "developing", "old_news"]),
  entities: z.array(z.string()).describe("Geçen projeler, kurumlar, kişiler"),
  key_facts: z.array(z.string()).describe("Doğrulanabilir somut olgular"),
  open_questions: z.array(z.string()).describe("Belirsiz kalan noktalar"),
});
export type NewsAnalysis = z.infer<typeof NewsAnalysisSchema>;

export const ImpactSchema = z.object({
  impacts: z.array(
    z.object({
      token: z.string().describe("Evren listesindeki sembol, örn. BTC"),
      relation: z.enum(["direct", "ecosystem", "sector", "macro", "correlation"]),
      direction: Direction,
      strength: Level,
      confidence: z.number().describe("0-100"),
      mechanism: z.string().describe("Neden-sonuç zinciri: haber → mekanizma → fiyat etkisi (Türkçe)"),
      evidence: z.array(z.string()).describe("Bu etkiyi destekleyen haberdeki/bilinen olgular"),
    }),
  ),
  market_wide_note: z.string().describe("Genel piyasaya etkisi hakkında kısa not (Türkçe)"),
});
export type Impact = z.infer<typeof ImpactSchema>;

export const CaseSchema = z.object({
  thesis: z.string().describe("Tek cümlelik tez (Türkçe)"),
  arguments: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string().describe("Habere veya verilen piyasa verisine dayanan kanıt"),
      strength: Level,
    }),
  ),
  most_affected: z.array(z.string()).describe("Bu senaryoda en çok etkilenecek semboller"),
  invalidation: z.string().describe("Bu tezi çürütecek gelişme"),
});
export type Case = z.infer<typeof CaseSchema>;

export const VerdictSchema = z.object({
  winner: z.enum(["bull", "bear", "balanced"]),
  bull_score: z.number().describe("0-100 kanıt gücü"),
  bear_score: z.number().describe("0-100 kanıt gücü"),
  decisive_points: z.array(z.string()).describe("Kararı belirleyen noktalar"),
  weak_points: z.array(z.string()).describe("İki taraftaki zayıf/spekülatif argümanlar"),
  reasoning: z.string().describe("Hakem gerekçesi (Türkçe)"),
});
export type Verdict = z.infer<typeof VerdictSchema>;

export const StrategySchema = z.object({
  predictions: z.array(
    z.object({
      token: z.string(),
      direction: Direction,
      horizon: Horizon,
      confidence: z.number().describe("Bu yön tahmininin doğru çıkma olasılığı, 0-100 (kalibre)"),
      priced_in: z.enum(["not_yet", "partially", "fully", "unknown"]),
      rationale: z.string().describe("Kısa gerekçe (Türkçe)"),
      invalidation: z.string().describe("Tahmini geçersiz kılacak koşul (Türkçe)"),
    }),
  ),
  scenarios: z.array(
    z.object({
      name: z.string().describe("Örn. Temel senaryo / Olumlu / Olumsuz"),
      probability: z.number().describe("0-100; senaryoların toplamı 100"),
      description: z.string(),
      signposts: z.array(z.string()).describe("Bu senaryonun gerçekleştiğini gösterecek işaretler"),
    }),
  ),
  market_context: z.string().describe("ATK ile bakılan piyasa verisinden çıkan durum özeti (Türkçe)"),
  risks: z.array(z.string()),
  uncertainty: z.string().describe("En büyük belirsizlik ve neden"),
  track_record_note: z.string().describe("Geçmiş karnenin bu analize nasıl yansıtıldığı (Türkçe)"),
  stance: z.string().describe("Kullanıcı için özet duruş; yatırım tavsiyesi değildir (Türkçe)"),
});
export type Strategy = z.infer<typeof StrategySchema>;
