import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { getUncachableStripeClient } from "../stripe.server";
import { runTestDataCleanup } from "../test-data-cleanup";

/**
 * Cleans the owner's USD test data: cancels the open USD requests (releasing their deposit holds in Stripe) and zeroes the
 * wallet balances with an 'adjustment' ledger row. A dry run by default, which prints the plan and its hash. To apply it:
 *   tsx src/scripts/clean-usd-test-data.ts --live --confirm <hash>
 * The hash ties the live run to the exact plan that was shown; if anything changed in between, nothing is touched.
 */
async function main() {
  const args = process.argv.slice(2);
  const confirmAt = args.indexOf("--confirm");
  const out = await runTestDataCleanup((await getUncachableStripeClient()) as any, {
    live: args.includes("--live"),
    confirm: confirmAt >= 0 ? args[confirmAt + 1] : undefined,
  });
  console.log(JSON.stringify(out, null, 2));
  if (out.refused) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
