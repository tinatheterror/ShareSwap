import { and, eq, sql } from "drizzle-orm";
import { db, itemRequests, items, notifications, rentalPayouts, requestLifecycleEvents, users, walletTransactions } from "@workspace/db";
import { recordCurrency } from "./payment-currency";
import { recordWalletEntry, rentalFreezeKey, rentalUnfreezeKey, toCents } from "./wallet-ledger";

/**
 * Freezes ONE rental's earnings in the owner's wallet while a handoff dispute opened after an auto-confirm is decided.
 * Only that rental's earnings are touched, never the rest of the balance:
 *   freeze  : moves min(earnings, available balance) from the wallet (rental_balance) to pending (pending_rental_balance)
 *             with a rental_payout_freeze ledger row, and marks the payout 'frozen'. If the owner already withdrew part of it
 *             the shortfall is recorded on a lifecycle event for an admin; it is never taken from other money.
 *   owner   : the handoff stands. The frozen amount returns to the wallet (rental_payout_unfreeze), the payout is 'released' again.
 *   borrower: the handoff did not happen. The frozen amount leaves pending for good (the payout is 'reversed'); refunding the
 *             borrower is a separate step.
 * Every step is claimed with a conditional UPDATE on the payout's status, so a retry or two callers cannot do it twice.
 */
export interface FreezeResult { payoutId: number; ownerId: number; netCents: number; frozenCents: number; shortfallCents: number }

export async function freezeRentalEarnings(requestId: number): Promise<FreezeResult | null> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(rentalPayouts).set({ status: "frozen" })
      .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "released")))
      .returning({ id: rentalPayouts.id, userId: rentalPayouts.userId, netAmount: rentalPayouts.netAmount });
    if (!claimed) return null;
    const netCents = toCents(claimed.netAmount);
    const [owner] = await tx.select({ b: users.rentalBalance }).from(users).where(eq(users.id, claimed.userId)).for("update");
    const frozenCents = Math.max(0, Math.min(netCents, toCents(owner?.b)));
    const shortfallCents = netCents - frozenCents;
    const [request] = await tx.select({ paymentCurrency: itemRequests.paymentCurrency, itemId: itemRequests.itemId }).from(itemRequests).where(eq(itemRequests.id, requestId)).limit(1);
    if (frozenCents > 0) {
      const dollars = (frozenCents / 100).toFixed(2);
      await tx.update(users).set({
        rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) - ${dollars}::numeric`,
        pendingRentalBalance: sql`COALESCE(${users.pendingRentalBalance}, 0) + ${dollars}::numeric`,
      }).where(eq(users.id, claimed.userId));
      await recordWalletEntry(tx, {
        userId: claimed.userId, kind: "rental_payout_freeze", amountCents: -frozenCents, currency: recordCurrency(request ?? {}),
        requestId, rentalPayoutId: claimed.id, idempotencyKey: rentalFreezeKey(claimed.id),
      });
    }
    await tx.insert(requestLifecycleEvents).values({
      requestId, eventType: "RENTAL_EARNINGS_FROZEN", idempotencyKey: `rental-earnings-frozen-${claimed.id}`,
      details: { rentalPayoutId: claimed.id, netCents, frozenCents, shortfallCents },
    }).onConflictDoNothing();
    const itemRows = request?.itemId ? await tx.select({ name: items.name }).from(items).where(eq(items.id, request.itemId)).limit(1) : [];
    const item = itemRows[0];
    await tx.insert(notifications).values({
      userId: claimed.userId, type: "rental_earnings_frozen", title: "Earnings on hold",
      message: `${frozenCents > 0 ? `$${(frozenCents / 100).toFixed(2)}` : "The earnings"} from "${item?.name ?? "your rental"}" ${frozenCents > 0 ? "are" : "were paid out before and are"} on hold while the handoff dispute is decided. The rest of your wallet is not affected.`,
      requestId, isRead: false,
    } as any);
    return { payoutId: claimed.id, ownerId: claimed.userId, netCents, frozenCents, shortfallCents };
  });
}

export type FreezeOutcome = "owner" | "borrower";

export async function resolveFrozenRentalEarnings(requestId: number, outcome: FreezeOutcome): Promise<{ payoutId: number; frozenCents: number; shortfallCents: number } | null> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.update(rentalPayouts).set({ status: outcome === "owner" ? "released" : "reversed" })
      .where(and(eq(rentalPayouts.requestId, requestId), eq(rentalPayouts.status, "frozen")))
      .returning({ id: rentalPayouts.id, userId: rentalPayouts.userId, netAmount: rentalPayouts.netAmount });
    if (!claimed) return null;
    const [freezeRow] = await tx.select().from(walletTransactions).where(eq(walletTransactions.idempotencyKey, rentalFreezeKey(claimed.id))).limit(1);
    const frozenCents = freezeRow ? -freezeRow.amountCents : 0;
    const shortfallCents = toCents(claimed.netAmount) - frozenCents;
    if (frozenCents > 0) {
      const dollars = (frozenCents / 100).toFixed(2);
      await tx.update(users).set({
        pendingRentalBalance: sql`GREATEST(0, COALESCE(${users.pendingRentalBalance}, 0) - ${dollars}::numeric)`,
        ...(outcome === "owner" ? { rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${dollars}::numeric` } : {}),
      }).where(eq(users.id, claimed.userId));
      if (outcome === "owner") {
        await recordWalletEntry(tx, {
          userId: claimed.userId, kind: "rental_payout_unfreeze", amountCents: frozenCents, currency: freezeRow.currency,
          requestId, rentalPayoutId: claimed.id, idempotencyKey: rentalUnfreezeKey(claimed.id),
        });
      }
    }
    await tx.insert(requestLifecycleEvents).values({
      requestId, eventType: outcome === "owner" ? "RENTAL_EARNINGS_UNFROZEN" : "RENTAL_EARNINGS_REVERSED", idempotencyKey: `rental-earnings-${outcome}-${claimed.id}`,
      details: { rentalPayoutId: claimed.id, frozenCents, shortfallCents },
    }).onConflictDoNothing();
    return { payoutId: claimed.id, frozenCents, shortfallCents };
  });
}
