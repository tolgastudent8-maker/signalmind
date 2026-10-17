/**
 * Avalanche Fuji katmanı: Guard ajanının ERC-8004 kimliği ve karar (verdict) kayıtları.
 * Kimlik: resmi ERC-8004 IdentityRegistry (Fuji). Kararlar: contracts/SignalMindRegistry.sol.
 */
import { createPublicClient, createWalletClient, fallback, http, keccak256, parseEventLogs, toBytes, type Hex } from "viem";
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

/** Avascan (Fuji): `${EXPLORER_BASE}/tx/<hash>`, `/address/<addr>`. Snowtrace sits behind a Cloudflare challenge. */
export const EXPLORER_BASE = "https://testnet.avascan.info/blockchain/c";
export const FAUCET_URL = "https://core.app/tools/testnet-faucet/?subnet=c&token=c";
/** Official ERC-8004 IdentityRegistry, same vanity address on every testnet (incl. Fuji). */
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const TIMEOUT_MS = 30_000;
/** recordVerdict uses ~60–90k gas (160-char subject); generous fixed cap instead of RPC estimation. */
const RECORD_GAS = 250_000n;
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
  {
    type: "event", name: "VerdictRecorded",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true }, { name: "verdictHash", type: "bytes32", indexed: true },
      { name: "decision", type: "uint8", indexed: false }, { name: "subject", type: "string", indexed: false },
      { name: "recorder", type: "address", indexed: true },
    ],
  },
  { type: "error", name: "NotAgentOwner", inputs: [] },
  { type: "error", name: "BadDecision", inputs: [] },
  { type: "error", name: "AlreadyRecorded", inputs: [] },
] as const;

export const rpcUrl = () => process.env.CHAIN_RPC_URL || avalancheFuji.rpcUrls.default.http[0];

/** Public Fuji endpoints tried in order; the official one rate-limits bursts (HTTP 429 / Cloudflare 1015). */
const FALLBACK_RPCS = ["https://avalanche-fuji-c-chain-rpc.publicnode.com", "https://avalanche-fuji.drpc.org"];

export function transport() {
  const urls = [rpcUrl(), ...FALLBACK_RPCS.filter((u) => u !== rpcUrl())];
  return fallback(urls.map((u) => http(u, { timeout: 10_000, retryCount: 0 })));
}

export function publicClient() {
  return createPublicClient({ chain: avalancheFuji, transport: transport() });
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

export type OnChainVerdict = {
  recorded: boolean;
  recordedAt: number | null; // unix ms, from the contract
  txHash: string | null;
  block: number | null;
  agentId: string | null;
  decision: "approve" | "reject" | "escalate" | null;
  subject: string | null;
  recorder: string | null;
};

const DECISION_NAMES = ["approve", "reject", "escalate"] as const;

/**
 * Reads a verdict back from Fuji: the contract's `recordedAt(hash)` and, given its tx,
 * the VerdictRecorded event (agentId, decision, recorder) — what a third party would check.
 */
export async function readVerdict(hash: `0x${string}`, txHash?: string | null): Promise<OnChainVerdict> {
  const st = chainStatus();
  if (!st.registry) throw new Error("CHAIN_REGISTRY tanımlı değil.");
  const pub = publicClient();
  const at = await withTimeout(
    pub.readContract({ address: st.registry as Hex, abi: signalMindRegistryAbi, functionName: "recordedAt", args: [hash] }),
    15_000,
    "Fuji RPC yanıt vermedi.",
  );
  const out: OnChainVerdict = { recorded: at > 0n, recordedAt: at > 0n ? Number(at) * 1000 : null, txHash: txHash ?? null, block: null, agentId: null, decision: null, subject: null, recorder: null };
  if (!txHash) return out;
  const rc = await withTimeout(pub.getTransactionReceipt({ hash: txHash as Hex }), 15_000, "Fuji RPC yanıt vermedi.");
  const ev = parseEventLogs({ abi: signalMindRegistryAbi, logs: rc.logs, eventName: "VerdictRecorded" }).find(
    (l) => l.address.toLowerCase() === st.registry!.toLowerCase() && l.args.verdictHash.toLowerCase() === hash.toLowerCase(),
  );
  out.block = Number(rc.blockNumber);
  if (ev) {
    out.agentId = ev.args.agentId.toString();
    out.decision = DECISION_NAMES[ev.args.decision] ?? null;
    out.subject = ev.args.subject;
    out.recorder = ev.args.recorder;
  }
  return out;
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
  const wallet = createWalletClient({ account, chain: avalancheFuji, transport: transport() });
  const deadline = Date.now() + TIMEOUT_MS;
  const left = () => Math.max(1_000, deadline - Date.now());
  // Subject is public on-chain; keep it short and tie it to the off-chain verdict id.
  const subject = `${v.verdictId}|${v.subject}`.slice(0, 160);

  const balance = await withTimeout(pub.getBalance({ address: account.address }), left(), "Fuji RPC yanıt vermedi (bakiye sorgusu zaman aşımı).");
  if (balance === 0n) throw new Error(`Ajan cüzdanında test AVAX yok (${account.address}). Faucet: ${FAUCET_URL}`);

  let txHash: Hex;
  try {
    // Simulate first (eth_call) so contract reverts surface by name, then send with a fixed gas
    // limit: some public Fuji RPCs return absurd eth_estimateGas values ("exceeds block gas limit").
    const { request } = await withTimeout(
      pub.simulateContract({
        account,
        address: st.registry as Hex,
        abi: signalMindRegistryAbi,
        functionName: "recordVerdict",
        args: [BigInt(st.agentId!), v.hash, decision, subject],
      }),
      left(),
      "Fuji RPC yanıt vermedi (simülasyon zaman aşımı).",
    );
    txHash = await withTimeout(wallet.writeContract({ ...request, gas: RECORD_GAS }), left(), "Fuji işlemi gönderilemedi (zaman aşımı).");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/insufficient funds/i.test(m)) throw new Error(`Ajan cüzdanında gas için yeterli test AVAX yok (${account.address}). Faucet: ${FAUCET_URL}`);
    if (/AlreadyRecorded/.test(m)) throw new Error("Bu karar özeti zincirde zaten kayıtlı.");
    if (/NotAgentOwner/.test(m)) throw new Error("Bu cüzdan CHAIN_AGENT_ID kimliğinin sahibi değil.");
    throw new Error(`Fuji kaydı başarısız: ${m.split("\n")[0]}`);
  }

  const explorerUrl = `${EXPLORER_BASE}/tx/${txHash}`;
  const receipt = await pub
    .waitForTransactionReceipt({ hash: txHash, timeout: left(), pollingInterval: 1_500 })
    .catch(() => {
      throw new Error(`İşlem gönderildi ama 30 sn içinde onaylanmadı: ${explorerUrl}`);
    });
  if (receipt.status !== "success") throw new Error(`Fuji işlemi geri alındı (revert): ${explorerUrl}`);
  return { txHash, explorerUrl };
}
