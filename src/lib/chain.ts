/**
 * Avalanche Fuji katmanı: Guard ajanının ERC-8004 kimliği ve karar (verdict) kayıtları.
 * Kimlik: resmi ERC-8004 IdentityRegistry (Fuji). Kararlar: contracts/SignalMindRegistry.sol.
 */
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";

export type ChainStatus = {
  configured: boolean;
  network: "fuji";
  agentAddress?: string;
  agentId?: string;
  registry?: string;
  explorerBase: string;
  error?: string;
};

export const EXPLORER_BASE = "https://testnet.snowtrace.io";
export const FAUCET_URL = "https://core.app/tools/testnet-faucet/?subnet=c&token=c";
/** Official ERC-8004 IdentityRegistry, same vanity address on every testnet (incl. Fuji). */
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const TIMEOUT_MS = 30_000;
const DECISIONS = { approve: 0, reject: 1, escalate: 2 } as const;

export const identityRegistryAbi = [
  {
    type: "function", name: "register", stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function", name: "setAgentURI", stateMutability: "nonpayable",
    inputs: [{ name: "agentId", type: "uint256" }, { name: "newURI", type: "string" }], outputs: [],
  },
  {
    type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event", name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string", indexed: false },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

export const signalMindRegistryAbi = [
  {
    type: "function", name: "recordVerdict", stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" }, { name: "verdictHash", type: "bytes32" },
      { name: "decision", type: "uint8" }, { name: "subject", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "recordedAt", stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "identityRegistry", stateMutability: "view",
    inputs: [], outputs: [{ name: "", type: "address" }],
  },
  { type: "error", name: "NotAgentOwner", inputs: [] },
  { type: "error", name: "BadDecision", inputs: [] },
  { type: "error", name: "AlreadyRecorded", inputs: [] },
] as const;

export const rpcUrl = () => process.env.CHAIN_RPC_URL || avalancheFuji.rpcUrls.default.http[0];

export function publicClient() {
  return createPublicClient({ chain: avalancheFuji, transport: http(rpcUrl(), { timeout: 15_000 }) });
}

function normalizeKey(raw: string | undefined): Hex | undefined {
  const k = raw?.trim();
  if (!k) return undefined;
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  return /^0x[0-9a-fA-F]{64}$/.test(hex) ? hex : undefined;
}

export function chainStatus(): ChainStatus {
  const base: ChainStatus = { configured: false, network: "fuji", explorerBase: EXPLORER_BASE };
  const rawKey = process.env.CHAIN_PRIVATE_KEY;
  if (!rawKey?.trim()) return { ...base, error: "CHAIN_PRIVATE_KEY tanımlı değil (node --experimental-strip-types scripts/chain-setup.ts)." };
  const key = normalizeKey(rawKey);
  if (!key) return { ...base, error: "CHAIN_PRIVATE_KEY geçersiz (64 haneli hex olmalı)." };
  const agentAddress = privateKeyToAccount(key).address;
  const registry = process.env.CHAIN_REGISTRY?.trim() || undefined;
  const agentId = process.env.CHAIN_AGENT_ID?.trim() || undefined;
  const st: ChainStatus = { ...base, agentAddress, registry, agentId };
  if (!registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) return { ...st, error: "CHAIN_REGISTRY tanımlı değil (node --experimental-strip-types scripts/chain-deploy.ts)." };
  if (!agentId || !/^\d+$/.test(agentId)) return { ...st, error: "CHAIN_AGENT_ID tanımlı değil (node --experimental-strip-types scripts/chain-deploy.ts)." };
  return { ...st, configured: true };
}

function canonicalize(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v === null || typeof v !== "object") return v;
  if (typeof (v as { toJSON?: unknown }).toJSON === "function") return canonicalize((v as { toJSON: () => unknown }).toJSON());
  if (Array.isArray(v)) return v.map((x) => (x === undefined || typeof x === "function" ? null : canonicalize(x)));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x === undefined || typeof x === "function" || typeof x === "symbol") continue;
    out[k] = canonicalize(x);
  }
  return out;
}

/** Canonical JSON: object keys sorted recursively, undefined dropped, bigint → string. */
export function canonicalJson(payload: unknown): string {
  return JSON.stringify(canonicalize(payload)) ?? "null";
}

/** keccak256 of the canonical (sorted-key) JSON encoding of `payload`. */
export function verdictHash(payload: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson(payload)));
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); })])
    .finally(() => clearTimeout(t));
}

export async function anchorVerdict(v: {
  verdictId: string;
  hash: `0x${string}`;
  decision: "approve" | "reject" | "escalate";
  subject: string;
}): Promise<{ txHash: string; explorerUrl: string }> {
  const st = chainStatus();
  if (!st.configured) throw new Error(`Fuji zinciri yapılandırılmamış: ${st.error}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(v.hash)) throw new Error("Karar özeti (hash) 32 baytlık hex olmalı.");
  const decision = DECISIONS[v.decision];
  if (decision === undefined) throw new Error(`Bilinmeyen karar: ${String(v.decision)}`);

  const account = privateKeyToAccount(normalizeKey(process.env.CHAIN_PRIVATE_KEY)!);
  const pub = publicClient();
  const wallet = createWalletClient({ account, chain: avalancheFuji, transport: http(rpcUrl(), { timeout: 15_000 }) });
  const deadline = Date.now() + TIMEOUT_MS;
  const left = () => Math.max(1_000, deadline - Date.now());
  // Subject is public on-chain; keep it short and tie it to the off-chain verdict id.
  const subject = `${v.verdictId}|${v.subject}`.slice(0, 160);

  const balance = await withTimeout(pub.getBalance({ address: account.address }), left(), "Fuji RPC yanıt vermedi (bakiye sorgusu zaman aşımı).");
  if (balance === 0n) throw new Error(`Ajan cüzdanında test AVAX yok (${account.address}). Faucet: ${FAUCET_URL}`);

  let txHash: Hex;
  try {
    txHash = await withTimeout(
      wallet.writeContract({
        address: st.registry as Hex,
        abi: signalMindRegistryAbi,
        functionName: "recordVerdict",
        args: [BigInt(st.agentId!), v.hash, decision, subject],
      }),
      left(),
      "Fuji işlemi gönderilemedi (zaman aşımı).",
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/insufficient funds/i.test(m)) throw new Error(`Ajan cüzdanında gas için yeterli test AVAX yok (${account.address}). Faucet: ${FAUCET_URL}`);
    if (/AlreadyRecorded/.test(m)) throw new Error("Bu karar özeti zincirde zaten kayıtlı.");
    if (/NotAgentOwner/.test(m)) throw new Error("Bu cüzdan CHAIN_AGENT_ID kimliğinin sahibi değil.");
    throw new Error(`Fuji kaydı başarısız: ${m.split("\n")[0]}`);
  }

  const explorerUrl = `${EXPLORER_BASE}/tx/${txHash}`;
  const receipt = await pub
    .waitForTransactionReceipt({ hash: txHash, timeout: left(), pollingInterval: 1_000 })
    .catch(() => {
      throw new Error(`İşlem gönderildi ama 30 sn içinde onaylanmadı: ${explorerUrl}`);
    });
  if (receipt.status !== "success") throw new Error(`Fuji işlemi geri alındı (revert): ${explorerUrl}`);
  return { txHash, explorerUrl };
}
