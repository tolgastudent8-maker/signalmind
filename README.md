# SignalMind AI

**Kripto haberlerinin OKX TR tokenlarına etkisini çok ajanlı yapay zekâyla analiz eden ve kendi isabetini ölçen platform.**

Yapay zekânın ne söylediğinden çok, *neden* söylediğini ve geçmişte söylediklerinin *ne kadar doğru çıktığını* gösterir.

> Karar destek aracıdır, yatırım tavsiyesi değildir. Emir göndermez. ATK yalnızca salt okunur piyasa modülüyle çalışır.

## Ne yapar?

```
Haber (RSS / elle)
  │
  ├─ 01 News Analyst ─────── sınıflandırır, güvenilirliği puanlar, olguyu söylentiden ayırır
  ├─ 02 Impact Radar ─────── OKX TR'de işlem gören 130+ token içinden etkilenenleri + neden-sonuç zincirini çıkarır
  │        └─ kod: evren dışı sembolleri atar, haber anına göre piyasa anlık görüntüsü alır
  ├─ 03 Bull ∥ Bear ──────── karşıt tezleri kanıtla savunur (paralel)
  ├─ 04 Hakem ────────────── retoriğe değil kanıt kalitesine göre puanlar
  └─ 05 Strategy & Risk ──── ATK MCP araçlarını KENDİSİ çağırır (mum, RSI/MACD, emir defteri),
           │                  geçmiş karneye göre güvenini kalibre eder, ölçülebilir tahmin üretir
           ▼
     Tahmin Karnesi ─ giriş fiyatı borsadan (LLM'den değil) · 1 saat / 24 saat sonra otomatik puanlama
           │          · kalibrasyon · basit kurallarla kıyas · doğru VE yanlışlar
           └──────────► bir sonraki analizde Strategy ajanına "karne hafızası" olarak geri beslenir
```

### Farkı yaratan noktalar

| | |
|---|---|
| **ATK MCP karar döngüsünde** | Strategy ajanı, resmi `okx-trade-mcp` sunucusunun (`--site tr --modules market --read-only`) araçlarını tek seferlik değil, karar verirken kendi seçerek çağırır. Her çağrı "Ajan izi" panelinde görünür. |
| **Bull vs Bear + Hakem** | Tek bir modelin görüşü yerine yapılandırılmış tartışma; hakem kararı belirleyen ve zayıf argümanları listeler. |
| **Hesap verebilir tahminler** | Her tahmin sonuç belli olmadan kaydedilir. Fiyatlar borsadan alınır, model fiyat uyduramaz. |
| **Kalibrasyon** | “%80 eminim” dediğinde gerçekte ne kadar tuttuğu grafikle gösterilir ve ajana geri verilir. |
| **Basit kurallarla dürüst kıyas** | Aynı tahmin anlarında momentum, hep-yükseliş ve hep-yatay kurallarının isabeti yan yana. |
| **Taban oran ile kalibrasyon** | Kod, her token ve ufuk için "haber hiç yokmuş gibi" sonuç olasılıklarını oynaklıktan hesaplar. Ajan güvenini bu taban orandan başlatır ve tabloda "şansın kaç puan üstünde" iddia ettiği görünür. |
| **Kod LLM'i denetler** | Model, bir yönü taban oranın altında bir güvenle seçerse (kendi kendisiyle çelişirse) kod en olası sonucu kaydeder; modelin asıl tahmini üstü çizili, kural gerekçesiyle birlikte gösterilir. |
| **Haber türü** | News Analyst haberi yeni bilgi / fiyat özeti / yorum / eğitim içeriği olarak ayırır. "X %16 yükseldi" gibi fiyat özetleri katalizör sayılmaz. |
| **Hikâye gruplama** | Aynı olayı aktaran farklı kaynaklar tek hikâyede toplanır ("3 kaynak"). Bu doğrulama, güvenilirlik puanına girer. |
| **Toplu geriye dönük test** | Karne sayfasından tek tıkla son haberler sırayla test edilir; kota dolunca kendiliğinden durur. |
| **Türkiye primi** | OKX TR'ye özel bir sinyal. Her tokenin TRY paritesi, küresel USDT fiyatıyla karşılaştırılır: `TRY ortası ÷ (USDT ortası × USDT/TRY) − 1`. Ayrıca USDT/TRY'nin TCMB kuruna göre primi (kripto dolar talebi) ve likit paritelerin hacimle ağırlıklı sepet primi hesaplanır. Değerler 5 dakikada bir kaydedilir ve canlı analizlerde ajanlara verilir. Geriye dönük testte, gelecek bilgisi sızmasın diye verilmez. |
| **Olay çalışması** | Her analizde, etkilenen tokenlerin haberden 2 saat öncesinden 24 saat sonrasına kadarki fiyat yolu çizilir. Ham ve BTC'den arındırılmış görünüm vardır; +15 dk, +1 s, +4 s ve +24 s hareketleri ile en büyük sapma gösterilir. Karnede haber türüne göre ortalama tepki yer alır. |
| **Ajan sicili** | Her ajanın kendi iddiası gerçek fiyatla ölçülür: Impact Radar'ın yönleri, Hakem'in seçtiği taraf ve fiyatın hangi tezi doğruladığı. Çok ajanlı yapının her parçasının ayrı karnesi vardır. |
| **18 haber kaynağı** | 13 İngilizce ve 5 Türkçe kaynak. Dil, kaynak ve zaman süzgeçleri, "yalnız çok kaynaklı" seçeneği ve başlıktan otomatik token etiketleme bulunur. |
| **Otonom mod** | Açılınca ajan, son 90 dakikada en az 2 kaynağın doğruladığı yeni hikâyeleri kendisi analiz eder. Varsayılanı kapalıdır; günlük sınır ve aynı anda tek analiz kuralıyla harcama sınırlıdır. |
| **Gelecek bilgisi sızmayan geriye dönük test** | Haber 10:20'de yayınlandıysa yalnız 10:00'da kapanmış mumlar kullanılır; giriş fiyatı haber anından sonraki ilk 1 dakikalık mumun açılışıdır. Testle doğrulanır. |

## Kurulum

Gereksinim: Node.js 22.5+ (Node 24 önerilir).

```bash
cd signalmind
npm install
```

`.env.example` dosyasını `.env.local` olarak kopyalayın ve bir yapay zekâ anahtarı yazın:

- **`ANTHROPIC_API_KEY`** (önerilen):
  - Varsayılan model tüm ajanlar için `claude-opus-5-5`.
  - `CLAUDE_MODEL_<AJAN>` satırlarıyla ajan bazında model seçilebilir (örnek karma `.env.example` içinde). Bu, krediyi kabaca yarıya indirir.
  - Model bir isteği güvenlik nedeniyle reddederse istek, sunucu tarafında Anthropic'in önerdiği yedek modelle yeniden çalıştırılır (`fallbacks: "default"`).
- **`GEMINI_API_KEY`:** Ücretsizdir, kart gerekmez. https://aistudio.google.com/apikey adresinden alınır.
  - **Kota:** Ücretsiz katmanda her modelin günlük istek kotası küçüktür (yazıldığı tarihte 20/gün). Bir analiz yaklaşık 8–10 istek kullanır.
  - **Model zinciri:** Uygulama bir Flash modelleri zinciri üzerinde çalışır. Kotası dolan modeli atlar, aşırı yoğun (503) modelde kısa bekleyip sıradakine geçer. Zincir `GEMINI_MODELS` ile değiştirilebilir.
  - **Kota göstergesi:** Üst bardaki "Kota" göstergesi kaç modelin hazır olduğunu ve kotanın ne zaman açılacağını gösterir.
- İkisi birden tanımlıysa Claude kullanılır. `AI_PROVIDER=gemini` satırıyla Gemini seçilebilir.

Ajanlar, istemler, ATK araç döngüsü ve karne iki sağlayıcıda da aynı çalışır. Hangi modelin kullanıldığı her analizin başlığında görünür.

```bash
copy .env.example .env.local
```

Bağlantı testi (ATK, RSS, Claude):

```bash
npm run check
```

Uygulama (geliştirme modu):

```bash
npm run dev
```

**Demo için:** `baslat.cmd` dosyasına çift tıklayın. Betik production modunda derler, başlatır ve tarayıcıyı açar; geliştirme modundan daha hızlı ve kararlıdır.

→ http://localhost:3000. Sunucu açıkken arka plan döngüsü:
- Her dakika ufku dolan tahminleri puanlar.
- 5 dakikada bir RSS çeker.
- Otonom mod açıksa uygun hikâyeleri analiz eder.

Ayrı süreç gerekmez. Sunucu bir analizin ortasında kapanırsa, analiz yeniden başlatmada "yarıda kaldı" olarak kapatılır ve "Tekrar dene" ile yeniden çalıştırılabilir.

Testler:

```bash
npm test
```

```bash
npm run test:e2e
```

`test:e2e`, API anahtarı olmadan tüm ajan akışını sınar: Messages API'nin yerine sahte yanıt veren yerel bir sunucu kullanılır. Gerçek Anthropic SDK, gerçek ATK MCP sunucusu ve gerçek OKX TR verisi çalışır. Ağ bağlantısı gerekir.

## Puanlama kuralı

- Değişim = ufuk sonundaki fiyat / tahmin anındaki fiyat − 1. Fiyatlar 1 dakikalık mumun açılışından alınır.
- |değişim| < bant ise gerçekleşen yön **yatay** sayılır. Bant 1 saat için %0,4, 24 saat için %1,5'tir. Bandın dışındaysa yön yükseliş ya da düşüştür.
- Tahmin, yönü gerçekleşen yönle aynıysa **doğru** sayılır. Güven, doğru çıkma olasılığıdır. Brier skoru = ortalama (güven − isabet)².
- Bu kural ajana da söylenir; ajan tam olarak neyle ölçüleceğini bilir.

### Kayıt kuralı: çekimser kalma

Bir tahminin karneye girmesi için kod iki koşul arar:
- **Haber türü:** Haber yeni bilgi içermeli. Fiyat özeti, yorum ve eğitim içeriği olan haberlerde analiz yapılır ama tahmin kaydedilmez.
- **Avantaj:** Güven, o sonucun haber yokken beklenen olasılığının (taban oran) en az **5 puan** üstünde olmalı ve başka bir sonucun taban oranından düşük olmamalı.

Bu koşulları karşılamayan her token × ufuk fırsatı, gerekçesiyle **çekimser** olarak saklanır. Karne şunları ayrı ayrı gösterir:
- **İsabet:** Kayda geçen tahminlerin ne kadarının tuttuğu.
- **Kapsama:** Fırsatların yüzde kaçında tahmin verildiği.
- **Beceri:** İsabetin, aynı tahminlerdeki en iyi basit kuraldan kaç puan farklı olduğu.
- **Brier beceri skoru:** 1 − Brier(model) / Brier(taban oran). Sıfırdan büyükse model, haber yokmuş gibi yapılan tahminden daha bilgilidir.

Bu kural yalnızca devreye girdiği andan sonraki tahminlere uygulanır; eski tahminler ve puanlama bandı değiştirilmez.
- 20'den az puanlanmış tahmin varsa ekranda "örneklem küçük" uyarısı çıkar.

## Dosyalar

| Dosya | Görev |
|---|---|
| `src/lib/atk.ts` | ATK MCP istemcisi. `okx-trade-mcp`'yi stdio üzerinden başlatır (OKX TR, salt okunur). |
| `src/lib/market.ts` | Piyasa verisi: önce ATK, olmazsa OKX TR REST. Token evreni, mumlar, `priceAt`, sızıntısız `snapshot`. |
| `src/lib/news.ts` | 18 RSS kaynağı (EN + TR) ve elle haber. İçerik hash'i ve URL ile tekilleştirme, HTML karakter kodu çözümü, hikâye gruplama. |
| `src/lib/turkey.ts` | Türkiye primi: token primi, USDT/TRY'nin TCMB'ye göre primi, sepet primi ve 5 dakikalık geçmiş. |
| `src/lib/eventstudy.ts` | Olay çalışması: haber anına göre normalize fiyat yolu, BTC'den arındırma, haber türüne göre tepki. |
| `src/lib/agent-record.ts` | Ajan sicili: Impact Radar ve Hakem iddialarının gerçek fiyatla puanlanması. |
| `src/lib/tagging.ts` | Başlıktan OKX TR token etiketleme (yapay zekâ kullanmaz). |
| `src/lib/agents/schemas.ts` | Her ajanın çıktı sözleşmesi (Zod → structured outputs). |
| `src/lib/agents/llm.ts` | Sağlayıcı seçimi (Claude / Gemini). |
| `src/lib/agents/providers/*` | Her sağlayıcı için yapılandırılmış çıktı ve ATK araç döngüsü. Gemini'de kota hatasında bekleyip yeniden dener. |
| `src/lib/agents/pipeline.ts` | Uçtan uca akış, istemler, doğrulama, tahmin kaydı. |
| `src/lib/scorecard.ts` | Puanlama, istatistik, kalibrasyon, basit kurallarla kıyas, karne hafızası. |
| `src/lib/scheduler.ts` | Arka plan döngüsü (puanlama + RSS + otonom mod). |
| `src/lib/autopilot.ts` | Otonom mod: aday seçimi, günlük sınır. |
| `src/lib/batch.ts` | Toplu geriye dönük test kuyruğu. |
| `src/lib/indicators.ts` | EMA, RSI (Wilder), MACD, Bollinger, ATR ve emir defteri istatistikleri (spread, ±%1/±%2 derinlik, dengesizlik). Kodla hesaplanır, testlidir. |
| `src/lib/telemetry.ts` | Olay kaydından ajan gecikmesi (ort./p95), ATK çağrı istatistikleri, token kullanımı. |
| `src/components/tech-chart.tsx` | Token sayfasının SVG teknik grafiği (mum + Bollinger + EMA, hacim, RSI, MACD, ortak imleç), derinlik grafiği ve emir defteri merdiveni. |
| `src/components/impact-matrix.tsx` | Ana sayfadaki token × analiz etki matrisi. |
| `src/components/command-palette.tsx` | Ctrl+K komut paleti: sayfa, token, analiz ve haber araması. |
| `src/app/*` | Arayüz: Komuta Merkezi, Analiz, Tahmin Karnesi, Tokenlar, Token detayı, Sistem. |

## Durum

| Özellik | Durum |
|---|---|
| ATK MCP (OKX TR, salt okunur): 21 araç | ✅ Canlı test edildi |
| Token evreni (TRY paritesi olan 130+ token) | ✅ Canlı |
| RSS (4 kaynak) | ✅ Canlı |
| Ajan akışı + ATK araç döngüsü + tahmin kaydı | ✅ Uçtan uca test edildi (sahte Messages API, gerçek SDK/ATK/OKX ile) |
| Geriye dönük test + anında puanlama | ✅ Uçtan uca test edildi (gerçek geçmiş OKX mumlarıyla) |
| Gemini sağlayıcısı (aynı akış + ATK döngüsü) | ✅ Uçtan uca test edildi (sahte generateContent, gerçek Google SDK/ATK/OKX ile) |
| Gerçek Gemini çağrısıyla analiz | ✅ 1 canlı analiz + 2 geriye dönük test (2026-10-16) |
| Gerçek Claude çağrısıyla analiz | ⚠️ Anahtar eklenince `npm run check` ve bir analizle doğrulanmalı |
| Otonom mod, toplu test, kural düzeltmesi, hikâye gruplama | ✅ Birim ve uçtan uca testlerle doğrulandı |
| Emir gönderme | ❌ Bilinçli olarak yok |

## 3 dakikalık demo akışı

Hazırlık: Demodan önceki gün Karne sayfasından toplu geriye dönük test çalıştırın; karnede 20'den fazla puanlanmış tahmin olsun. Bir analiz birkaç dakika sürdüğü için canlı analizi demodan hemen önce başlatıp sayfayı açık tutun.

1. **Problem (20 sn):** "Haber geliyor; hangi token, hangi yönde, neden? Ve yapay zekâya neden güvenelim?"
2. **Haber akışı (20 sn):** "3 kaynak" rozetli bir hikâye gösterin. Aynı olay gruplanıyor ve doğrulama güvenilirliğe giriyor.
3. **Canlı analiz (50 sn):** Altı ajanlık akışı ve sağdaki Ajan izi panelini gösterin; ATK çağrıları mavi görünür. Haber türü rozetini (yeni bilgi / fiyat özeti) gösterin.
4. **Tartışma (30 sn):** Boğa ve ayı tezlerini, hakem puanını, belirleyici ve zayıf argümanları gösterin.
5. **Tahminler (30 sn):** Yön, güven ve "taban oran" sütununu ("şansın kaç puan üstünde") gösterin. Varsa kural düzeltmesini gösterin: kod LLM'i denetliyor. Giriş fiyatının borsadan geldiğini vurgulayın.
6. **Karne (30 sn):** Kalibrasyonu, basit kurallarla kıyası ve yanlış tahminleri gösterin.
7. **Kapanış (20 sn):** Otonom mod anahtarını açın. Cümle: "Ajan kendi çalışıyor, her tahmini kayıt altında ve karnesi bir sonraki analize geri veriliyor."
