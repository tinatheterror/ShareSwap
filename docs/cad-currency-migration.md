# Plan: charge everything in CAD

Status: **code implemented** (see "What shipped" below). Still to do by hand: run the schema SQL, create CAD subscription
Prices in Stripe, and decide on the wallet and existing-subscriber questions further down. The sections after "What shipped"
are the original plan and still describe the reasoning.

## What shipped

- `PLATFORM_CURRENCY = "cad"` in `lib/db/src/currency.ts` is the only place a charge currency is written for new money. Every
  PaymentIntent create (rental hold, refundable deposit, rental charge, borrow hold, platform fee, private courier fee) and the
  wallet payout transfer read it, or the request's own record. A test fails if `currency: "usd" | "cad"` appears in API source.
- `item_requests.payment_currency` (`lib/db/scripts/0011_payment_currency.sql`, existing rows `'usd'`) records the currency of the
  request's Stripe objects. A request with no PaymentIntent yet is stamped with the platform currency before its first one is
  created; a request that already has one (deposit hold attempt, deposit, previous hold, or platform fee) keeps what it has, so a
  USD request in progress holds, captures, refunds and releases in USD. `request_refunds.currency` is written from the request.
- `renewDepositHold` is permanently disabled (its body is commented out), so there is no renewal path to change today; if it is ever
  restored it must create the replacement in `recordCurrency(request)`.
- Display: one money format in both apps and the server text (`lib/money.ts` on web and mobile, `formatMoney` in the server's
  `deposit-copy.ts`): `$20`, `$20.50`, `$1,250`; checkout lines use `$20.00`. Amounts are Canadian dollars with a bare `$`, and
  "Prices in CAD" is said once where money is collected (deposit and rental checkout, subscription plans) plus "Paid out in CAD"
  on the wallet. Only a request still charged in USD says `US$`.
- Not covered: server-built notification and chat sentences for a USD request in progress still say `$`; they stop mattering once
  the USD requests drain. A checkout started on an unpaid request that already has a USD hold attempt charges USD under a
  "Prices in CAD" note; that window is the length of one hold attempt.

## What is in USD today

`routes.ts` creates these PaymentIntents with `currency: "usd"`:

| Charge | Where | Notes |
|---|---|---|
| Rental deposit hold (manual capture) | `createRentalPaymentHold` (~line 1279) | authorization, up to 7 days |
| Refundable deposit (charged up front) | ~line 1412 | refunded after return |
| Rental charge | ~line 1592 | captured immediately, separate PaymentIntent |
| Borrow deposit hold | `create-deposit-hold` (~line 8351) | authorization |
| Platform fee | ~line 8438 | $0.50 minimum is written in USD cents |

Already CAD: the private-courier fee (~line 11340), payout transfers (`rental-payout-service.ts`), Connect accounts.
Follows the old charge: `deposit-renewal-service.ts` renews a hold with `currency: oldPaymentIntent.currency`.
`request_refunds.currency` defaults to `'usd'`. Subscriptions use whatever currency their Stripe Price has.

## Decision first: what does a dollar mean?

Item values, deposits and rental rates are plain numbers in the database and the apps show a bare `$`
(`formatCurrency` is `$${amount}`). The simplest migration treats those numbers as already being Canadian dollars
(a 1:1 relabel). That is a real price change for anyone who thought $50 meant US$50, so confirm with the business
before starting. If numbers must be converted, add a conversion step to every amount below; the rest of the plan is
the same.

## 1. Stripe account and balance (do before any code)

- Confirm in the Stripe dashboard the platform account's country and **default settlement currency**. A Canadian
  account settles CAD; a USD charge is either held as a USD balance (if USD is enabled for the account) or converted,
  with a conversion fee.
- Check **available balance per currency**. A transfer in CAD needs CAD available. Today captured USD money does not
  fund CAD transfers, which would explain `balance_insufficient` on payouts. After the move, new charges fund CAD
  transfers directly; the existing USD balance has to be converted (Stripe dashboard) or left to pay out USD refunds.
- Keep USD balance enabled until every USD charge has been refunded, captured or expired (see in-flight below).
- Check the Connect connected accounts: Express accounts in `CA` pay out in CAD, so no change there.
- Subscriptions: confirm the Price objects' currency; create CAD prices if they are USD, and decide what happens to
  current subscribers (new price on next renewal, or leave them).
- Statement descriptors, receipts and Radar rules are currency-neutral, but check any Stripe Tax setup.

## 2. In-flight requests created in USD

A PaymentIntent keeps its currency for life, and a refund must be in the same currency as the charge. So:

- **Never rewrite an existing PaymentIntent.** Every request keeps working in USD until it finishes: capture,
  claim settlement, refunds and cancels already read the currency from Stripe or use the intent's own id.
- **Audit the code that assumes a currency.** Anything that creates a new Stripe object for an old request must copy
  the old currency: renewal already does (`oldPaymentIntent.currency`); claim settlement refunds the existing intent;
  but `request_refunds.currency` is recorded with a default and should be set from the intent.
- **Cutover rule:** requests whose deposit/rental PaymentIntent was created before the deploy are "legacy USD". Add a
  `currency` column on `item_requests` (default `'usd'` for existing rows, `'cad'` for new ones) so any later code can
  pick the right one, instead of guessing from creation time.
- **Holds expire in 7 days and deposit renewals re-create them.** A renewal of a legacy hold would stay USD. Decide
  whether to let it, or to force a CAD renewal after cutover (customer sees a second authorization).
- Pre-cutover cleanup: query for requests in `ACCEPTED` / `DEPOSIT_CONFIRMED` / `IN_PROGRESS` with a USD intent. A
  feature-flagged cutover (new charges CAD from time T) lets the flight drain without a big-bang.

## 3. Existing wallet balances

`users.rental_balance` and `pending_rental_balance` hold bare numbers earned from USD charges.

- Under the 1:1 relabel decision they simply become CAD, and payouts (already CAD) now match. Because the platform
  has been paid in USD for those, **finance should confirm the USD balance converts to enough CAD** to cover them.
- Under a conversion decision, run a one-time migration: multiply `rental_balance`, `pending_rental_balance` and the
  open `held` rows by the agreed rate, writing an audit row per user, in one transaction with a rollback script.
- Either way, record the currency on whatever ledger holds balances (see `owner-claim-payout.md`, which already asks
  for a `currency` on each wallet transaction) so mixed history is explicit.
- Payouts in flight (`pending_payout`, `manual_review`) were sent as CAD already; leave them.

## 4. Code changes

- One constant, e.g. `CHARGE_CURRENCY = "cad"`, used by all five sites and the courier fee, the payout transfer and
  `request_refunds`. No literal `"usd"` or `"cad"` left in `routes.ts`.
- Read currency from the Stripe object wherever money is refunded, captured or recorded; never assume it.
- Replace `Math.max(50, ...)` for the platform fee with the CAD minimum charge from Stripe (CA$0.50).
- The AI valuation prompts say "in USD" (`estimatedValue`); decide whether item values should be asked for in CAD.
- Add `item_requests.currency` as above, with a migration that stamps existing rows `usd`.

## 5. UI price display

- The apps format money with a bare `$` (`formatCurrency` and inline `$${n}`), so no number changes by itself.
- Add a single money formatter per app (web `formatCurrency`, mobile `formatMoney`) that uses `Intl.NumberFormat`
  with `en-CA` / `CAD`, and route inline `$` strings through it. Show "CA$" or "$" plus "CAD" at checkout and on
  receipts, and say CAD in the deposit and payout copy, so a US-based user is not surprised.
- Update terms/FAQ text that quotes dollar amounts or says USD.
- Server-built strings (`deposit-copy.ts` `formatMoney`, notifications, chat stamps) use the same helper.
- Legacy USD requests keep showing their amounts with a "USD" suffix until they end.

## 6. Tests

- Change the fakes and fixtures that assume `usd`: `test-fixtures/fake-stripe.ts` and the API tests that assert it
  (`deposit-authorization`, `rental-deposit-charge-split`, plus the refund and cancel record tests).
- New tests: every charge creator passes the shared currency; a request created before cutover still refunds, captures
  and settles a claim in USD; renewal of a USD hold stays USD (or is re-created in CAD, per the decision);
  `request_refunds.currency` matches the intent; payouts and charges use the same currency constant; a grep-style test
  that fails if a currency literal appears in `routes.ts`.
- Web and mobile: formatter unit tests (en-CA, cents, large numbers), and the existing copy tests updated.
- Staging dry run in Stripe test mode: one rental, one borrow with a claim, one payout, one subscription, one legacy
  USD request completed after cutover.

## Rollout order

1. Decide 1:1 versus conversion; check Stripe account, balances and Prices (section 1).
2. Ship `item_requests.currency` and the shared constant, still creating USD (no behavior change).
3. Ship the formatter and CAD labels in both apps.
4. Flip new charges to CAD behind a flag; watch payouts, refunds and renewals.
5. Run the wallet migration if converting; let legacy USD requests drain; then remove the USD balance and flag.
