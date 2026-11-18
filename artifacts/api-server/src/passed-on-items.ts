import { and, inArray, sql, type SQL } from "drizzle-orm";
import { db, itemRequests, items } from "@workspace/db";

// An item that was swapped away or given away is gone for good: it is never listed again, whatever happens to the owner's
// account or listings afterwards. A swap sets items.isSwapped; a gift sets no flag on the item, so a completed GIFT request
// is what says it. This is the one definition: the relist route, account reactivation, cancelling a deletion and the item
// pickers all use it.

/** The statuses in which a gift or swap has handed the item over. */
export const HANDED_OVER_STATUSES = ["COMPLETED", "COMPLETED_EARLY"] as const;

export const ITEM_PASSED_ON_CODE = "ITEM_PASSED_ON";
export const ITEM_PASSED_ON_MESSAGE = "This item was swapped or given away, so it can't be relisted.";

/** SQL condition (on a query over `items`): the item was swapped away or given away in a completed gift. */
export const passedOnItemSql: SQL = sql`("items"."is_swapped" = true OR EXISTS (
  SELECT 1 FROM "item_requests" AS "handed_over"
  WHERE "handed_over"."item_id" = "items"."id"
    AND "handed_over"."request_type" = 'GIFT'
    AND "handed_over"."status" IN ('COMPLETED', 'COMPLETED_EARLY')
))`;

/** SQL condition: the item has NOT been passed on (safe with a NULL is_swapped). */
export const notPassedOnItemSql: SQL = sql`NOT COALESCE(${passedOnItemSql}, false)`;

/** Ids (from the given ones) of items that were gifted away in a completed gift. */
export async function giftedItemIds(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ itemId: itemRequests.itemId })
    .from(itemRequests)
    .where(and(inArray(itemRequests.itemId, ids), sql`${itemRequests.requestType} = 'GIFT'`, inArray(itemRequests.status, [...HANDED_OVER_STATUSES])));
  return new Set(rows.map((r) => r.itemId));
}

/** True when the item was swapped away or given away. */
export async function isItemPassedOn(itemId: number): Promise<boolean> {
  const [row] = await db.select({ id: items.id }).from(items).where(and(sql`${items.id} = ${itemId}`, passedOnItemSql)).limit(1);
  return !!row;
}
