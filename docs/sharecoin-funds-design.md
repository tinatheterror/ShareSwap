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

## Pending-request clean-up

Pending requests do not expire (to be revisited after launch), so these rules keep them from piling up or holding a slot forever:

- **Free-plan borrow limit is counted at accept, not at send.** `acceptWithFunds` takes the slot in the same transaction as the hold (the requester's row is locked, a window older than 30 days starts again, an unanswered or declined request never uses one up). Sending only refuses a borrow when the month is already used up (it could never be accepted); it counts nothing. A Free-plan member can have at most 3 pending borrow requests at once (`PENDING_BORROW_LIMIT`, 403, "You already have 3 borrow requests waiting for an answer…"); Member and above have neither limit (`borrow-allowance.ts`).
- **Accepting past the monthly limit is refused.** The requester (when they are the one accepting a counter) gets `BORROW_LIMIT_REACHED` and the apps' plan-limit answer with an Upgrade action; when the owner accepts, the owner gets only the neutral "This can't be accepted right now.", and the requester gets one private notification (`borrow_limit_reached`, per window, opening the plan page).
- **A completed gift or swap declines the other pending requests for the items involved** (the listed item and, for a swap, every item on either side, plus swaps that offered one of them) with the notice "This item is no longer available." (notification, thread line, push); this runs at every completion path (both people confirming, the code, the sweep). Accepting a request for an item that has already been given away or swapped is refused (`ITEM_NO_LONGER_AVAILABLE`, 409) (`item-availability.ts`).
- **One pending request per person per item**, whatever the type (`DUPLICATE_PENDING_REQUEST`, 409), checked again under an advisory lock on (item, requester) so two taps at once create one.
- **Passed start dates**: a pending borrow or rental whose start day has passed shows the owner "Dates have passed. Counter with new dates or decline." in place of Accept (the server refuses the accept as well).

## Disputes, admin decisions and the hold table (follow-ups to Phase 2)

- **Disputes after an auto-confirm.** A borrow or rental the sweep auto-confirmed can be disputed by either person for **24 hours** after the auto-confirm (`AUTO_CONFIRM_DISPUTE_WINDOW_HOURS`, handoff-confirm-copy.ts); later, `deny-handoff` answers 409 `DISPUTE_WINDOW_CLOSED`. A borrow's ShareCoins are **not** charged at auto-confirm: the hold stays for the window and `settleElapsedAutoConfirmedBorrows` (run every minute by the `sharecoin-funds-recheck` job) settles it when the window closes. A disputed borrow is left alone until an admin decides it. A swap or gift cannot be disputed after it completes, so its coins settle at completion as before.
- **Admin queue.** `GET /api/admin/handoff-disputes` (web: Admin → Handoff disputes) lists disputes (`HANDOFF_DISPUTED`) and flagged exchanges (`HANDOFF_FLAGGED`), oldest first, with both people's messages, any proof and the ShareCoins held. `POST /api/admin/handoff-disputes/:id/resolve` with `owner` (the handoff stands: the hold settles as `dispute_settled`; a borrow/rental goes on, a swap/gift is completed, its items marked and the other requests for them declined) or `borrower`/`requester` (it did not happen: payments refunded, deposit released, the exchange cancelled and the hold released as `dispute_released`, or `flag_rejected` for a flagged exchange). Both people are notified. A swap or gift completed by an admin gets no first-swap/gift bonus or trust points.
- **Monthly slot.** Releasing a borrow's hold (cancel, deposit timeout, expiry, declined terms, a dispute decided for the borrower, account deletion) gives the Free-plan monthly slot back, once, if it was counted in the window now running.
- **Hold table.** `sharecoin_holds.request_id` is `ON DELETE RESTRICT`: a request with a hold cannot be deleted (delete the hold first). 0034 creates it that way; 0035 converts an older CASCADE table at startup.

## Phase 3 — clean-up

Remove the old per-site checks and the clamping in the borrow charge once holds settle them.
