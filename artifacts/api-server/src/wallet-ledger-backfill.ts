import { db, pool, PLATFORM_CURRENCY } from "@workspace/db";
import { claimAwardKey, recordWalletEntry, rentalEarningKey, toCents, withdrawalKey, withdrawalReversalKey, type WalletEntry } from "./wallet-ledger";

/**
 * Derives wallet ledger rows for what happened before the ledger existed, from the records that already hold it:
 *   - rental_payouts with a request and status 'released'  -> rental_payout (+net, in the request's payment currency)
 *   - rental_payouts without a request (withdrawals)       -> withdrawal (-net); a 'failed' one also gets its withdrawal_reversal (+net)
 *   - deposit_settlement_operations with wallet_credited_at -> claim_award (+credited amount)
 * Each row uses the same idempotency key as the live writers, so running it twice, or next to live traffic, records nothing twice.
 * It only reports drift (users whose balance the ledger does not explain); it never invents an opening-balance row.
 */
export interface WalletDrift { userId: number; balanceCents: number; ledgerCents: number; differenceCents: number }
export interface WalletBackfillPlan { entries: WalletEntry[]; drift: WalletDrift[] }

type Query = (text: string, values?: any[]) => Promise<{ rows: any[] }>;

const WITHDRAWAL_STATUSES = ["pending_payout", "manual_review", "paid_out", "failed"];

export interface WalletBackfillOptions {
  /** Plan only for these members: their rows, their ledger and their balance. Tests use it so other rows in the database cannot change the result. */
  onlyUserIds?: number[];
}

export async function planWalletBackfill(
  query: Query = (text, values) => pool.query(text, values),
  options: WalletBackfillOptions = {},
): Promise<WalletBackfillPlan> {
  const only = options.onlyUserIds ? new Set(options.onlyUserIds) : null;
  const mine = (userId: number) => !only || only.has(userId);
  const candidates: WalletEntry[] = [];

  const earnings = await query(
    `SELECT p.id, p.user_id, p.request_id, p.net_amount, COALESCE(p.released_at, p.created_at) AS at, COALESCE(r.payment_currency, 'usd') AS currency
       FROM rental_payouts p LEFT JOIN item_requests r ON r.id = p.request_id
      WHERE p.request_id IS NOT NULL AND p.status = 'released' ORDER BY p.id`,
  );
  for (const row of earnings.rows.filter((r) => mine(r.user_id))) {
    candidates.push({
      userId: row.user_id, kind: "rental_payout", amountCents: toCents(row.net_amount), currency: String(row.currency).toLowerCase(),
      requestId: row.request_id, rentalPayoutId: row.id, idempotencyKey: rentalEarningKey(row.id), createdAt: row.at,
    });
  }

  const withdrawals = await query(
    `SELECT id, user_id, net_amount, status, created_at FROM rental_payouts WHERE request_id IS NULL AND status = ANY($1) ORDER BY id`,
    [WITHDRAWAL_STATUSES],
  );
  for (const row of withdrawals.rows.filter((r) => mine(r.user_id))) {
    const cents = toCents(row.net_amount);
    candidates.push({
      userId: row.user_id, kind: "withdrawal", amountCents: -cents, currency: PLATFORM_CURRENCY, rentalPayoutId: row.id,
      idempotencyKey: withdrawalKey(row.id), createdAt: row.created_at,
    });
    if (row.status === "failed") {
      candidates.push({
        userId: row.user_id, kind: "withdrawal_reversal", amountCents: cents, currency: PLATFORM_CURRENCY, rentalPayoutId: row.id,
        idempotencyKey: withdrawalReversalKey(row.id), createdAt: row.created_at,
      });
    }
  }

  const awards = await query(
    `SELECT o.claim_id, c.owner_id, o.request_id, o.wallet_credited_amount, o.wallet_credited_at, COALESCE(r.payment_currency, 'usd') AS currency
       FROM deposit_settlement_operations o
       JOIN security_claims c ON c.id = o.claim_id
       JOIN item_requests r ON r.id = o.request_id
      WHERE o.wallet_credited_at IS NOT NULL AND o.wallet_credited_amount > 0 ORDER BY o.id`,
  );
  for (const row of awards.rows.filter((r) => mine(r.owner_id))) {
    candidates.push({
      userId: row.owner_id, kind: "claim_award", amountCents: toCents(row.wallet_credited_amount), currency: String(row.currency).toLowerCase(),
      requestId: row.request_id, claimId: row.claim_id, idempotencyKey: claimAwardKey(row.claim_id), createdAt: row.wallet_credited_at,
    });
  }

  const existing = await query(`SELECT idempotency_key, user_id, amount_cents FROM wallet_transactions`);
  const have = new Set(existing.rows.map(r => r.idempotency_key as string));
  const entries = candidates.filter(c => !have.has(c.idempotencyKey) && c.amountCents !== 0);

  const ledger = new Map<number, number>();
  for (const r of existing.rows.filter((r) => mine(r.user_id))) ledger.set(r.user_id, (ledger.get(r.user_id) ?? 0) + Number(r.amount_cents));
  for (const e of entries) ledger.set(e.userId, (ledger.get(e.userId) ?? 0) + e.amountCents);
  const balances = await query(`SELECT id, rental_balance FROM users WHERE COALESCE(rental_balance, 0) <> 0`);
  const balanceOf = new Map<number, number>(balances.rows.filter((r) => mine(r.id)).map(r => [r.id, toCents(r.rental_balance)]));
  const drift: WalletDrift[] = [];
  for (const userId of new Set([...ledger.keys(), ...balanceOf.keys()])) {
    const balanceCents = balanceOf.get(userId) ?? 0;
    const ledgerCents = ledger.get(userId) ?? 0;
    if (balanceCents !== ledgerCents) drift.push({ userId, balanceCents, ledgerCents, differenceCents: balanceCents - ledgerCents });
  }
  return { entries, drift };
}

/** Writes the planned rows, each in its own statement so one already-present key cannot stop the rest. Returns how many were new. */
export async function applyWalletBackfill(plan: WalletBackfillPlan): Promise<number> {
  let written = 0;
  for (const entry of plan.entries) if (await recordWalletEntry(db, entry)) written++;
  return written;
}
