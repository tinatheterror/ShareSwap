import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { getUncachableStripeClient } from "../stripe.server";
import { applyUserConversion, describePlan, planCurrencyConversion } from "../wallet-currency-conversion";

/**
 * Converts non-CAD wallet credits to CAD at the exchange rate of the original Stripe charge. A dry run by default: it prints,
 * per user, the balance before and after and the rate used for each credit. `--live` applies it. Needs the wallet ledger
 * backfilled first and the LIVE Stripe key (the charges are in the live account). Safe to run twice.
 *   tsx src/scripts/convert-wallet-currency.ts [--live]
 */
async function main() {
  const live = process.argv.includes("--live");
  const plans = await planCurrencyConversion(await getUncachableStripeClient());
  console.log(JSON.stringify({ mode: live ? "live" : "dry-run", users: describePlan(plans) }, null, 2));
  if (live) {
    for (const plan of plans) console.log(JSON.stringify({ userId: plan.userId, applied: await applyUserConversion(plan) }));
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
