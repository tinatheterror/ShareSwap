import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications } from "@workspace/db";
import { sendPushToUser } from "./push-notifications";
import { heldItemIds } from "./swap-reservation";

// An item that has been given away or swapped is gone. Pending requests do not expire, so when a gift or a swap completes
// every other PENDING request for the items it moved is declined (with the notice below), and nothing can be accepted
// for such an item afterwards.

export const ITEM_NO_LONGER_AVAILABLE_MESSAGE = "This item is no longer available.";
export const ITEM_NO_LONGER_AVAILABLE_CODE = "ITEM_NO_LONGER_AVAILABLE";

/** One pending request per person per item (a second one is refused until the first is answered or withdrawn). */
export const DUPLICATE_PENDING_REQUEST_CODE = "DUPLICATE_PENDING_REQUEST";
export const DUPLICATE_PENDING_REQUEST_MESSAGE = "You already have a pending request for this item. Wait for a reply, or withdraw it before sending another.";

type RequestRow = typeof itemRequests.$inferSelect;
type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The items a request is about: the listed item and, for a swap, every item on either side (offered, asked for, countered). */
export function involvedItemIds(request: Pick<RequestRow, "itemId" | "requestType" | "swapOfferedItemIds" | "swapRequestedItemIds" | "counterSwapOwnerItemIds" | "counterSwapRequesterItemIds">): number[] {
  const ids = [request.itemId];
  if (request.requestType === "SWAP") {
    ids.push(
      ...(request.swapOfferedItemIds ?? []),
      ...(request.swapRequestedItemIds ?? []),
      ...(request.counterSwapOwnerItemIds ?? []),
      ...(request.counterSwapRequesterItemIds ?? []),
    );
  }
  return [...new Set(ids.filter((id): id is number => typeof id === "number"))];
}

/**
 * The item (if any) that a request being accepted can no longer have: swapped, or given away in a completed gift. Only the items
 * the exchange would actually move count: for a swap that is the sides as they stand (a counter replaces the original sides),
 * so an item the counter dropped does not block it.
 *
 * An item is only gone while it is not listed: a completed swap or gift takes it off the market (isAvailable false) and the
 * isSwapped flag is never cleared, so an owner who relists it (the relist route sets isAvailable true) has said it is theirs
 * to trade again. Counting it as gone anyway made the counter picker offer an item that accepting then refused.
 */
export async function goneItemFor(request: RequestRow, exec: Executor = db): Promise<{ id: number; name: string } | null> {
  const ids = heldItemIds(request);
  if (ids.length === 0) return null;
  const [swapped] = await exec.select({ id: items.id, name: items.name }).from(items).where(and(inArray(items.id, ids), eq(items.isSwapped, true), eq(items.isAvailable, false))).limit(1);
  if (swapped) return swapped;
  const [given] = await exec
    .select({ id: items.id, name: items.name })
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(and(inArray(itemRequests.itemId, ids), eq(itemRequests.requestType, "GIFT"), eq(itemRequests.status, "COMPLETED"), ne(itemRequests.id, request.id), eq(items.isAvailable, false)))
    .limit(1);
  return given ?? null;
}

/** True when an item the request would move is already gone (see goneItemFor). */
export async function requestInvolvesGoneItem(request: RequestRow, exec: Executor = db): Promise<boolean> {
  return (await goneItemFor(request, exec)) !== null;
}

/**
 * A gift or a swap has completed: decline every other PENDING request for the items it moved, with the notice, a line in the
 * thread and a push. For a swap that is the requests for any item on either side, and swaps that offered one of them. Safe
 * to repeat (a declined request is not pending any more). Returns the ids it declined.
 */
export async function declineRequestsForGoneItems(completedRequestId: number): Promise<number[]> {
  const [completed] = await db.select().from(itemRequests).where(eq(itemRequests.id, completedRequestId)).limit(1);
  if (!completed || (completed.requestType !== "GIFT" && completed.requestType !== "SWAP")) return [];
  const gone = involvedItemIds(completed);
  if (gone.length === 0) return [];
  const goneArray = sql`ARRAY[${sql.join(gone.map((id) => sql`${id}`), sql`, `)}]::integer[]`;

  const others = await db
    .select({ request: itemRequests, itemName: items.name, ownerId: items.ownerId })
    .from(itemRequests)
    .innerJoin(items, eq(items.id, itemRequests.itemId))
    .where(and(
      eq(itemRequests.status, "PENDING"),
      ne(itemRequests.id, completedRequestId),
      or(
        inArray(itemRequests.itemId, gone),
        and(
          eq(itemRequests.requestType, "SWAP"),
          or(
            sql`${itemRequests.swapOfferedItemIds} && ${goneArray}`,
            sql`${itemRequests.swapRequestedItemIds} && ${goneArray}`,
            sql`${itemRequests.counterSwapOwnerItemIds} && ${goneArray}`,
            sql`${itemRequests.counterSwapRequesterItemIds} && ${goneArray}`,
          ),
        ),
      ),
    ));

  const declined: number[] = [];
  for (const { request, itemName, ownerId } of others) {
    const [row] = await db
      .update(itemRequests)
      .set({ status: "DECLINED", unarchivedAt: new Date() })
      .where(and(eq(itemRequests.id, request.id), eq(itemRequests.status, "PENDING")))
      .returning({ id: itemRequests.id });
    if (!row || request.requesterId === null) continue;
    declined.push(request.id);
    await db.insert(notifications).values({
      userId: request.requesterId, type: "request_declined", title: "Request declined", message: ITEM_NO_LONGER_AVAILABLE_MESSAGE,
      itemId: request.itemId, requestId: request.id, isRead: false,
    });
    if (ownerId !== null) {
      await db.insert(messages).values({
        content: ITEM_NO_LONGER_AVAILABLE_MESSAGE, senderId: ownerId, receiverId: request.requesterId, requestId: request.id, messageType: "system",
      });
    }
    await Promise.resolve(
      sendPushToUser(request.requesterId, {
        title: "Request declined", body: `${ITEM_NO_LONGER_AVAILABLE_MESSAGE} (${itemName.length > 28 ? `${itemName.slice(0, 28)}…` : itemName})`,
        data: { screen: "chat", chatUserId: ownerId, requestId: request.id, itemId: request.itemId },
      }, "requests"),
    ).catch(() => {});
  }
  return declined;
}
