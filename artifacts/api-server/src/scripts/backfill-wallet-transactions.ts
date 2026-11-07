import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { applyWalletBackfill, planWalletBackfill } from "../wallet-ledger-backfill";

/**
 * Backfills wallet_transactions from rental_payouts and claim settlements. A dry run by default: it prints what it would
 * write and which users' balances the ledger still does not explain. `--live` writes. Safe to run twice.
 *   tsx src/scripts/backfill-wallet-transactions.ts [--live]
 */
async function main() {
  const live = process.argv.includes("--live");
  const plan = await planWalletBackfill();
  const byKind = new Map<string, { count: number; cents: number }>();
  for (const e of plan.entries) {
    const slot = byKind.get(e.kind) ?? { count: 0, cents: 0 };
    slot.count++;
    slot.cents += e.amountCents;
    byKind.set(e.kind, slot);
  }
  console.log(JSON.stringify({ mode: live ? "live" : "dry-run", wouldWrite: plan.entries.length, byKind: Object.fromEntries(byKind), balancesNotExplainedByLedger: plan.drift }, null, 2));
  if (live) console.log(JSON.stringify({ written: await applyWalletBackfill(plan) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
