/**
 * Zincire yazılamamış (RPC hatası, zaman aşımı) nihai kararları Fuji'ye yeniden yazar.
 * Çalıştırma: node --experimental-strip-types scripts/chain-retry.ts
 */
import { loadEnv } from "./chain-env.ts";
import { anchorVerdict, chainStatus, publicClient, signalMindRegistryAbi, EXPLORER_BASE } from "../src/lib/chain.ts";
import { db } from "../src/lib/db.ts";

loadEnv();
const st = chainStatus();
if (!st.configured) {
  console.error(`Fuji yapılandırılmamış: ${st.error}`);
  process.exit(1);
}

async function findVerdictTx(hash: `0x${string}`): Promise<string | undefined> {
  const pub = publicClient();
  const latest = await pub.getBlockNumber();
  // Public RPCs cap getLogs ranges; scan back in 2k-block windows (~1 h each on Fuji).
  for (let to = latest, i = 0; i < 24; i++, to -= 2000n) {
    const logs = await pub.getContractEvents({
      address: st.registry as `0x${string}`,
      abi: signalMindRegistryAbi,
      eventName: "VerdictRecorded",
      args: { verdictHash: hash },
      fromBlock: to > 2000n ? to - 1999n : 0n,
      toBlock: to,
    });
    if (logs[0]) return logs[0].transactionHash;
  }
  return undefined;
}

const rows = db()
  .prepare(
    `SELECT id, proposal_json, final_decision, verdict_hash FROM guard_checks
     WHERE chain_tx IS NULL AND verdict_hash IS NOT NULL AND final_decision IN ('approve', 'reject', 'escalate') AND status = 'done'`,
  )
  .all() as { id: string; proposal_json: string; final_decision: "approve" | "reject" | "escalate"; verdict_hash: `0x${string}` }[];

console.log(`${rows.length} karar zincire yazılmayı bekliyor.`);
for (const r of rows) {
  const p = JSON.parse(r.proposal_json) as { bot: string; side: string; instId: string; notionalUsd: number };
  try {
    const res = await anchorVerdict({ verdictId: r.id.slice(0, 8), hash: r.verdict_hash, decision: r.final_decision, subject: `${p.bot} ${p.side} ${p.instId} ${p.notionalUsd}USD` });
    db().prepare(`UPDATE guard_checks SET chain_tx = ?, chain_error = NULL WHERE id = ?`).run(res.txHash, r.id);
    console.log(`  ✓ ${r.id.slice(0, 8)} ${r.final_decision} → ${res.explorerUrl}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/zaten kayıtlı/.test(msg)) {
      // The earlier send reached the chain but its response was lost: recover the tx from the event log.
      const tx = await findVerdictTx(r.verdict_hash);
      if (tx) db().prepare(`UPDATE guard_checks SET chain_tx = ?, chain_error = NULL WHERE id = ?`).run(tx, r.id);
      console.log(`  = ${r.id.slice(0, 8)} zaten zincirde${tx ? ` → ${EXPLORER_BASE}/tx/${tx}` : " (tx bulunamadı)"}`);
    } else console.log(`  ✕ ${r.id.slice(0, 8)} ${msg}`);
  }
}
