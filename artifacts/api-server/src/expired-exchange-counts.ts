import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { EXCHANGE_EXPIRED_REASON } from "./request-expiry-copy";

/**
 * How many accepted swaps and gifts each person has had expire. Both people of an expired exchange are counted: the
 * app cannot tell which of them did not show up, so this is a record for later (it carries no penalty and nothing
 * shows it to anyone). It is read from the expired requests themselves (status EXPIRED and the reason that
 * exchange-expiry-service.ts stamps), so it needs no table of its own and cannot drift from them.
 */
export interface ExpiredExchangeCounts {
  userId: number;
  expiredSwaps: number;
  expiredGifts: number;
}

const counts = (where: ReturnType<typeof sql>) =>
  db.execute(sql`
    SELECT u.id AS user_id,
           count(*) FILTER (WHERE r.expired_reason = ${EXCHANGE_EXPIRED_REASON.SWAP})::int AS expired_swaps,
           count(*) FILTER (WHERE r.expired_reason = ${EXCHANGE_EXPIRED_REASON.GIFT})::int AS expired_gifts
    FROM item_requests r
    JOIN items i ON i.id = r.item_id
    JOIN users u ON u.id = r.requester_id OR u.id = i.owner_id
    WHERE r.status = 'EXPIRED'
      AND r.expired_reason IN (${EXCHANGE_EXPIRED_REASON.SWAP}, ${EXCHANGE_EXPIRED_REASON.GIFT})
      ${where}
    GROUP BY u.id
    ORDER BY u.id`);

const toCounts = (rows: unknown[]): ExpiredExchangeCounts[] =>
  (rows as Array<{ user_id: number; expired_swaps: number; expired_gifts: number }>).map((r) => ({
    userId: Number(r.user_id),
    expiredSwaps: Number(r.expired_swaps),
    expiredGifts: Number(r.expired_gifts),
  }));

/** Everyone who has at least one expired swap or gift. */
export async function expiredExchangeCountsForAll(): Promise<ExpiredExchangeCounts[]> {
  return toCounts((await counts(sql``)).rows);
}

/** One person's counts (zeros when none). */
export async function expiredExchangeCountsFor(userId: number): Promise<ExpiredExchangeCounts> {
  const [row] = toCounts((await counts(sql`AND u.id = ${userId}`)).rows);
  return row ?? { userId, expiredSwaps: 0, expiredGifts: 0 };
}
