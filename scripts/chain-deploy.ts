/**
 * Fuji kurulumu (idempotent):
 *  1. contracts/SignalMindRegistry.sol'ü solc ile derler, gerekirse deploy eder → CHAIN_REGISTRY
 *  2. Guard ajanını resmi ERC-8004 IdentityRegistry'ye agent card ile kaydeder → CHAIN_AGENT_ID
 * Çalıştırma: node --experimental-strip-types scripts/chain-deploy.ts   (kart güncellemek için: node --experimental-strip-types scripts/chain-deploy.ts --update-card)
 */
import fs from "node:fs";
import path from "node:path";
import solc from "solc";
import { createWalletClient, formatEther, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { loadEnv, setEnv } from "./chain-env.ts";
import {
  chainStatus, publicClient, transport, identityRegistryAbi, signalMindRegistryAbi,
  IDENTITY_REGISTRY, EXPLORER_BASE, FAUCET_URL,
} from "../src/lib/chain.ts";

loadEnv();
const st = chainStatus();
if (!st.agentAddress) {
  console.error(`${st.error}\nÖnce: node --experimental-strip-types scripts/chain-setup.ts`);
  process.exit(1);
}
const account = privateKeyToAccount(process.env.CHAIN_PRIVATE_KEY!.trim().replace(/^(?!0x)/, "0x") as Hex);
const pub = publicClient();
const wallet = createWalletClient({ account, chain: avalancheFuji, transport: transport() });
const link = (kind: "address" | "tx", v: string) => `${EXPLORER_BASE}/${kind}/${v}`;

const balance = await pub.getBalance({ address: account.address });
console.log(`Ajan adresi: ${account.address}  bakiye: ${formatEther(balance)} AVAX`);
if (balance === 0n) {
  console.error(`Test AVAX yok. Faucet: ${FAUCET_URL}`);
  process.exit(1);
}

// Sanity: the official ERC-8004 IdentityRegistry must exist on this chain.
const idCode = await pub.getCode({ address: IDENTITY_REGISTRY });
if (!idCode || idCode === "0x") {
  console.error(`ERC-8004 IdentityRegistry ${IDENTITY_REGISTRY} bu ağda bulunamadı.`);
  process.exit(1);
}

// ---------- 1. Compile + deploy SignalMindRegistry ----------
function compile() {
  const file = "SignalMindRegistry.sol";
  const input = {
    language: "Solidity",
    sources: { [file]: { content: fs.readFileSync(path.join("contracts", file), "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  const c = out.contracts[file].SignalMindRegistry;
  const artifact = { contractName: "SignalMindRegistry", compiler: solc.version(), settings: input.settings, abi: c.abi, bytecode: `0x${c.evm.bytecode.object}` };
  fs.mkdirSync(path.join("contracts", "build"), { recursive: true });
  fs.writeFileSync(path.join("contracts", "build", "SignalMindRegistry.json"), JSON.stringify(artifact, null, 2));
  return artifact;
}

async function existingRegistry(): Promise<Hex | undefined> {
  const addr = process.env.CHAIN_REGISTRY?.trim() as Hex | undefined;
  if (!addr) return undefined;
  try {
    const linked = await pub.readContract({ address: addr, abi: signalMindRegistryAbi, functionName: "identityRegistry" });
    return linked.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() ? addr : undefined;
  } catch {
    return undefined;
  }
}

let registry = await existingRegistry();
if (registry) {
  console.log(`SignalMindRegistry zaten kurulu: ${link("address", registry)}`);
} else {
  const art = compile();
  console.log(`Derlendi (solc ${art.compiler}). Deploy ediliyor…`);
  const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode as Hex, args: [IDENTITY_REGISTRY] });
  console.log(`  deploy tx: ${link("tx", hash)}`);
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error("Deploy başarısız.");
  registry = rc.contractAddress;
  setEnv("CHAIN_REGISTRY", registry);
  console.log(`  SignalMindRegistry: ${link("address", registry)}`);
}

// ---------- 2. Register Guard identity on ERC-8004 ----------
function agentCard(agentId?: bigint) {
  const card = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "SignalMind Guard",
    description:
      "AI pre-trade auditor: checks a trading agent's proposed order (news corroboration, market conditions, policy limits) " +
      "and returns approve / reject / escalate with evidence. Every verdict hash is anchored on Avalanche Fuji.",
    active: true,
    x402Support: false,
    services: process.env.GUARD_PUBLIC_URL ? [{ name: "web", endpoint: process.env.GUARD_PUBLIC_URL }] : [],
    registrations: agentId === undefined ? [] : [{ agentId: Number(agentId), agentRegistry: `eip155:${avalancheFuji.id}:${IDENTITY_REGISTRY}` }],
    supportedTrust: ["reputation"],
    capabilities: ["Read-only OKX Agent Trade Kit news audit", "Read-only OKX Agent Trade Kit market audit", "Policy limit checks", "On-chain verdict anchoring"],
    limits: {
      orderPlacement: false,
      fundTransfers: false,
      pricePredictions: false,
      onChainActions: ["SignalMindRegistry.recordVerdict"],
    },
    toolAllowlist: ["market_get_ticker", "market_get_orderbook", "market_get_candles", "news_search", "news_get_by_coin", "news_get_coin_sentiment"],
    verdictRegistry: `eip155:${avalancheFuji.id}:${registry}`,
    decisions: { 0: "approve", 1: "reject", 2: "escalate" },
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;
}

async function ownedAgentId(): Promise<bigint | undefined> {
  const raw = process.env.CHAIN_AGENT_ID?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  try {
    const owner = await pub.readContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "ownerOf", args: [BigInt(raw)] });
    return owner.toLowerCase() === account.address.toLowerCase() ? BigInt(raw) : undefined;
  } catch {
    return undefined;
  }
}

async function setCard(agentId: bigint) {
  const hash = await wallet.writeContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "setAgentURI", args: [agentId, agentCard(agentId)] });
  await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(`  agent card yazıldı: ${link("tx", hash)}`);
}

let agentId = await ownedAgentId();
if (agentId !== undefined) {
  console.log(`Guard ajanı zaten kayıtlı: agentId ${agentId}`);
  if (process.argv.includes("--update-card")) await setCard(agentId);
} else {
  console.log("Guard ajanı ERC-8004 IdentityRegistry'ye kaydediliyor…");
  const hash = await wallet.writeContract({ address: IDENTITY_REGISTRY, abi: identityRegistryAbi, functionName: "register", args: [agentCard()] });
  console.log(`  register tx: ${link("tx", hash)}`);
  const rc = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  const ev = parseEventLogs({ abi: identityRegistryAbi, logs: rc.logs, eventName: "Registered" })
    .find((l) => l.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase());
  if (rc.status !== "success" || !ev) throw new Error("Kayıt başarısız (Registered olayı yok).");
  agentId = ev.args.agentId;
  setEnv("CHAIN_AGENT_ID", agentId.toString());
  // Card now references its own agentId (ERC-8004 "registrations" field).
  await setCard(agentId);
}

console.log(`
Fuji hazır:
  Ajan cüzdanı       ${link("address", account.address)}
  ERC-8004 kimliği   agentId ${agentId}  (IdentityRegistry token #${agentId})
  IdentityRegistry   ${link("address", IDENTITY_REGISTRY)}
  SignalMindRegistry ${link("address", registry)}
.env.local güncellendi (CHAIN_REGISTRY, CHAIN_AGENT_ID). Next sunucusunu yeniden başlatın.`);
