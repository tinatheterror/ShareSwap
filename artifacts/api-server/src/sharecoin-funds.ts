import { and, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db, itemRequests, items, notifications, requestLifecycleEvents, shareCoinHolds, shareCoinsTransactions, users } from "@workspace/db";
import type { SHARECOIN_HOLD_RELEASE_REASONS, SHARECOIN_HOLD_SETTLE_REASONS } from "@workspace/db";
import { borrowLimitBody, BORROW_LIMIT_MESSAGE, monthlyBorrowSlotAvailable, takeMonthlyBorrowSlot } from "./borrow-allowance";
import { sendPushToUser } from "./push-notifications";

// The one place that decides what a ShareCoin action costs, who pays it and whether they can. Every gate (sending a
// request or counter, accepting one) goes through applyFundsGate; nothing else does its own balance arithmetic.
// Design and rules: docs/sharecoin-funds-design.md.
//
//   - BORROW: the requester pays the prorated price. SWAP: the side whose items are worth fewer ShareCoins pays the
//     difference. RENT and GIFT involve no ShareCoins.
//   - The person who would pay is told plainly when they cannot afford it (402 INSUFFICIENT_SHARECOINS, the modal).
//   - Nobody else is ever told: if the OTHER person is the payer and is short, the person accepting gets one neutral
//     answer, the payer gets a private nudge, and the accepter is told (with no reason) once the payer can afford it.

/** The largest ShareCoin difference a swap may have (the apps' limit). */
export const MAX_SWAP_OFFSET_SC = 20;

export const INSUFFICIENT_SHARECOINS_CODE = "INSUFFICIENT_SHARECOINS";
export const SWAP_OFFSET_TOO_LARGE_CODE = "SWAP_OFFSET_TOO_LARGE";
/** What whoever is blocked by someone else's balance sees. It must never say why. */
export const REQUEST_NOT_ACCEPTABLE_NOW_CODE = "REQUEST_NOT_ACCEPTABLE_NOW";
export const REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE = "This can't be accepted right now. Please try again later.";

export const FUNDS_BLOCKED_EVENT = "FUNDS_BLOCKED";
export const FUNDS_UNBLOCKED_EVENT = "FUNDS_UNBLOCKED";
export const FUNDS_NEEDED_NOTIFICATION = "sharecoin_needed";
export const REQUEST_ACCEPTABLE_NOTIFICATION = "request_acceptable";

// ShareCoin borrow cost, in whole ShareCoins (the one rounding every gate, hold, deposit step and handoff shares). End date = return day (not last usage day), so usage days
// = end - start (no +1). Formula: round( (weeklyPrice / 7) × days ).
// e.g. 10 SC/week item, start=Mon, return=Fri → 4 usage days → round(10/7 × 4) = 6 SC
export function calcBorrowShareCoinCost(
  shareCoinPrice: number,
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined,
): number {
  if (!startDate || !endDate || shareCoinPrice <= 0) return Math.max(1, Math.round(shareCoinPrice));
  const start = new Date(startDate);
  const end = new Date(endDate);
  const borrowDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  return Math.max(1, Math.round((shareCoinPrice / 7) * borrowDays));
}

const TIER_SHARECOINS: Record<number, number> = { 1: 5, 2: 10, 3: 20, 4: 40 };
/** What one item is worth in ShareCoins by tier (mirrors the apps' getTierShareCoins; an unset tier counts as tier 2). */
export function tierShareCoins(tier: number | null | undefined): number {
  return TIER_SHARECOINS[tier ?? 2] ?? 10;
}

export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface QuoteInput {
  requestType: string | null;
  requesterId: number;
  ownerId: number;
  /** The listed item. */
  itemId: number;
  shareCoinPrice?: string | number | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  counterStartDate?: Date | string | null;
  counterEndDate?: Date | string | null;
  swapOfferedItemIds?: number[] | null;
  /** Extra items of the owner's that the requester asked for besides the listed one. */
  swapRequestedItemIds?: number[] | null;
  counterSwapOwnerItemIds?: number[] | null;
  counterSwapRequesterItemIds?: number[] | null;
}

export interface FundsQuote {
  kind: "BORROW" | "SWAP";
  payerId: number;
  receiverId: number;
  amount: number;
}

/** The items on each side of a swap: a counter replaces a side, otherwise the listed item (plus any extras asked for) and what was offered. */
export function swapSides(input: QuoteInput): { ownerItemIds: number[]; requesterItemIds: number[] } {
  const ownerItemIds = input.counterSwapOwnerItemIds?.length
    ? [...input.counterSwapOwnerItemIds]
    : [input.itemId, ...(input.swapRequestedItemIds ?? [])];
  const requesterItemIds = input.counterSwapRequesterItemIds?.length
    ? [...input.counterSwapRequesterItemIds]
    : [...(input.swapOfferedItemIds ?? [])];
  return {
    ownerItemIds: [...new Set(ownerItemIds.filter((id) => typeof id === "number"))],
    requesterItemIds: [...new Set(requesterItemIds.filter((id) => typeof id === "number"))],
  };
}

/** What a swap costs: who pays and how much, or null when nothing changes hands. */
export async function quoteSwap(input: QuoteInput, exec: Executor = db): Promise<FundsQuote | null> {
  const { ownerItemIds, requesterItemIds } = swapSides(input);
  if (ownerItemIds.length === 0 || requesterItemIds.length === 0) return null;
  const rows = await exec.select({ id: items.id, tier: items.tier }).from(items).where(inArray(items.id, [...new Set([...ownerItemIds, ...requesterItemIds])]));
  const tiers = new Map(rows.map((row) => [row.id, row.tier]));
  const ownerSC = ownerItemIds.reduce((sum, id) => sum + tierShareCoins(tiers.get(id)), 0);
  const requesterSC = requesterItemIds.reduce((sum, id) => sum + tierShareCoins(tiers.get(id)), 0);
  const amount = Math.abs(ownerSC - requesterSC);
  if (amount === 0) return null;
  const ownerPays = ownerSC < requesterSC;
  return {
    kind: "SWAP",
    payerId: ownerPays ? input.ownerId : input.requesterId,
    receiverId: ownerPays ? input.requesterId : input.ownerId,
    amount,
  };
}

/** What a request costs in ShareCoins, or null when it involves none. Uses the same formula as the handoff charge. */
export async function quoteRequest(input: QuoteInput, exec: Executor = db): Promise<FundsQuote | null> {
  if (input.requestType === "BORROW") {
    const amount = calcBorrowShareCoinCost(
      parseFloat(String(input.shareCoinPrice ?? "0")) || 0,
      input.counterStartDate || input.startDate,
      input.counterEndDate || input.endDate,
    );
    return { kind: "BORROW", payerId: input.requesterId, receiverId: input.ownerId, amount };
  }
  if (input.requestType === "SWAP") return quoteSwap(input, exec);
  return null;
}

/** Requests in these statuses can never settle, so a hold on one reserves nothing even before it is released. */
const ENDED_REQUEST_STATUSES = ["CANCELLED", "DECLINED", "EXPIRED", "REJECTED", "DEPOSIT_FAILED"] as const;

/** A person's whole ShareCoins, holds not subtracted. */
export async function totalBalance(userId: number, exec: Executor = db): Promise<number> {
  const [row] = await exec.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId)).limit(1);
  return Math.max(0, Math.floor(parseFloat(String(row?.shareCoins ?? "0")) || 0));
}

/** What a person has reserved for accepted borrows and swaps that have not been settled or released yet. */
export async function reservedBalance(userId: number, exec: Executor = db): Promise<number> {
  const [row] = await exec
    .select({ total: sql<number>`COALESCE(SUM(${shareCoinHolds.amount}), 0)::int` })
    .from(shareCoinHolds)
    .innerJoin(itemRequests, eq(itemRequests.id, shareCoinHolds.requestId))
    .where(and(eq(shareCoinHolds.payerId, userId), eq(shareCoinHolds.status, "ACTIVE"), notInArray(itemRequests.status, [...ENDED_REQUEST_STATUSES])));
  return Number(row?.total ?? 0);
}

/** The whole ShareCoins a person can spend now: their balance minus what is held for accepted requests. Every spend checks this. */
export async function spendableBalance(userId: number, exec: Executor = db): Promise<number> {
  return Math.max(0, (await totalBalance(userId, exec)) - (await reservedBalance(userId, exec)));
}

export type FundsGate =
  | { kind: "clear" }
  | { kind: "offset_too_large"; offset: number }
  | { kind: "actor_short"; required: number; available: number }
  | { kind: "other_short"; quote: FundsQuote; required: number; available: number };

export async function evaluateFunds(actorId: number, quote: FundsQuote | null, exec: Executor = db): Promise<FundsGate> {
  if (!quote) return { kind: "clear" };
  if (quote.kind === "SWAP" && quote.amount > MAX_SWAP_OFFSET_SC) return { kind: "offset_too_large", offset: quote.amount };
  const available = await spendableBalance(quote.payerId, exec);
  if (available >= quote.amount) return { kind: "clear" };
  return quote.payerId === actorId
    ? { kind: "actor_short", required: quote.amount, available }
    : { kind: "other_short", quote, required: quote.amount, available };
}

export interface FundsRequestContext {
  requestId: number;
  itemId: number;
  itemName: string;
  ownerId: number;
  requesterId: number;
}

type RequestRow = typeof itemRequests.$inferSelect;
type ItemRow = typeof items.$inferSelect;

/** The quote input for a stored request and its listed item; `overrides` are the terms a counter is about to set. */
export function quoteInputFromRows(request: RequestRow, item: ItemRow, overrides: Partial<QuoteInput> = {}): QuoteInput {
  return {
    requestType: request.requestType, requesterId: request.requesterId!, ownerId: item.ownerId!, itemId: item.id,
    shareCoinPrice: item.shareCoinPrice, startDate: request.startDate, endDate: request.endDate,
    counterStartDate: request.counterStartDate, counterEndDate: request.counterEndDate,
    swapOfferedItemIds: request.swapOfferedItemIds as number[] | null, swapRequestedItemIds: request.swapRequestedItemIds as number[] | null,
    counterSwapOwnerItemIds: request.counterSwapOwnerItemIds as number[] | null, counterSwapRequesterItemIds: request.counterSwapRequesterItemIds as number[] | null,
    ...overrides,
  };
}

export interface FundsBlock {
  status: number;
  body: Record<string, unknown>;
}

const short = (name: string, max: number) => (name.length > max ? `${name.slice(0, max)}…` : name);

/**
 * The gate every request, counter and accept goes through. Returns the response to send when the action is blocked,
 * or null when it may go ahead.
 *
 *   send   (a request, a counter): only the person who would pay is checked; if the other person would pay the send is
 *          allowed and their balance is never looked at by, or shown to, the sender.
 *   accept: the payer is checked whoever is accepting; if it is the other person who is short, the accepter gets the
 *          neutral answer and the payer a private nudge.
 *
 * A swap whose difference is over the maximum is refused in both modes (that is about the items, not anyone's balance).
 */
export async function applyFundsGate(args: {
  actorId: number;
  quote: FundsQuote | null;
  mode: "send" | "accept";
  /** Needed to nudge the payer and to remember the block (accept mode). */
  context?: FundsRequestContext;
}, exec: Executor = db): Promise<FundsBlock | null> {
  const gate = await evaluateFunds(args.actorId, args.quote, exec);
  switch (gate.kind) {
    case "clear":
      return null;
    case "offset_too_large":
      return {
        status: 400,
        body: {
          code: SWAP_OFFSET_TOO_LARGE_CODE,
          error: `The ShareCoin difference between these items is ${gate.offset}, more than the ${MAX_SWAP_OFFSET_SC} allowed. Choose items closer in value.`,
          offset: gate.offset,
          maxOffset: MAX_SWAP_OFFSET_SC,
        },
      };
    case "actor_short": {
      // The person who would pay: told plainly, about their own balance only (the apps open the Not Enough ShareCoins modal).
      // `available` is what they can spend now; `reserved` is what their accepted requests have set aside (also theirs alone).
      const reserved = await reservedBalance(args.actorId, exec);
      return {
        status: 402,
        body: {
          code: INSUFFICIENT_SHARECOINS_CODE,
          error: `You need ${gate.required} ShareCoins but only have ${gate.available} available${reserved > 0 ? ` (${reserved} are reserved for accepted requests)` : ""}.`,
          required: gate.required,
          available: gate.available,
          reserved,
          currentBalance: gate.available,
        },
      };
    }
    case "other_short":
      if (args.mode === "send") return null;
      if (args.context) {
        try {
          await recordFundsBlock({ blockedUserId: args.actorId, quote: gate.quote, context: args.context }, exec);
        } catch (error) {
          console.error("[sharecoin-funds] could not record the block or nudge the payer:", error);
        }
      }
      return { status: 409, body: { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE } };
  }
}

/**
 * Remembers that `blockedUserId` could not accept because the payer was short, and tells the payer, once per block:
 * "You need N ShareCoins to continue with [item]". The block is a lifecycle event (the recheck sweep reads it); a
 * repeat attempt while it is still open changes nothing.
 */
export async function recordFundsBlock(
  args: { blockedUserId: number; quote: FundsQuote; context: FundsRequestContext },
  exec: Executor = db,
): Promise<boolean> {
  const { blockedUserId, quote, context } = args;
  const earlier = await exec
    .select({ id: requestLifecycleEvents.id })
    .from(requestLifecycleEvents)
    .where(and(
      eq(requestLifecycleEvents.requestId, context.requestId),
      eq(requestLifecycleEvents.eventType, FUNDS_UNBLOCKED_EVENT),
      eq(requestLifecycleEvents.actorId, blockedUserId),
    ));
  const key = `funds-blocked:${context.requestId}:${blockedUserId}:${quote.payerId}:${quote.amount}:${earlier.length}`;
  const claimed = await exec
    .insert(requestLifecycleEvents)
    .values({
      requestId: context.requestId, eventType: FUNDS_BLOCKED_EVENT, actorId: blockedUserId, idempotencyKey: key,
      details: { payerId: quote.payerId, amount: quote.amount },
    })
    .onConflictDoNothing()
    .returning({ id: requestLifecycleEvents.id });
  if (claimed.length === 0) return false;

  const title = "More ShareCoins needed";
  const message = `You need ${quote.amount} ShareCoins to continue with "${short(context.itemName, 30)}".`;
  await exec.insert(notifications).values({
    userId: quote.payerId, type: FUNDS_NEEDED_NOTIFICATION, title, message, itemId: context.itemId, requestId: context.requestId, isRead: false,
  } as any);
  await Promise.resolve(
    sendPushToUser(quote.payerId, { title, body: message, data: { screen: "chat", chatUserId: blockedUserId, requestId: context.requestId, itemId: context.itemId } }, "requests"),
  ).catch(() => {});
  return true;
}

/**
 * Tells each blocked person, once, that the request can now be accepted: when the payer can afford it again, or when
 * the request no longer needs ShareCoins. The text carries no amount, no role and no reason. A block whose request is
 * no longer pending is closed without a notice. Returns how many notices were sent.
 */
export async function notifyUnblockedRequests(options: { now?: Date; exec?: Executor } = {}): Promise<number> {
  const exec = options.exec ?? db;
  const since = new Date((options.now ?? new Date()).getTime() - 14 * 24 * 3_600_000);
  const blocks = await exec
    .select()
    .from(requestLifecycleEvents)
    .where(and(eq(requestLifecycleEvents.eventType, FUNDS_BLOCKED_EVENT), gte(requestLifecycleEvents.createdAt, since)))
    .limit(500);
  if (blocks.length === 0) return 0;

  const resolvedKey = (blockId: number) => `funds-resolved:${blockId}`;
  const resolved = new Set(
    (await exec.select({ key: requestLifecycleEvents.idempotencyKey }).from(requestLifecycleEvents).where(inArray(requestLifecycleEvents.idempotencyKey, blocks.map((b) => resolvedKey(b.id))))).map((r) => r.key),
  );

  let sent = 0;
  for (const block of blocks) {
    if (resolved.has(resolvedKey(block.id)) || block.actorId === null) continue;
    const [row] = await exec
      .select()
      .from(itemRequests)
      .innerJoin(items, eq(items.id, itemRequests.itemId))
      .where(eq(itemRequests.id, block.requestId))
      .limit(1);
    const close = async (notify: boolean) => {
      const claimed = await exec
        .insert(requestLifecycleEvents)
        .values({ requestId: block.requestId, eventType: FUNDS_UNBLOCKED_EVENT, actorId: block.actorId, idempotencyKey: resolvedKey(block.id), details: { notified: notify } })
        .onConflictDoNothing()
        .returning({ id: requestLifecycleEvents.id });
      return claimed.length > 0;
    };
    if (!row || row.item_requests.status !== "PENDING") {
      await close(false);
      continue;
    }
    const request = row.item_requests;
    const quote = await quoteRequest(quoteInputFromRows(request, row.items), exec);
    const gate = await evaluateFunds(block.actorId, quote, exec);
    // Still short, or the items are now too far apart (a different problem, not this notice's to announce): leave it open.
    if (gate.kind === "other_short" || gate.kind === "actor_short" || gate.kind === "offset_too_large") continue;
    if (!(await close(true))) continue;

    const title = "Ready to accept";
    const message = `You can now accept the request for "${short(row.items.name, 30)}".`;
    await exec.insert(notifications).values({
      userId: block.actorId, type: REQUEST_ACCEPTABLE_NOTIFICATION, title, message, itemId: row.items.id, requestId: request.id, isRead: false,
    } as any);
    await Promise.resolve(
      sendPushToUser(block.actorId, { title, body: message, data: { screen: "chat", requestId: request.id, itemId: row.items.id } }, "requests"),
    ).catch(() => {});
    sent++;
  }
  return sent;
}

/** Gates a stored request (and the terms a counter is about to set, as `overrides`) for `actorId`. Null means go ahead. */
export async function gateRequestFunds(
  actorId: number,
  mode: "send" | "accept",
  request: RequestRow,
  item: ItemRow,
  overrides: Partial<QuoteInput> = {},
): Promise<FundsBlock | null> {
  // A request that already holds its coins is not checked against them a second time (its own hold is not "spent").
  if (mode === "accept" && request.status !== "PENDING" && (await hasActiveHold(request.id))) return null;
  const quote = await quoteRequest(quoteInputFromRows(request, item, overrides));
  return applyFundsGate({
    actorId, quote, mode,
    context: { requestId: request.id, itemId: item.id, itemName: item.name, ownerId: item.ownerId!, requesterId: request.requesterId! },
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Holds (Phase 2). Accepting reserves what the payer will owe, in the same transaction that accepts, under a lock on the
// payer's row, so two accepts that together need more than the payer has cannot both succeed. The handoff settles the hold
// (the coins move, exactly the quoted amount); every other way the request can end releases it.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type HoldRow = typeof shareCoinHolds.$inferSelect;
export type HoldSettleReason = (typeof SHARECOIN_HOLD_SETTLE_REASONS)[number];
export type HoldReleaseReason = (typeof SHARECOIN_HOLD_RELEASE_REASONS)[number];

/** The statuses from which a request can still end in a coin transfer (the hold exists until the handoff settles it). */
export const PRE_SETTLEMENT_STATUSES = ["ACCEPTED", "DEPOSIT_CONFIRMED", "HANDOFF_CONFIRMED", "AWAITING_HANDOFF_CONFIRM", "HANDOFF_DISPUTED", "HANDOFF_FLAGGED"] as const;

export async function activeHoldFor(requestId: number, exec: Executor = db): Promise<HoldRow | null> {
  const [hold] = await exec.select().from(shareCoinHolds).where(and(eq(shareCoinHolds.requestId, requestId), eq(shareCoinHolds.status, "ACTIVE"))).limit(1);
  return hold ?? null;
}

export async function hasActiveHold(requestId: number, exec: Executor = db): Promise<boolean> {
  return (await activeHoldFor(requestId, exec)) !== null;
}

export type PlaceHoldResult = { ok: true; hold: HoldRow | null } | { ok: false; required: number; available: number };

/**
 * Reserves `quote.amount` of the payer's spendable balance for the request. Call it inside the accepting transaction: it
 * locks the payer's users row (SELECT ... FOR UPDATE) BEFORE it computes the spendable balance and inserts the hold, so a
 * second transaction for the same payer waits for the first and then sees its hold. A request that already holds its coins
 * keeps that hold. A quote of nothing places nothing.
 */
export async function placeHold(tx: Executor, requestId: number, quote: FundsQuote | null): Promise<PlaceHoldResult> {
  if (!quote || quote.amount <= 0) return { ok: true, hold: null };
  await tx.select({ id: users.id }).from(users).where(eq(users.id, quote.payerId)).for("update");
  const existing = await activeHoldFor(requestId, tx);
  if (existing) return { ok: true, hold: existing };
  const available = await spendableBalance(quote.payerId, tx);
  if (available < quote.amount) return { ok: false, required: quote.amount, available };
  const [hold] = await tx
    .insert(shareCoinHolds)
    .values({ requestId, payerId: quote.payerId, receiverId: quote.receiverId, kind: quote.kind, amount: quote.amount })
    .returning();
  return { ok: true, hold };
}

/** Frees a request's hold (whoever's it is) for the stated reason. Returns whether there was one. Safe to repeat. */
export async function releaseHold(exec: Executor, requestId: number, reason: HoldReleaseReason): Promise<boolean> {
  const rows = await exec
    .update(shareCoinHolds)
    .set({ status: "RELEASED", reason, resolvedAt: new Date() })
    .where(and(eq(shareCoinHolds.requestId, requestId), eq(shareCoinHolds.status, "ACTIVE")))
    .returning({ id: shareCoinHolds.id });
  return rows.length > 0;
}

/** Releases every ACTIVE hold of a person (they are the payer) and of the requests given, for an account deletion. */
export async function releaseHoldsForDeletion(exec: Executor, userId: number, requestIds: number[]): Promise<number> {
  const rows = await exec.execute(sql`
    UPDATE sharecoin_holds SET status = 'RELEASED', reason = 'account_deleted', resolved_at = now()
    WHERE status = 'ACTIVE' AND (payer_id = ${userId} OR receiver_id = ${userId}${requestIds.length > 0 ? sql` OR request_id IN (${sql.join(requestIds.map((id) => sql`${id}`), sql`, `)})` : sql``})
    RETURNING id`);
  return rows.rows.length;
}

/**
 * Safety net: releases the ACTIVE hold of any request that ended (cancelled, expired, declined, ...) without anything
 * releasing it. Every ending releases its own hold; this only catches a path that does not, and spendable balance already
 * ignores such holds, so nothing is ever kept reserved for a request that is over.
 */
export async function releaseHoldsOfEndedRequests(exec: Executor = db): Promise<number> {
  const rows = await exec.execute(sql`
    UPDATE sharecoin_holds h SET status = 'RELEASED',
      reason = CASE r.status WHEN 'CANCELLED' THEN 'cancelled' WHEN 'EXPIRED' THEN 'expired' ELSE 'request_ended' END,
      resolved_at = now()
    FROM item_requests r
    WHERE r.id = h.request_id AND h.status = 'ACTIVE'
      AND r.status IN (${sql.join(ENDED_REQUEST_STATUSES.map((s) => sql`${s}`), sql`, `)})
    RETURNING h.id`);
  return rows.rows.length;
}

export interface SettleResult {
  /** True when a hold (or the legacy fallback quote) moved coins. */
  settled: boolean;
  /** What actually moved. */
  paid: number;
  kind: "BORROW" | "SWAP" | null;
  payerId: number | null;
  receiverId: number | null;
}

const NOT_SETTLED: SettleResult = { settled: false, paid: 0, kind: null, payerId: null, receiverId: null };

async function moveCoins(
  tx: Executor,
  m: { payerId: number; receiverId: number; kind: "BORROW" | "SWAP"; amount: number; itemName: string; suffix: string },
): Promise<number> {
  // All or nothing: a conditional debit that returns the row only if the payer had it. The receiver gets exactly what was debited.
  let paid = m.amount;
  const debit = await tx
    .update(users)
    .set({ shareCoins: sql`${users.shareCoins} - ${m.amount}` })
    .where(and(eq(users.id, m.payerId), sql`${users.shareCoins} >= ${m.amount}`))
    .returning({ id: users.id });
  if (debit.length === 0) {
    // The hold was meant to make this impossible. If a balance was lowered some other way, take what is there (never below
    // zero, never more than owed) and say so loudly rather than fail a handoff that already happened.
    const [row] = await tx.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, m.payerId)).for("update");
    paid = Math.min(m.amount, Math.max(0, Math.floor(parseFloat(String(row?.shareCoins ?? "0")) || 0)));
    console.error(`[sharecoin-funds] payer ${m.payerId} could not cover ${m.amount} SC at settlement; collected ${paid}`);
    if (paid > 0) await tx.update(users).set({ shareCoins: sql`${users.shareCoins} - ${paid}` }).where(eq(users.id, m.payerId));
  }
  if (paid <= 0) return 0;
  await tx.update(users).set({ shareCoins: sql`${users.shareCoins} + ${paid}` }).where(eq(users.id, m.receiverId));
  const label = m.kind === "BORROW"
    ? { payer: `Borrowed: ${m.itemName}${m.suffix}`, payerType: "BORROW_CHARGE", receiver: `Lent: ${m.itemName}${m.suffix}`, receiverType: "LEND_REWARD" }
    : { payer: `Swap offset paid: ${m.itemName}${m.suffix}`, payerType: "SWAP_OFFSET_PAID", receiver: `Swap offset received: ${m.itemName}${m.suffix}`, receiverType: "SWAP_OFFSET_RECEIVED" };
  await tx.insert(shareCoinsTransactions).values([
    { userId: m.payerId, amount: (-paid).toString(), description: label.payer, transactionType: label.payerType },
    { userId: m.receiverId, amount: paid.toString(), description: label.receiver, transactionType: label.receiverType },
  ]);
  return paid;
}

/**
 * The handoff has happened: move the coins the request holds. Run it in a transaction (so the hold, the debit and the credit
 * stand or fall together). With a hold, exactly the held amount moves. A request that has none (it predates holds) falls back
 * to `fallbackQuote`, limited to what the payer can spend without touching what other requests hold. Safe to repeat: a
 * settled hold is not settled twice.
 */
export async function settleRequestCoins(
  tx: Executor,
  args: { requestId: number; reason: HoldSettleReason; itemName: string; fallbackQuote?: FundsQuote | null; descriptionSuffix?: string; /** Without a hold, move the whole amount or nothing (an auto-confirmed handoff never charges part of it). */ fallbackAllOrNothing?: boolean },
): Promise<SettleResult> {
  const suffix = args.descriptionSuffix ?? "";
  const [hold] = await tx
    .select()
    .from(shareCoinHolds)
    .where(and(eq(shareCoinHolds.requestId, args.requestId), eq(shareCoinHolds.status, "ACTIVE")))
    .for("update")
    .limit(1);
  if (hold) {
    const paid = await moveCoins(tx, { payerId: hold.payerId, receiverId: hold.receiverId, kind: hold.kind as "BORROW" | "SWAP", amount: hold.amount, itemName: args.itemName, suffix });
    await tx.update(shareCoinHolds).set({ status: "SETTLED", reason: args.reason, resolvedAt: new Date() }).where(eq(shareCoinHolds.id, hold.id));
    return { settled: true, paid, kind: hold.kind as "BORROW" | "SWAP", payerId: hold.payerId, receiverId: hold.receiverId };
  }
  const quote = args.fallbackQuote;
  if (!quote || quote.amount <= 0) return NOT_SETTLED;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, quote.payerId)).for("update");
  const spendable = await spendableBalance(quote.payerId, tx);
  const amount = args.fallbackAllOrNothing ? (spendable >= quote.amount ? quote.amount : 0) : Math.min(quote.amount, spendable);
  if (amount <= 0) return { ...NOT_SETTLED, kind: quote.kind, payerId: quote.payerId, receiverId: quote.receiverId };
  const paid = await moveCoins(tx, { payerId: quote.payerId, receiverId: quote.receiverId, kind: quote.kind, amount, itemName: args.itemName, suffix });
  return { settled: paid > 0, paid, kind: quote.kind, payerId: quote.payerId, receiverId: quote.receiverId };
}

export type AcceptFundsFailure = "funds" | "borrow_limit" | "changed";
export type AcceptFundsResult<T> = { ok: true; value: T; hold: HoldRow | null } | { ok: false; reason: AcceptFundsFailure };

class AcceptChanged extends Error {}

/**
 * Accepts a request with its coins reserved, atomically. In ONE transaction: take the Free plan's monthly borrow slot (a
 * borrow counts when it is accepted), reserve the payer's coins (payer row locked first), then run `commit`, which makes the
 * status change and returns its result, or null if the request is no longer in the state it was read in (nothing is kept).
 * On a refusal nothing at all was written.
 */
export async function acceptWithFunds<T>(args: {
  request: RequestRow;
  item: ItemRow;
  commit: (tx: Executor) => Promise<T | null>;
  now?: Date;
  /** Count a Free-plan borrow against the monthly allowance at this accept (see borrow-allowance.ts). */
  borrowAllowance?: boolean;
}): Promise<AcceptFundsResult<T>> {
  const { request, item } = args;
  const quote = await quoteRequest(quoteInputFromRows(request, item));
  try {
    return await db.transaction(async (tx): Promise<AcceptFundsResult<T>> => {
      const countsAgainstAllowance = args.borrowAllowance === true && request.requestType === "BORROW" && request.status === "PENDING";
      if (countsAgainstAllowance && !(await monthlyBorrowSlotAvailable(tx, request.requesterId!, args.now))) return { ok: false, reason: "borrow_limit" };
      const placed = await placeHold(tx, request.id, quote);
      if (!placed.ok) return { ok: false, reason: "funds" };
      if (countsAgainstAllowance && !(await takeMonthlyBorrowSlot(tx, request.requesterId!, args.now))) return { ok: false, reason: "borrow_limit" };
      const value = await args.commit(tx);
      if (value === null) throw new AcceptChanged();
      return { ok: true, value, hold: placed.hold };
    });
  } catch (error) {
    if (error instanceof AcceptChanged) return { ok: false, reason: "changed" };
    throw error;
  }
}

export const REQUEST_CHANGED_CODE = "REQUEST_CHANGED";
export const BORROW_LIMIT_NOTIFICATION = "borrow_limit_reached";

/**
 * The response for an accept that was refused, by whoever clicked:
 *   funds        the same gate as before (402 modal to the payer, neutral to the other person with a private nudge).
 *   borrow_limit the requester (clicking accept on a counter) gets the plan-limit answer; the owner gets only the neutral
 *                answer, and the requester is told privately, once per window, so they see the plan-limit modal.
 *   changed      someone else changed the request first.
 */
export async function acceptFailureResponse(args: {
  reason: AcceptFundsFailure;
  actorId: number;
  request: RequestRow;
  item: ItemRow;
}): Promise<FundsBlock> {
  const { reason, actorId, request, item } = args;
  if (reason === "changed") {
    return { status: 409, body: { code: REQUEST_CHANGED_CODE, error: "This request changed before it could be accepted. Please refresh and try again." } };
  }
  if (reason === "funds") {
    const block = await gateRequestFunds(actorId, "accept", request, item);
    return block ?? { status: 409, body: { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE } };
  }
  if (actorId === request.requesterId) return { status: 403, body: borrowLimitBody() };
  try {
    const [window] = await db.select({ resetAt: users.monthlyBorrowResetAt }).from(users).where(eq(users.id, request.requesterId!)).limit(1);
    const claimed = await db
      .insert(requestLifecycleEvents)
      .values({
        requestId: request.id, eventType: "BORROW_LIMIT_BLOCKED", actorId, idempotencyKey: `borrow-limit-blocked:${request.id}:${window?.resetAt?.getTime() ?? 0}`,
        details: {},
      })
      .onConflictDoNothing()
      .returning({ id: requestLifecycleEvents.id });
    if (claimed.length > 0) {
      await db.insert(notifications).values({
        userId: request.requesterId!, type: BORROW_LIMIT_NOTIFICATION, title: "Borrow limit reached", message: BORROW_LIMIT_MESSAGE,
        itemId: item.id, requestId: request.id, isRead: false,
      } as any);
      await Promise.resolve(
        sendPushToUser(request.requesterId!, { title: "Borrow limit reached", body: BORROW_LIMIT_MESSAGE, data: { screen: "chat", chatUserId: item.ownerId, requestId: request.id, itemId: item.id } }, "requests"),
      ).catch(() => {});
    }
  } catch (error) {
    console.error("[sharecoin-funds] could not tell the requester about the borrow limit:", error);
  }
  return { status: 409, body: { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE } };
}

/**
 * Run once, when the holds table is first created (test data only; see docs/sharecoin-funds-design.md): an open borrow or
 * swap that is past acceptance, owes coins and holds none cannot be honoured under the new rules, so it is cancelled and
 * both people are told. Requests that owe nothing are left alone. No Stripe call is made; the ids of any that had a card
 * deposit are returned so the owner can release those by hand.
 */
export async function cancelAcceptedRequestsWithoutHolds(exec: Executor = db): Promise<{ cancelled: number[]; withCardDeposit: number[] }> {
  const rows = await exec
    .select()
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(and(inArray(itemRequests.status, [...PRE_SETTLEMENT_STATUSES]), inArray(itemRequests.requestType, ["BORROW", "SWAP"])));
  const result = { cancelled: [] as number[], withCardDeposit: [] as number[] };
  for (const row of rows) {
    const request = row.item_requests;
    if (request.shareCoinsCharged) continue;
    if (await hasActiveHold(request.id, exec)) continue;
    const quote = await quoteRequest(quoteInputFromRows(request, row.items), exec);
    if (!quote || quote.amount <= 0) continue;
    const now = new Date();
    await exec.update(itemRequests).set({
      status: "CANCELLED", unarchivedAt: now, cancelledAt: now, cancelledFromStatus: request.status, cancelReason: "sharecoin_hold_migration",
      cancelledWithPenalty: false, cancelDepositState: request.depositPaymentIntentId ? "authorized" : "none",
    } as any).where(and(eq(itemRequests.id, request.id), eq(itemRequests.status, request.status)));
    await exec.update(items).set({ isAvailable: true, updatedAt: now }).where(eq(items.id, row.items.id));
    const message = `The request for "${short(row.items.name, 30)}" was cancelled because ShareCoins are now reserved when a request is accepted. You can send it again.`;
    await exec.insert(notifications).values([request.requesterId, row.items.ownerId].filter((id): id is number => typeof id === "number").map((userId) => ({
      userId, type: "request_cancelled", title: "Request cancelled", message, itemId: row.items.id, requestId: request.id, isRead: false,
    })) as any);
    result.cancelled.push(request.id);
    if (request.depositPaymentIntentId) result.withCardDeposit.push(request.id);
  }
  return result;
}

/**
 * The deposit step of a borrow (the card hold, or paying the deposit) needs the borrower's ShareCoins to be set aside for
 * the borrow. Normally accepting already did that; a request accepted before holds existed gets its hold now, or the
 * borrower gets the Not Enough ShareCoins answer. Uses the same quote and rounding as every other gate, never a figure the
 * client sent. Pass the surrounding transaction as `tx` when there is one. Returns the block to send, or null to go on.
 */
export async function ensureFundsHeld(
  args: { actorId: number; request: RequestRow; item: ItemRow },
  tx?: Executor,
): Promise<{ block: FundsBlock | null; amount: number }> {
  const quote = await quoteRequest(quoteInputFromRows(args.request, args.item), tx ?? db);
  if (!quote || quote.amount <= 0) return { block: null, amount: 0 };
  const placed = tx ? await placeHold(tx, args.request.id, quote) : await db.transaction((inner) => placeHold(inner, args.request.id, quote));
  if (placed.ok) return { block: null, amount: quote.amount };
  const block = await applyFundsGate({
    actorId: args.actorId, quote, mode: "accept",
    context: { requestId: args.request.id, itemId: args.item.id, itemName: args.item.name, ownerId: args.item.ownerId!, requesterId: args.request.requesterId! },
  });
  return { block: block ?? { status: 409, body: { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE } }, amount: quote.amount };
}
