/**
 * Fuji test cüzdanı: CHAIN_PRIVATE_KEY yoksa yeni bir cüzdan üretip .env.local'a yazar.
 * Yalnızca adresi ve faucet bağlantısını yazdırır; özel anahtar asla ekrana basılmaz.
 * Çalıştırma: node --experimental-strip-types scripts/chain-setup.ts
 */
import { formatEther } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { loadEnv, setEnv, ENV_FILE } from "./chain-env.ts";
import { chainStatus, publicClient, EXPLORER_BASE, FAUCET_URL } from "../src/lib/chain.ts";

loadEnv();

if (!process.env.CHAIN_PRIVATE_KEY?.trim()) {
  setEnv("CHAIN_PRIVATE_KEY", generatePrivateKey());
  console.log(`Yeni Fuji test cüzdanı oluşturuldu ve ${ENV_FILE} dosyasına yazıldı (yalnızca testnet için kullanın).`);
}

const st = chainStatus();
if (!st.agentAddress) {
  console.error(st.error);
  process.exit(1);
}
const address = st.agentAddress;
console.log(`Ajan adresi : ${address}`);
console.log(`Explorer    : ${EXPLORER_BASE}/address/${address}`);
try {
  const bal = await publicClient().getBalance({ address: address as `0x${string}` });
  console.log(`Bakiye      : ${formatEther(bal)} AVAX (Fuji)`);
  if (bal === 0n) console.log(`\nFaucet ile test AVAX alın: ${FAUCET_URL}\n(alternatif: https://build.avax.network/console/primary-network/faucet)\nSonra: node --experimental-strip-types scripts/chain-deploy.ts`);
  else console.log("\nHazır. Sıradaki adım: node --experimental-strip-types scripts/chain-deploy.ts");
} catch (e) {
  console.log(`Bakiye okunamadı (${(e as Error).message.split("\n")[0]}). Faucet: ${FAUCET_URL}`);
}
