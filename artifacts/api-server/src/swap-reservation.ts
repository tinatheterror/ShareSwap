import { and, inArray, ne, or, sql } from "drizzle-orm";
import { db, itemRequests } from "@workspace/db";

// An exchange that has been accepted holds its items: while a request is in one of these statuses, the items it
// involves cannot be committed to another swap. The hold is derived from the requests themselves, so it ends by
// itself the moment a request is cancelled, declined, expired or completed, with nothing to release and no flag
// that could be left set by mistake (the old `items.isAvailable` flag does not say why an item is unavailable).
export const COMMITTED_STATUSES = [
  "ACCEPTED",
  "DEPOSIT_PENDING",
  "DEPOSIT_CONFIRMED",
  "AWAITING_HANDOFF_CONFIRM",
  "HANDOFF_CONFIRMED",
  "IN_PROGRESS",
  "RETURN_REQUESTED",
  "HANDOFF_DISPUTED",
  "DISPUTED",
] as const;

export const ITEM_ALREADY_COMMITTED_CODE = "ITEM_ALREADY_COMMITTED";
export const ITEM_ALREADY_COMMITTED_MESSAGE =
  "One of the items in this exchange is already part of another accepted request. Wait for that one to finish, or ask them to cancel it.";

export interface ReservableRequest {
  id: number;
  itemId: number | null;
  requestType: string;
  swapOfferedItemIds: number[] | null;
  swapRequestedItemIds: number[] | null;
  counterSwapOwnerItemIds: number[] | null;
  counterSwapRequesterItemIds: number[] | null;
}

/**
 * Every item a request holds. A swap holds both sides: a counter-proposal replaces the original sides, else the
 * listing item (plus any extra items asked for) on the owner's side and the offered items on the requester's.
 * Any other request holds just its listing item.
 */
export function heldItemIds(request: ReservableRequest): number[] {
  const listed = request.itemId === null ? [] : [request.itemId];
  if (request.requestType !== "SWAP") return listed;
  const ownerSide = request.counterSwapOwnerItemIds?.length ? request.counterSwapOwnerItemIds : [...listed, ...(request.swapRequestedItemIds ?? [])];
  const requesterSide = request.counterSwapRequesterItemIds?.length ? request.counterSwapRequesterItemIds : (request.swapOfferedItemIds ?? []);
  return [...new Set([...ownerSide, ...requesterSide])];
}

const intArray = (ids: number[]) => sql.raw(`ARRAY[${ids.map((id) => Math.trunc(Number(id))).join(",")}]::int[]`);

/** Requests in a committed status that might hold one of these items (a loose database filter; heldItemIds decides). */
async function committedRequestsTouching(ids: number[], excludeRequestId: number | null) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: itemRequests.id,
      itemId: itemRequests.itemId,
      requestType: itemRequests.requestType,
      swapOfferedItemIds: itemRequests.swapOfferedItemIds,
      swapRequestedItemIds: itemRequests.swapRequestedItemIds,
      counterSwapOwnerItemIds: itemRequests.counterSwapOwnerItemIds,
      counterSwapRequesterItemIds: itemRequests.counterSwapRequesterItemIds,
    })
    .from(itemRequests)
    .where(
      and(
        inArray(itemRequests.status, [...COMMITTED_STATUSES]),
        ...(excludeRequestId === null ? [] : [ne(itemRequests.id, excludeRequestId)]),
        or(
          inArray(itemRequests.itemId, ids),
          sql`${itemRequests.swapOfferedItemIds} && ${intArray(ids)}`,
          sql`${itemRequests.swapRequestedItemIds} && ${intArray(ids)}`,
          sql`${itemRequests.counterSwapOwnerItemIds} && ${intArray(ids)}`,
          sql`${itemRequests.counterSwapRequesterItemIds} && ${intArray(ids)}`,
        ),
      ),
    );
  return rows;
}

export interface ReservationConflict {
  requestId: number;
  itemId: number;
}

/**
 * Before accepting a request: is one of the items it would hold already held by another accepted request?
 * Accepting a SWAP checks every other committed request; accepting anything else only checks committed swaps
 * (borrows of the same item for other dates are allowed to queue as before).
 */
export async function findReservationConflict(request: ReservableRequest): Promise<ReservationConflict | null> {
  const mine = heldItemIds(request);
  const others = await committedRequestsTouching(mine, request.id);
  for (const other of others) {
    if (request.requestType !== "SWAP" && other.requestType !== "SWAP") continue;
    const theirs = heldItemIds(other);
    const shared = mine.find((id) => theirs.includes(id));
    if (shared !== undefined) return { requestId: other.id, itemId: shared };
  }
  return null;
}

/** Items held by any committed request (so pickers can leave them out). */
export async function heldItemIdSet(): Promise<Set<number>> {
  const rows = await db
    .select({
      id: itemRequests.id,
      itemId: itemRequests.itemId,
      requestType: itemRequests.requestType,
      swapOfferedItemIds: itemRequests.swapOfferedItemIds,
      swapRequestedItemIds: itemRequests.swapRequestedItemIds,
      counterSwapOwnerItemIds: itemRequests.counterSwapOwnerItemIds,
      counterSwapRequesterItemIds: itemRequests.counterSwapRequesterItemIds,
    })
    .from(itemRequests)
    .where(inArray(itemRequests.status, [...COMMITTED_STATUSES]));
  return new Set(rows.flatMap(heldItemIds));
}
