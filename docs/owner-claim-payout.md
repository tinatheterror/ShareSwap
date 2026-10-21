# Owner claim awards: getting the money to the owner's wallet

Status: design note, no code. Applies to security claims on both **borrows and rentals**.

## Where things stand

- A settled claim moves money on Stripe: the deposit is captured, the borrower's share is refunded, and the rest is
  the award (`deposit_settlement_operations.retained_amount`, mirrored in `item_requests.deposit_retained_amount`).
- **Nothing credits the owner.** Neither `security-claims-service.ts` nor the claim routes write to
  `users.rental_balance`. The awarded money sits in the platform's Stripe balance, and the chat stamp and
  notification say "awarded to owner" about money the owner cannot see or withdraw.
- The wallet that does exist: `users.rental_balance` (available) and `users.pending_rental_balance` (escrow),
  `rental_payouts` (earnings and withdrawals), `GET /api/rental-balance`, withdrawal at
  `POST /api/rental-balance/payout` (needs Stripe Connect, $10 minimum), Connect onboarding at
  `/api/stripe/connect/onboard` and `/status`. Web `my-balance-page` and mobile `wallet.tsx` already call it "wallet".

## 1. One wallet

Treat `rental_balance` as the owner's general wallet: rental earnings, claim awards and (later) refunds of anything
else we owe a user.

- **Names.** Code, API and UI say *Wallet* and `walletBalance` / `walletPending`. Add `GET /api/wallet` returning
  `{ balance: { available, pending, total } }` and keep `/api/rental-balance` as an alias until both apps ship.
- **Column.** Keep `rental_balance` and `pending_rental_balance`. Renaming the column is not worth it: it changes
  nothing a user sees, touches every earnings and withdrawal query, and `drizzle-kit push --force` reads a rename as
  drop-and-add, which would wipe live balances unless it is done as a hand-written `ALTER TABLE ... RENAME COLUMN`.
  Hide the name behind one accessor (`walletBalance`) so a rename stays possible later.

## 2. Ledger

**Recommendation: a general `wallet_transactions` table**, not claim awards in `rental_payouts`.

`rental_payouts` is shaped like a rental: `platform_fee`, `processing_fee`, `hold_until`, statuses `held` and
`released`, and a request that was *rented*. Withdrawals already strain it (`request_id` null, `paid_out`, and now
`pending_payout`, `failed`, `manual_review`). A claim award has no fee, belongs to a claim, and has no hold. Putting
it there means a new `claim_id`, a `kind` column and a partial unique index, and the wallet history still cannot be
summed without knowing which statuses count.

```
wallet_transactions
  id, user_id,
  kind              'rental_payout' | 'claim_award' | 'withdrawal' | 'withdrawal_reversal'
  amount_cents      signed (+ credit, - debit)
  currency          see "Currency" below
  request_id, claim_id, rental_payout_id   nullable references
  idempotency_key   UNIQUE   e.g. 'claim-award-<claimId>'
  created_at
```

`users.rental_balance` stays as the cached total, changed in the same transaction as the ledger row. Rule: after the
backfill, `rental_balance = SUM(amount_cents)` per user, checked by a reconcile job. Phase 1 writes only
`claim_award`, plus `withdrawal` and `withdrawal_reversal` from the payout route. Rental earnings join the ledger
later, so the first release does not touch the handoff code.

## 3. Settlement

Credit inside the existing settlement transaction (`finalizeApprovedSettlement`).

1. That transaction already contains a conditional `UPDATE deposit_settlement_operations ... WHERE status IN
   ('PROCESSING','INDETERMINATE') RETURNING`, after the fence and eligibility checks. Only the caller that flips the row to `SETTLED` continues, so a replay
   or a reconcile pass cannot reach the credit twice.
2. Right after it, when the award is above zero, insert the ledger row with `idempotency_key = 'claim-award-<claimId>'
   ON CONFLICT DO NOTHING RETURNING id`. Only if a row came back, `UPDATE users SET rental_balance = rental_balance +
   <award>`. The unique key is the second lock: a manual or backfill insert for the same claim cannot double-credit.
3. The same transaction writes the notification and the chat lines (section 4), so the owner never sees a stamp
   without money behind it.

**Currency.** Deposits, holds and rental charges are created in **USD**; payout transfers and Connect accounts are
**CAD**. The wallet adds and pays out the same number in both. Decide the wallet currency before awards go live
(either create charges in CAD, or hold a USD wallet and convert at withdrawal) and store it on the ledger row.

## 4. Payout setup and the award prompt

Lenders need only a verified email, so most owners have no Stripe Connect account. Withdrawal already answers
`NO_PAYOUT_METHOD` for them. Stripe's hosted onboarding does the identity checks, so no in-app ID step is needed.

The prompt, with the owner's own amount:

> **You've been awarded $60**
> Set up payouts to withdraw it to your bank.
> **[Set up payouts]**

Shown three ways, only while the owner has not finished onboarding (`payoutsEnabled` false):

| Surface | What | Notes |
|---|---|---|
| Notification | type `claim_award_received`, title "You've been awarded $60", message "Set up payouts to withdraw it to your bank." | Push in the `payments` category. Deep link to the wallet. If payouts are already enabled: "It's in your wallet." |
| Wallet banner | The prompt above with the button, above the balance | Starts `/api/stripe/connect/onboard`. Disappears once onboarding completes. |
| Owner-only chat line | "You've been awarded $60. Set up payouts to withdraw it to your bank." with the button | The borrower sees only the shared stamp "Claim resolved · $60 awarded to owner". |

The chat line needs an audience. `messages` has a sender and a receiver but both sides read the whole thread, so add
a nullable `visible_to_user_id` and apply it in every query that reads a request's messages (conversation fetch,
inbox preview, unread counts, push). A `metadata.audience` flag that only the client honours would leak the line.

## 5. The $10 minimum

Withdrawals keep the $10 minimum (`MIN_PAYOUT`). Options for an award below it:

1. **Leave it in the wallet until the balance reaches $10.** No new rules. Show "$4 in your wallet, $6 more to reach
   the $10 minimum." *Recommended.*
2. Let owners withdraw the whole balance when it is below the minimum. Simple for the owner, but each small payout
   costs us a transfer and the owner a bank payout.
3. Sweep balances under $10 to the bank automatically after N days once payouts are set up. Needs a scheduled job and
   a policy on very old balances.
4. Lower the minimum for everyone. Changes rules for rentals too.

Start with 1 and revisit if support sees stuck small balances.

## 6. Backfill

Settled claims that kept money before this ships have an owner who was told "awarded" and was never credited.

- **Find them:** `deposit_settlement_operations` with `status = 'SETTLED'`, `claim_id` not null and
  `retained_amount > 0`, joined to `security_claims` (`status = 'SETTLED'`, `settlement_status = 'SETTLED'`).
  Cross-check against `item_requests.deposit_retained_amount`.
- **Script:** like the existing repair scripts, dry-run by default and `--live` to write. For each claim, the same
  ledger insert and balance update as section 3 with `idempotency_key = 'claim-award-<claimId>'`, so running it twice,
  or alongside live settlements, cannot double-credit.
- **Review first:** the dry run lists owner, claim, amount and request. Anything an admin already paid out by hand,
  and any claim in `MANUAL_REVIEW`, is excluded or marked before `--live`.
- **Owner messaging:** one notification per claim ("You've been awarded $X for <item>"). No chat line; the thread is
  closed.
- **Order:** ship ledger and settlement credit, then backfill. The idempotency key makes the order safe either way.

## 7. What the owner sees

- **Chat:** the shared stamp ("Claim resolved · $60 awarded to owner") and, until payouts are set up, the owner-only
  line with the button.
- **Notifications:** the award notification, with push.
- **Wallet:** the balance includes the award immediately, a history row "Claim award · <item> · +$60" linking to the
  request, and the banner until payouts are set up.

## Open questions

- Should an award be available immediately or sit in pending for a few days in case the borrower disputes the
  charge with their bank? Immediate is simplest; pending reuses `pending_rental_balance`.
- Wallet currency (section 3).
- Whether the owner-only chat line should also be sent when the owner already has payouts, as "It's in your wallet."
