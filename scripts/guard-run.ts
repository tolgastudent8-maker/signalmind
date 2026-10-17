import { startCheck, waitForCheck } from "../src/lib/guard/agent.ts";
import { getCheck } from "../src/lib/guard/queries.ts";
import { SCENARIOS } from "../src/lib/guard/scenarios.ts";

/**
 * Runs one Guard audit from the command line and prints its trail.
 * Usage: node --env-file=.env.local --experimental-strip-types scripts/guard-run.ts [rumor|verified|oversize]
 */

const scenario = SCENARIOS.find((s) => s.id === (process.argv[2] ?? "rumor"));
if (!scenario) throw new Error(`Senaryo yok. Seçenekler: ${SCENARIOS.map((s) => s.id).join(", ")}`);
const id = await startCheck(scenario.build(), scenario.id);
await waitForCheck(id);
const r = (await getCheck(id))!;
for (const e of r.events) console.log(`[${e.kind}] ${e.title}${e.payload && e.kind !== "start" ? `  ${JSON.stringify(e.payload).slice(0, 300)}` : ""}`);
console.log("\nstatus:", r.check.status, "| decision:", r.check.decision, "| final:", r.check.final_decision, r.check.error ?? "");
console.log(JSON.stringify(r.check.verdict, null, 2)?.slice(0, 3000));
process.exit(0);
