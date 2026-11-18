# ShareCoin funds: checks, holds and discretion

Status: Phase 1 and Phase 2 (holds) built; the pending-request clean-up is built after them; Phase 3 not started. Decisions below were made by the owner.

## Goals

1. **Nobody is ever short paid.** A ShareCoin transfer either moves the full amount or does not happen.
2. **Funds are checked wherever ShareCoins are involved.** If the person who would pay cannot afford it, the action is blocked.
3. **The person who would pay sees the "Not Enough ShareCoins" modal** whenever they send a request or counter, or accept one.
4. **One person's balance is private from the other.** The non-payer never sees an amount, a role flag or a shortfall reason, in a response, a notification or a chat line.

## What was wrong

- The balance check was copied into about six places; accepting a swap *counter* and sending a counter had none.
- Debits clamped (`min(cost, balance)`, `GREATEST(0, …)`), so a shortfall silently became a short payment.
- Nothing was reserved: coins were checked at accept and spent at handoff days later.
- The server and both apps told the other person about a shortfall (`payerIsRequester`, "the requester needs N ShareCoins…", "Borrower needs more ShareCoins").
- The maximum swap offset (20 SC) was enforced only in the apps.

## Who pays

| Request | Payer | Amount |
|---|---|---|
| BORROW | the requester | prorated ShareCoin price for the final dates (`calcBorrowShareCoinCost`) |
| SWAP | the side whose items are worth fewer SC (tiers 5 / 10 / 20 / 40 per item) | the difference between the two sides |
| RENT, GIFT | nobody (money, or nothing) | no ShareCoins |

The payer can be either person, and it can change when a counter changes the items or dates.

## Rules

### Max swap offset
A swap whose offset is above **20 SC** is refused by the server, at every point below, with the same limit the apps show.

### Who is checked, and what they see

| Action | Payer is the actor | Payer is the other person |
|---|---|---|
| Send a request | blocked, modal | allowed (the other person's balance is never revealed) |
| Send a counter | blocked, modal | allowed |
| Accept a request or a counter | blocked, modal | blocked, **neutral** message to the accepter, **private nudge** to the payer |

- **Modal response (actor is the payer):** `402 INSUFFICIENT_SHARECOINS` with `{ required, available }`, where `available` is the actor's own spendable balance. Both apps open the existing Not Enough ShareCoins modal.
- **Neutral response (other person is the payer):** `409 REQUEST_NOT_ACCEPTABLE_NOW`, "This can't be accepted right now. Please try again later." No amount, no role, no reason.
- **Private nudge (to the payer only):** notification "You need N ShareCoins to continue with [item]", linking to the request. Sent once per block.
- **Unblock notice (to the blocked person):** when the payer can afford it again, "You can now accept the request for [item]." Sent once per block. It carries no amount and no role.
- **Never** in a response, notification, push or chat line seen by the non-payer: an amount, "payer", "requester needs", "shortfall", or any hint of whose balance is the reason.
- Residual risk: someone whose accept is blocked may infer why. The shared neutral code keeps that an inference, not a disclosure.

### One funds module
`sharecoin-funds.ts` is the only place that decides what an action costs, who pays and whether they can. Gates call it; they do not do their own arithmetic.

### Movement is all-or-nothing
Debits are conditional (`… WHERE share_coins >= n`), inside the transaction that records the transfer. No clamping. The receiver is credited exactly what the debit returned.

## Phase 1 — gates, discretion, notifications (no schema)

- `sharecoin-funds.ts`: quotes, payer, max offset, `requireFunds`, the neutral result.
- Gates at: sending a request, sending a counter, accepting directly, accepting a counter, and the existing deposit-hold checks.
- Discretion: neutral response, private nudge, unblock notice (tracked with `request_lifecycle_events`, no new table); the apps drop their `payerIsRequester` branches.
- Tests: every gate, the discretion rules (no amounts or role flags in what the non-payer sees), the max offset.

## Phase 2 — holds at accept (schema `sharecoin_holds`, 0034)

Approved with these decisions:

- **Accepting reserves.** `acceptWithFunds` (sharecoin-funds.ts) does, in ONE transaction: lock the payer's `users` row (`SELECT … FOR UPDATE`), compute spendable balance, insert the hold, make the status change. Two simultaneous accepts for one payer queue on that lock; the second sees the first's hold. Nothing is written when it is refused.
- **Spendable balance** = balance minus ACTIVE holds (a hold on a request that has already ended — cancelled, expired, declined — is not counted even before it is released). Every ShareCoin spend uses it: the send, counter and accept gates, the deposit step, the handoff's fallback for a request that has no hold, and the Persona sandbox reset's take-back.
- **kind** is `BORROW` or `SWAP`, enforced by a CHECK (with `status` and `reason`). Rentals are paid in money and borrow deposits are card authorizations, so neither holds ShareCoins; a rental accept makes no hold. At most one ACTIVE hold per request (partial unique index).
- **The quote is stored** in the hold at accept, so later tier edits or balance changes cannot change what is owed. A counter can only be made while a request is pending, before any hold exists, so there is nothing to replace: the hold is made from the final terms when the counter is accepted.
- **Settling.** The handoff (manual, PIN, auto-confirm) settles the hold in one transaction: a conditional debit of exactly the held amount, the receiver credited exactly what was debited, the hold `SETTLED`. A request from before holds (nothing held) settles the old way, limited to what the payer can spend without touching other holds (all-or-nothing for an auto-confirmed borrow).
- **Releasing.** Cancel (borrow, rent, swap), the deposit timeout, both expiry sweeps, declined terms, the test-data cleanup, a handoff dispute decided for the borrower (`dispute_released`) and account deletion (`account_deleted`, which also cancels the person's accepted requests) release the hold. A sweep (`sharecoin-funds-recheck`) releases any ended request's hold that nothing released.
- **Disputes keep the hold until resolved**: decided for the owner, the handoff stands and the hold settles (`dispute_settled`); decided for the borrower it is released. `flag_rejected` is an allowed release reason for when an admin can reject a flagged exchange (there is no such action yet; flagged exchanges keep their hold).
- **Deposit step.** `pay-deposit`, `create-deposit-hold` and the refundable-deposit confirmation no longer do their own balance arithmetic or trust a client figure: they call `ensureFundsHeld`, which uses the same quote and rounding (`calcBorrowShareCoinCost`, now in the funds module) and answers the Not Enough ShareCoins modal if the borrower cannot cover it.
- **Migration.** When the table is first created, accepted borrows and swaps that owe coins but hold none are cancelled and both people told (test data only; no Stripe call is made, and the ids of any with a card deposit are logged for a manual release).
- **Modal** gets `reserved` (the payer's own reserved figure) next to `available`.

## Phase 3 — clean-up

Remove the old per-site checks and the clamping in the borrow charge once holds settle them.
