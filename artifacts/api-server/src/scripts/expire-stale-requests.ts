import { pathToFileURL } from "node:url";
import { db, itemRequests, items, pool, rentalPayouts } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  EXPIRABLE_REQUEST_TYPES,
  EXPIRABLE_STATUSES,
  expireRequestIfDue,
  isDueForExpiry,
  requestHandoffCutoff,
} from "../request-expiry-service";

// One-off cleanup: expire BORROW/RENT requests that are more than --min-age-days
// (default 3) past their handoff cutoff, silently. Money is released exactly as in the
// normal expiry, but nobody gets a notification, push or availability alert.
//
//   dry run (default): prints what would happen, makes no Stripe call, changes nothing
//   --apply          : does it; needs Stripe credentials
//   --min-age-days=N : how far past the cutoff a request must be (default 3)

const DAY_MS = 86_400_000;

export interface StaleCandidate {
  requestId: number;
  itemName: string;
  requestType: string;
  status: string;
  cutoff: Date;
  daysPastCutoff: number;
  depositIntent: string | null;
  plannedStripe: string[];
}

export async function findStaleRequests(now: Date, minAgeDays: number): Promise<StaleCandidate[]> {
  const rows = await db
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(
      and(
        inArray(itemRequests.status, [...EXPIRABLE_STATUSES]),
        inArray(itemRequests.requestType, [...EXPIRABLE_REQUEST_TYPES]),
      ),
    );

  const out: StaleCandidate[] = [];
  for (const row of rows) {
    const request = row.item_requests;
    const cutoff = requestHandoffCutoff(request);
    if (!cutoff || !isDueForExpiry(request, now)) continue;
    if (now.getTime() - cutoff.getTime() <= minAgeDays * DAY_MS) continue;

    const planned: string[] = [];
    for (const intentId of [request.depositPreviousPaymentIntentId, request.depositPaymentIntentId]) {
      if (!intentId) continue;
      planned.push(intentId.startsWith("simulated-") ? `skip ${intentId} (simulated)` : `release ${intentId}`);
    }
    const payouts = await db
      .select({ intent: rentalPayouts.stripePaymentIntentId })
      .from(rentalPayouts)
      .where(and(eq(rentalPayouts.requestId, request.id), eq(rentalPayouts.status, "held")));
    for (const { intent } of payouts) {
      if (!intent || intent === request.depositPaymentIntentId || intent.startsWith("simulated-")) continue;
      planned.push(`refund fee ${intent}`);
    }
    if (request.platformFeeChargeId && !request.platformFeeChargeId.startsWith("simulated-")) {
      planned.push(`refund platform fee ${request.platformFeeChargeId}`);
    }

    out.push({
      requestId: request.id,
      itemName: row.items.name,
      requestType: request.requestType ?? "",
      status: request.status ?? "",
      cutoff,
      daysPastCutoff: Math.floor((now.getTime() - cutoff.getTime()) / DAY_MS),
      depositIntent: request.depositPaymentIntentId,
      plannedStripe: planned,
    });
  }
  return out.sort((a, b) => a.requestId - b.requestId);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ageArg = args.find((a) => a.startsWith("--min-age-days="));
  const minAgeDays = ageArg ? Number(ageArg.split("=")[1]) : 3;
  if (!Number.isFinite(minAgeDays) || minAgeDays < 0) throw new Error("--min-age-days must be a number >= 0");

  const now = new Date();
  const candidates = await findStaleRequests(now, minAgeDays);
  console.log(`${apply ? "APPLY" : "DRY RUN"} at ${now.toISOString()}: ${candidates.length} request(s) more than ${minAgeDays} day(s) past cutoff`);
  for (const c of candidates) {
    console.log(
      `  #${c.requestId} ${c.requestType} ${c.status} "${c.itemName}" cutoff ${c.cutoff.toISOString()} (${c.daysPastCutoff}d ago)` +
        `\n      stripe: ${c.plannedStripe.length ? c.plannedStripe.join("; ") : "nothing to release"}`,
    );
  }
  if (!apply) {
    console.log("Dry run only: no Stripe calls, no changes, no notifications. Re-run with --apply to execute.");
    return;
  }

  const { getUncachableStripeClient } = await import("../stripe.server");
  const stripe = (await getUncachableStripeClient()) as any;
  let expired = 0;
  const failed: { requestId: number; error: string }[] = [];
  for (const c of candidates) {
    const outcome = await expireRequestIfDue(c.requestId, { stripe }, now, { silent: true });
    console.log(`  #${c.requestId}: ${outcome.status}${"error" in outcome ? ` (${outcome.error})` : ""}${"reason" in outcome ? ` (${outcome.reason})` : ""}`);
    if (outcome.status === "expired") expired++;
    if (outcome.status === "failed") failed.push({ requestId: c.requestId, error: outcome.error });
  }
  console.log(`Done: ${expired} expired, ${failed.length} failed (left unexpired, safe to re-run).`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
