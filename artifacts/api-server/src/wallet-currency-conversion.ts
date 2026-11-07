import { db, notifications, pool, PLATFORM_CURRENCY, users } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { conversionInKey, conversionOutKey, recordWalletEntry, toCents } from "./wallet-ledger";

/**
 * Converts wallet credits that were earned in another currency (the USD requests from before the move to CAD) to the
 * wallet's currency, at the exchange rate Stripe applied to the ORIGINAL charge (the balance transaction's
 * exchange_rate), not today's rate. Each credit gets a pair of ledger rows (kind currency_conversion): minus the old
 * amount in its currency, plus the new amount in CAD, so the ledger still sums to the balance. Nothing is invented: a
 * credit with no Stripe rate (a simulated payment, a charge Stripe cannot find) is listed and left alone, and so is a
 * user whose balance the ledger does not fully explain or who has already withdrawn.
 */
export interface StripeRates {
  paymentIntents: { retrieve(id: string, params?: any): Promise<any> };
}

export interface PlannedConversion {
  ledgerId: number;
  rentalPayoutId: number | null;
  paymentIntentId: string | null;
  fromCurrency: string;
  fromCents: number;
  rate: number;
  toCents: number;
}
export interface SkippedCredit { ledgerId: number; rentalPayoutId: number | null; reason: string }
export interface UserConversionPlan {
  userId: number;
  beforeCents: number;
  afterCents: number;
  conversions: PlannedConversion[];
  skipped: SkippedCredit[];
  refused: string | null;
}

export async function rateForCharge(stripe: StripeRates, paymentIntentId: string | null): Promise<{ rate: number } | { reason: string }> {
  if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) return { reason: "no real Stripe payment (simulated or missing)" };
  let intent: any;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
  } catch (error) {
    return { reason: `Stripe could not retrieve the payment: ${(error as Error).message?.slice(0, 80)}` };
  }
  const charge = intent?.latest_charge;
  const bt = charge?.balance_transaction;
  if (!bt || typeof bt !== "object") return { reason: "the charge has no balance transaction" };
  if (String(bt.currency).toLowerCase() === String(charge.currency ?? intent.currency).toLowerCase()) {
    return { reason: "Stripe did not convert this charge (settled in its own currency)" };
  }
  const rate = Number(bt.exchange_rate) || (bt.amount && charge.amount ? Number(bt.amount) / Number(charge.amount) : 0);
  if (!(rate > 0)) return { reason: "Stripe gave no exchange rate" };
  return { rate };
}

export async function planCurrencyConversion(stripe: StripeRates): Promise<UserConversionPlan[]> {
  const credits = await pool.query(
    `SELECT t.id, t.user_id, t.amount_cents, t.currency, t.rental_payout_id, p.stripe_payment_intent_id
       FROM wallet_transactions t LEFT JOIN rental_payouts p ON p.id = t.rental_payout_id
      WHERE t.kind = 'rental_payout' AND t.currency <> $1
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions c WHERE c.idempotency_key = 'currency-conversion-out-' || t.id)
      ORDER BY t.user_id, t.id`,
    [PLATFORM_CURRENCY],
  );
  const byUser = new Map<number, any[]>();
  for (const row of credits.rows) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  const plans: UserConversionPlan[] = [];
  for (const [userId, rows] of byUser) {
    const [balanceRow, ledgerRow, withdrawals] = await Promise.all([
      pool.query(`SELECT rental_balance FROM users WHERE id = $1`, [userId]),
      pool.query(`SELECT COALESCE(SUM(amount_cents), 0)::int AS cents FROM wallet_transactions WHERE user_id = $1`, [userId]),
      pool.query(`SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id = $1 AND kind IN ('withdrawal', 'withdrawal_reversal')`, [userId]),
    ]);
    const beforeCents = toCents(balanceRow.rows[0]?.rental_balance);
    const plan: UserConversionPlan = { userId, beforeCents, afterCents: beforeCents, conversions: [], skipped: [], refused: null };
    if (beforeCents !== ledgerRow.rows[0].cents) plan.refused = "the ledger does not explain the balance (run the ledger backfill first, or look at the drift)";
    else if (withdrawals.rows[0].n > 0) plan.refused = "the user has withdrawn from this wallet, so which part is USD is unclear";
    for (const row of rows) {
      const found = await rateForCharge(stripe, row.stripe_payment_intent_id);
      if ("reason" in found) {
        plan.skipped.push({ ledgerId: row.id, rentalPayoutId: row.rental_payout_id, reason: found.reason });
        continue;
      }
      const to = Math.round(Number(row.amount_cents) * found.rate);
      plan.conversions.push({
        ledgerId: row.id, rentalPayoutId: row.rental_payout_id, paymentIntentId: row.stripe_payment_intent_id,
        fromCurrency: String(row.currency).toLowerCase(), fromCents: Number(row.amount_cents), rate: found.rate, toCents: to,
      });
      plan.afterCents += to - Number(row.amount_cents);
    }
    plans.push(plan);
  }
  return plans;
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Applies one user's plan in one transaction; returns false (and changes nothing) if the balance moved since it was planned. */
export async function applyUserConversion(plan: UserConversionPlan): Promise<boolean> {
  if (plan.refused || plan.conversions.length === 0) return false;
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ b: users.rentalBalance }).from(users).where(eq(users.id, plan.userId)).for("update");
    if (toCents(row?.b) !== plan.beforeCents) return false;
    for (const c of plan.conversions) {
      const out = await recordWalletEntry(tx, {
        userId: plan.userId, kind: "currency_conversion", amountCents: -c.fromCents, currency: c.fromCurrency,
        rentalPayoutId: c.rentalPayoutId, idempotencyKey: conversionOutKey(c.ledgerId),
      });
      if (!out) {
        tx.rollback();
        return false; // already converted by another run
      }
      await recordWalletEntry(tx, {
        userId: plan.userId, kind: "currency_conversion", amountCents: c.toCents, currency: PLATFORM_CURRENCY,
        rentalPayoutId: c.rentalPayoutId, idempotencyKey: conversionInKey(c.ledgerId),
      });
    }
    const delta = (plan.afterCents - plan.beforeCents) / 100;
    await tx.update(users).set({ rentalBalance: sql`COALESCE(${users.rentalBalance}, 0) + ${delta.toFixed(2)}::numeric` }).where(eq(users.id, plan.userId));
    const from = plan.conversions.reduce((total, c) => total + c.fromCents, 0);
    const to = plan.conversions.reduce((total, c) => total + c.toCents, 0);
    await tx.insert(notifications).values({
      userId: plan.userId, type: "wallet_currency_conversion", title: "Your wallet balance is now in Canadian dollars",
      message: `Earnings of ${money(from)} USD in your wallet were converted to ${money(to)} CAD, at the exchange rate Stripe applied when each payment was made. Your wallet balance is now ${money(plan.afterCents)} CAD.`,
      isRead: false,
    } as any);
    return true;
  }).catch((error) => {
    if ((error as Error)?.name === "TransactionRollbackError") return false;
    throw error;
  });
}

export function describePlan(plans: UserConversionPlan[]) {
  return plans.map(p => ({
    userId: p.userId, beforeCents: p.beforeCents, afterCents: p.afterCents, refused: p.refused,
    conversions: p.conversions.map(c => ({
      rentalPayoutId: c.rentalPayoutId, from: `${money(c.fromCents)} ${c.fromCurrency.toUpperCase()}`, rate: c.rate, to: `${money(c.toCents)} CAD`,
    })),
    skipped: p.skipped,
  }));
}
