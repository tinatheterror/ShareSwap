import { and, eq, inArray, sql } from "drizzle-orm";
import { db, notifications, users, walletChargebacks, type WalletChargeback } from "@workspace/db";
import { chargebackFeeKey, chargebackKey, chargebackReversalKey, debtPaymentKey, recordWalletEntry, toCents } from "./wallet-ledger";

/**
 * Recovering a Stripe dispute (chargeback) from the member who received the money.
 *   created        : the member's share of the disputed payment is taken from the wallet balance (never below zero). Whatever
 *                    the balance cannot cover stays owed (a debt); it is not an error and the dispute is still recorded.
 *   funds_withdrawn: Stripe's dispute fee is charged the same way.
 *   closed         : won  -> everything collected is returned to the wallet and nothing is owed;
 *                    lost -> what was taken stays taken, and any debt stays open.
 *   later credits  : while a debt is open, every new credit (rental earnings, claim awards) pays it off first; only the rest
 *                    reaches the balance, so only that surplus can be withdrawn. There is no separate withdrawal block.
 * Everything is keyed on the dispute id (and, for debt payments, on the credit that paid), so Stripe re-sending an event or a
 * retry cannot take or return money twice.
 */
const dollars = (cents: number) => (cents / 100).toFixed(2);
const money = (cents: number) => `$${dollars(cents)}`;
const owedOf = (row: Pick<WalletChargeback, "principalCents" | "feeCents" | "collectedCents">) => Math.max(0, row.principalCents + row.feeCents - row.collectedCents);

export interface ChargebackInput {
  userId: number;
  disputeId: string;
  paymentIntentId: string | null;
  requestId: number | null;
  currency: string;
  principalCents: number;
}

/** Takes what the balance can cover, within the caller's transaction. Returns how many cents were taken. */
async function takeFromBalance(tx: any, userId: number, wantedCents: number): Promise<number> {
  if (wantedCents <= 0) return 0;
  const [row] = await tx.select({ b: users.rentalBalance }).from(users).where(eq(users.id, userId)).for("update");
  const take = Math.max(0, Math.min(wantedCents, toCents(row?.b)));
  if (take > 0) await tx.update(users).set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) - ${dollars(take)}::numeric` }).where(eq(users.id, userId));
  return take;
}

export async function recordChargeback(input: ChargebackInput): Promise<"recorded" | "duplicate"> {
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(walletChargebacks).values({
      userId: input.userId, disputeId: input.disputeId, paymentIntentId: input.paymentIntentId, requestId: input.requestId,
      currency: input.currency, principalCents: input.principalCents,
    }).onConflictDoNothing({ target: walletChargebacks.disputeId }).returning();
    if (!created) return "duplicate";
    const take = await takeFromBalance(tx, input.userId, input.principalCents);
    if (take > 0) {
      await recordWalletEntry(tx, {
        userId: input.userId, kind: "chargeback", amountCents: -take, currency: input.currency, requestId: input.requestId, idempotencyKey: chargebackKey(input.disputeId),
      });
      await tx.update(walletChargebacks).set({ collectedCents: take }).where(eq(walletChargebacks.id, created.id));
    }
    const owed = input.principalCents - take;
    await tx.insert(notifications).values({
      userId: input.userId, type: "wallet_chargeback", title: "A payment was disputed", requestId: input.requestId, isRead: false,
      message: owed > 0
        ? `A customer disputed a payment you received. ${money(take)} was taken from your wallet and you owe ${money(owed)} more; your next earnings will pay it off first.`
        : `A customer disputed a payment you received. ${money(take)} was taken from your wallet while the dispute is decided. If it is decided in your favour it will be returned.`,
    } as any);
    return "recorded";
  });
}

/** Stripe's dispute fee, charged once (a second event for the same dispute changes nothing). */
export async function recordChargebackFee(disputeId: string, feeCents: number): Promise<"recorded" | "duplicate" | "unknown"> {
  if (feeCents <= 0) return "duplicate";
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(walletChargebacks).where(eq(walletChargebacks.disputeId, disputeId)).for("update");
    if (!row) return "unknown";
    const [claimed] = await tx.update(walletChargebacks).set({ feeCents })
      .where(and(eq(walletChargebacks.id, row.id), eq(walletChargebacks.feeCents, 0))).returning({ id: walletChargebacks.id });
    if (!claimed) return "duplicate";
    const take = await takeFromBalance(tx, row.userId, feeCents);
    if (take > 0) {
      await recordWalletEntry(tx, {
        userId: row.userId, kind: "chargeback_fee", amountCents: -take, currency: row.currency, requestId: row.requestId, idempotencyKey: chargebackFeeKey(disputeId),
      });
      await tx.update(walletChargebacks).set({ collectedCents: row.collectedCents + take }).where(eq(walletChargebacks.id, row.id));
    }
    return "recorded";
  });
}

/** What Stripe actually gave back to us when the dispute closed, read from the dispute's balance transactions. */
export interface StripeReturn {
  /** Total positive money that came back to the platform on this dispute, in cents (the reinstated payment, and the fee if Stripe returned it). */
  returnedCents: number;
  /** The disputed amount, in cents. */
  disputeAmountCents: number;
}

/**
 * Closes a dispute. When it is won the member gets back only what Stripe really returned to us:
 *   - the member's share of the payment, up to the reinstated amount (the first `disputeAmountCents` that came back);
 *   - the dispute fee, only to the extent Stripe returned more than the disputed amount.
 * Whatever Stripe did not return (typically the fee) stays with the member as an obligation, and is paid from the
 * collected money or later earnings like any debt. With no Stripe figures nothing is returned.
 */
export async function closeChargeback(disputeId: string, outcome: "won" | "lost", stripeReturn: StripeReturn = { returnedCents: 0, disputeAmountCents: 0 }): Promise<"won" | "lost" | "duplicate" | "unknown"> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(walletChargebacks).where(eq(walletChargebacks.disputeId, disputeId)).for("update");
    if (!row) return "unknown";
    let principal = row.principalCents;
    let fee = row.feeCents;
    let collected = row.collectedCents;
    let refund = 0;
    if (outcome === "won") {
      const returned = Math.max(0, stripeReturn.returnedCents);
      const disputed = Math.max(0, stripeReturn.disputeAmountCents);
      principal = row.principalCents - Math.min(row.principalCents, returned, disputed);
      fee = row.feeCents - Math.min(row.feeCents, Math.max(0, returned - disputed));
      refund = Math.max(0, collected - (principal + fee));
      collected -= refund;
    }
    const stillOwed = Math.max(0, principal + fee - collected);
    const status = outcome === "won" && stillOwed === 0 ? "won" : "lost";
    const [closed] = await tx.update(walletChargebacks)
      .set({ status, principalCents: principal, feeCents: fee, collectedCents: collected, closedAt: new Date() })
      .where(and(eq(walletChargebacks.id, row.id), eq(walletChargebacks.status, "open"))).returning({ id: walletChargebacks.id });
    if (!closed) return "duplicate";
    if (refund > 0) {
      await tx.update(users).set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${dollars(refund)}::numeric` }).where(eq(users.id, row.userId));
      await recordWalletEntry(tx, {
        userId: row.userId, kind: "chargeback_reversal", amountCents: refund, currency: row.currency, requestId: row.requestId, idempotencyKey: chargebackReversalKey(disputeId),
      });
    }
    await tx.insert(notifications).values({
      userId: row.userId, type: "wallet_chargeback", title: outcome === "won" ? "Dispute decided in your favour" : "Dispute decided against you", requestId: row.requestId, isRead: false,
      message: outcome === "won"
        ? `The disputed payment was decided in your favour.${refund > 0 ? ` ${money(refund)} was returned to your wallet.` : ""}${stillOwed > 0 ? ` ${money(stillOwed)} (Stripe's dispute fee, which Stripe did not return) is still owed; your next earnings will pay it off first.` : ""}`
        : `The disputed payment was decided against you. ${money(row.collectedCents)} stays taken${owedOf(row) > 0 ? ` and you still owe ${money(owedOf(row))}; your next earnings will pay it off first` : ""}.`,
    } as any);
    return outcome;
  });
}

/**
 * Pays this member's open debts from a credit that is about to reach their balance, oldest first, and returns how many
 * cents it used. The caller adds only (credit - used) to the balance. Same-currency debts only. Call it inside the
 * transaction that records the credit, with a key that names that credit (e.g. rental-earning-12) so a retry cannot pay twice.
 */
export async function payDebtsFromCredit(tx: any, userId: number, creditCents: number, currency: string, sourceKey: string): Promise<number> {
  if (creditCents <= 0) return 0;
  const debts: WalletChargeback[] = await tx.select().from(walletChargebacks)
    .where(and(eq(walletChargebacks.userId, userId), eq(walletChargebacks.currency, currency), inArray(walletChargebacks.status, ["open", "lost"])))
    .orderBy(walletChargebacks.id).for("update");
  let left = creditCents;
  for (const debt of debts) {
    const pay = Math.min(left, owedOf(debt));
    if (pay <= 0) continue;
    const recorded = await recordWalletEntry(tx, {
      userId, kind: "debt_payment", amountCents: -pay, currency, requestId: debt.requestId, idempotencyKey: debtPaymentKey(debt.id, sourceKey),
    });
    if (!recorded) continue;
    await tx.update(walletChargebacks).set({ collectedCents: debt.collectedCents + pay }).where(eq(walletChargebacks.id, debt.id));
    left -= pay;
    if (left === 0) break;
  }
  return creditCents - left;
}

/** What the member still owes, by currency (the wallet shows this as "debt"). */
export async function openDebtCents(userId: number): Promise<number> {
  const rows = await db.select().from(walletChargebacks).where(and(eq(walletChargebacks.userId, userId), inArray(walletChargebacks.status, ["open", "lost"])));
  return rows.reduce((total, row) => total + owedOf(row), 0);
}
