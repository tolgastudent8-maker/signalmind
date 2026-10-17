/**
 * Bağlantı testi: ATK MCP (OKX TR), RSS kaynakları ve Claude API.
 * Çalıştırma: npm run check
 */
import fs from "node:fs";
import { atkTools, atkCall } from "../src/lib/atk.ts";
import { FEEDS, parseFeed } from "../src/lib/news.ts";

// Next.js reads .env.local itself; this script loads it for parity.
for (const f of [".env.local", ".env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]] && m[2]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const ok = (s: string) => console.log(`  \u001b[32m✓\u001b[0m ${s}`);
const bad = (s: string) => console.log(`  \u001b[31m✗\u001b[0m ${s}`);

console.log("\nATK MCP · OKX TR");
try {
  const tools = await atkTools();
  ok(`${tools.length} araç (salt okunur, market modülü)`);
  const t = await atkCall<{ data: { data: { last: string }[] } }>("market_get_ticker", { instId: "BTC-USDT" });
  ok(`BTC-USDT son fiyat: ${t.data.data[0].last}`);
} catch (e) {
  bad(`ATK bağlanamadı: ${e instanceof Error ? e.message : e}`);
}

console.log("\nRSS");
for (const f of FEEDS) {
  try {
    const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 SignalMind/0.1" }, signal: AbortSignal.timeout(12000) });
    const items = parseFeed(await res.text(), f.source);
    items.length ? ok(`${f.source}: ${items.length} haber`) : bad(`${f.source}: haber yok (HTTP ${res.status})`);
  } catch (e) {
    bad(`${f.source}: ${e instanceof Error ? e.message : e}`);
  }
}

console.log("\nYapay zekâ");
const { aiInfo, structured } = await import("../src/lib/agents/llm.ts");
const ai = aiInfo();
if (!ai.configured) {
  bad("API anahtarı yok — .env.local dosyasına GEMINI_API_KEY (ücretsiz) veya ANTHROPIC_API_KEY ekleyin");
} else {
  try {
    const { z } = await import("zod");
    const r = await structured({
      system: "Kısa ve net yanıt ver.",
      user: "Bağlantı testi: status alanına 'tamam' yaz.",
      schema: z.object({ status: z.string() }),
      effort: "low",
    });
    ok(`${ai.label} ${ai.model} yanıt verdi: ${r.data.status} (${r.usage.input + r.usage.output} token)`);
  } catch (e) {
    bad(`${ai.label} çağrısı başarısız: ${e instanceof Error ? e.message : e}`);
  }
}
console.log("");
process.exit(0);
