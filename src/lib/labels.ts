export const EVENT_LABEL: Record<string, string> = {
  regulation: "Düzenleme",
  etf_institutional: "ETF / Kurumsal",
  hack_exploit: "Hack / İstismar",
  macro_rates: "Makro / Faiz",
  listing_delisting: "Listeleme",
  partnership_adoption: "Ortaklık / Benimseme",
  tech_upgrade: "Teknik Güncelleme",
  tokenomics_unlock: "Tokenomik / Kilit Açılımı",
  legal_enforcement: "Hukuk / Yaptırım",
  market_flow: "Piyasa Akışı",
  stablecoin: "Stablecoin",
  rumor: "Söylenti",
  other: "Diğer",
};

export const LEVEL_LABEL: Record<string, string> = { low: "Düşük", medium: "Orta", high: "Yüksek" };
export const DIR_LABEL: Record<string, string> = { up: "Yükseliş", down: "Düşüş", flat: "Yatay" };
export const RELATION_LABEL: Record<string, string> = {
  direct: "Doğrudan",
  ecosystem: "Ekosistem",
  sector: "Sektör",
  macro: "Makro",
  correlation: "Korelasyon",
};
export const PRICED_LABEL: Record<string, string> = {
  not_yet: "Henüz fiyatlanmadı",
  partially: "Kısmen fiyatlandı",
  fully: "Tamamen fiyatlandı",
  unknown: "Belirsiz",
};
export const INFO_LABEL: Record<string, string> = {
  new_information: "Yeni bilgi",
  price_recap: "Fiyat özeti",
  opinion_analysis: "Yorum / analiz",
  educational: "Eğitim içeriği",
};
export const NOVELTY_LABEL: Record<string, string> = { new: "Yeni", developing: "Gelişen", old_news: "Eski haber" };
export const STATUS_LABEL: Record<string, string> = { pending: "Bekliyor", correct: "Doğru", wrong: "Yanlış", nodata: "Veri yok" };
export const WINNER_LABEL: Record<string, string> = { bull: "Boğa kazandı", bear: "Ayı kazandı", balanced: "Dengeli" };

export const AGENTS = [
  { id: "news", name: "News Analyst", short: "Haber", color: "var(--color-ink-100)" },
  { id: "impact", name: "Impact Radar", short: "Etki", color: "var(--color-signal)" },
  { id: "bull", name: "Bull", short: "Boğa", color: "var(--color-bull)" },
  { id: "bear", name: "Bear", short: "Ayı", color: "var(--color-bear)" },
  { id: "judge", name: "Hakem", short: "Hakem", color: "var(--color-judge)" },
  { id: "strategy", name: "Strategy & Risk", short: "Strateji", color: "var(--color-atk)" },
] as const;
