import { and, eq, gte, inArray } from "drizzle-orm";
import { db, itemRequests, items, notifications, requestLifecycleEvents, users } from "@workspace/db";
import { calcBorrowShareCoinCost } from "./handoff-deadline-service";
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

const TIER_SHARECOINS: Record<number, number> = { 1: 5, 2: 10, 3: 20, 4: 40 };
/** What one item is worth in ShareCoins by tier (mirrors the apps' getTierShareCoins; an unset tier counts as tier 2). */
export function tierShareCoins(tier: number | null | undefined): number {
  return TIER_SHARECOINS[tier ?? 2] ?? 10;
}

type Executor = typeof db;

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

/** The whole ShareCoins a person can spend now. */
export async function spendableBalance(userId: number, exec: Executor = db): Promise<number> {
  const [row] = await exec.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId)).limit(1);
  return Math.max(0, Math.floor(parseFloat(String(row?.shareCoins ?? "0")) || 0));
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
    case "actor_short":
      // The person who would pay: told plainly, about their own balance only (the apps open the Not Enough ShareCoins modal).
      return {
        status: 402,
        body: {
          code: INSUFFICIENT_SHARECOINS_CODE,
          error: `You need ${gate.required} ShareCoins but only have ${gate.available}.`,
          required: gate.required,
          available: gate.available,
          currentBalance: gate.available,
        },
      };
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
  const quote = await quoteRequest(quoteInputFromRows(request, item, overrides));
  return applyFundsGate({
    actorId, quote, mode,
    context: { requestId: request.id, itemId: item.id, itemName: item.name, ownerId: item.ownerId!, requesterId: request.requesterId! },
  });
}
