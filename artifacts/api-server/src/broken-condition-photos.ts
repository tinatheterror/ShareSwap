import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Admin condition verifications were once saved with photos "/uploads/undefined" (the upload used memory storage, so the file had no
 * name on disk). That path points at nothing. planBrokenConditionPhotos lists the affected rows; removeBrokenConditionPhotos takes
 * the bad entries out of their photos arrays. The verification rows themselves (rating, notes, status) are kept.
 */
export const BROKEN_PHOTO = "/uploads/undefined";

export interface BrokenConditionRow { id: number; itemId: number; verifierId: number; status: string | null; brokenCount: number; totalPhotos: number }

export async function planBrokenConditionPhotos(): Promise<BrokenConditionRow[]> {
  const res = await db.execute(sql`
    SELECT id, item_id, verifier_id, status,
           (SELECT count(*) FROM unnest(photos) p WHERE p = ${BROKEN_PHOTO})::int AS broken, cardinality(photos)::int AS total
    FROM item_condition_verifications WHERE photos @> ARRAY[${BROKEN_PHOTO}]::text[] ORDER BY id`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id), itemId: Number(r.item_id), verifierId: Number(r.verifier_id), status: (r.status as string | null) ?? null,
    brokenCount: Number(r.broken), totalPhotos: Number(r.total),
  }));
}

export function describeBrokenConditionPlan(rows: BrokenConditionRow[]): string {
  if (!rows.length) return `No condition verification has a "${BROKEN_PHOTO}" photo.`;
  return [`${rows.length} condition verification(s) with a "${BROKEN_PHOTO}" photo (${rows.reduce((n, r) => n + r.brokenCount, 0)} bad entries):`,
    ...rows.map((r) => `  verification ${r.id} (item ${r.itemId}, status ${r.status ?? "none"}): ${r.brokenCount} of ${r.totalPhotos} photos`),
    "The bad entries are removed; the verifications themselves are kept."].join("\n");
}

/** Removes the bad entries from exactly the rows that were planned. Returns how many rows changed. */
export async function removeBrokenConditionPhotos(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const res = await db.execute(sql`
    UPDATE item_condition_verifications SET photos = array_remove(photos, ${BROKEN_PHOTO})
    WHERE id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) AND photos @> ARRAY[${BROKEN_PHOTO}]::text[]`);
  return res.rowCount ?? 0;
}
