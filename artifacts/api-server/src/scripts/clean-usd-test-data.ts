import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { assertDestructiveDatabaseAllowed } from "@workspace/db/test-database-guard";
import { getUncachableStripeClient } from "../stripe.server";
import { runTestDataCleanup, type CleanupPlan } from "../test-data-cleanup";

/**
 * Cleans the owner's USD test data: cancels the open USD requests (releasing their deposit holds in Stripe) and zeroes the
 * wallet balances with an 'adjustment' ledger row. A dry run by default, which prints the plan and its hash. To apply it:
 *   tsx src/scripts/clean-usd-test-data.ts --live --confirm <hash>
 * The hash ties the live run to the exact plan that was shown; if anything changed in between, nothing is touched.
 *
 * Options (give the same ones to the dry run and the live run, they are part of the hash):
 *   --close-without-hold 337,339   close these requests without trying to release a deposit hold (listed in the plan)
 *   --refund-rental-payments       also refund the USD rental payments already charged for the requests being closed (off by default)
 */
export function parseIdList(raw: string | undefined): number[] {
  if (!raw) throw new Error("--close-without-hold needs a comma-separated list of request ids, e.g. --close-without-hold 337,339");
  const ids = raw.split(",").map(s => s.trim()).filter(Boolean).map(Number);
  if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0)) throw new Error(`--close-without-hold: "${raw}" is not a list of request ids`);
  return [...new Set(ids)].sort((a, b) => a - b);
}

export function describePayments(plan: CleanupPlan): string {
  const lines = ["Rental payments already charged for the requests being closed (read from Stripe):"];
  let any = false;
  for (const r of plan.requests) {
    for (const p of r.rentalPayments) {
      any = true;
      const what = p.status === null ? "could not be read from Stripe" : `${p.status}, ${(p.amountCents / 100).toFixed(2)} charged, ${(p.refundedCents / 100).toFixed(2)} already refunded${p.livemode === null ? "" : p.livemode ? ", LIVE" : ", test mode"}`;
      lines.push(`  request ${r.id}  ${p.paymentIntentId}  ${what}${p.refundableCents > 0 ? `  -> ${plan.refundRentalPayments ? "WILL be refunded" : "would be refunded with --refund-rental-payments"}: ${(p.refundableCents / 100).toFixed(2)}` : ""}`);
    }
  }
  if (!any) lines.push("  none");
  const withoutHold = plan.requests.filter(r => r.action === "close_without_hold").map(r => r.id);
  lines.push(`Closed without trying to release a hold (--close-without-hold): ${withoutHold.length ? withoutHold.join(", ") : "none"}`);
  if (plan.unmatchedCloseWithoutHold.length) lines.push(`!! named but not open USD requests (live will refuse): ${plan.unmatchedCloseWithoutHold.join(", ")}`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  // A dry run only reads. A live run needs a test database, or ALLOW_NON_TEST_DATABASE=<its name>.
  if (args.includes("--live")) assertDestructiveDatabaseAllowed("close test rentals and refund test payments");
  const confirmAt = args.indexOf("--confirm");
  const withoutHoldAt = args.indexOf("--close-without-hold");
  const out = await runTestDataCleanup((await getUncachableStripeClient()) as any, {
    live: args.includes("--live"),
    confirm: confirmAt >= 0 ? args[confirmAt + 1] : undefined,
    refundRentalPayments: args.includes("--refund-rental-payments"),
    scope: withoutHoldAt >= 0 ? { closeWithoutHold: parseIdList(args[withoutHoldAt + 1]) } : undefined,
  });
  console.log(describePayments(out.plan));
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
