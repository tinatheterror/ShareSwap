import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemConditionVerifications, items, pool, users } from "@workspace/db";
import { BROKEN_PHOTO, describeBrokenConditionPlan, planBrokenConditionPhotos, removeBrokenConditionPhotos } from "./broken-condition-photos.js";

const unique = `broken-photos-${Date.now()}`;
let userId: number, itemId: number;
const ids: number[] = [];
const mine = async () => (await planBrokenConditionPhotos()).filter((r) => r.itemId === itemId);

before(async () => {
  const [u] = await db.insert(users).values({ username: unique, password: "x", emailVerified: true }).returning();
  userId = u.id;
  const [item] = await db.insert(items).values({ ownerId: userId, name: unique, description: "d", conditionRating: 5, photos: [], shareCoinsReward: "0" }).returning();
  itemId = item.id;
  const rows = await db.insert(itemConditionVerifications).values([
    { itemId, verifierId: userId, actualConditionRating: 4, notes: "two bad, one good", photos: [BROKEN_PHOTO, "/storage/images/ok.jpg", BROKEN_PHOTO], status: "approved" },
    { itemId, verifierId: userId, actualConditionRating: 3, notes: "only good", photos: ["/storage/images/ok2.jpg"], status: "approved" },
    { itemId, verifierId: userId, actualConditionRating: 3, notes: "no photos", photos: [], status: "rejected" },
  ] as any).returning();
  ids.push(...rows.map((r) => r.id));
});

after(async () => {
  try {
    await db.delete(itemConditionVerifications).where(inArray(itemConditionVerifications.id, ids));
    await db.delete(items).where(eq(items.id, itemId));
    await db.delete(users).where(eq(users.id, userId));
  } finally {
    await pool.end();
  }
});

test("the dry run lists only rows with a broken photo and changes nothing", async () => {
  const rows = await mine();
  assert.deepEqual(rows.map((r) => [r.id, r.brokenCount, r.totalPhotos]), [[ids[0], 2, 3]]);
  assert.match(describeBrokenConditionPlan(rows), /verification \d+ \(item \d+, status approved\): 2 of 3 photos/);
  assert.equal((await mine()).length, 1, "planning does not write");
  assert.match(describeBrokenConditionPlan([]), /No condition verification/);
});

test("removing takes out the bad entries only, keeps the verification and its good photos, and a second run finds nothing", async () => {
  assert.equal(await removeBrokenConditionPhotos((await mine()).map((r) => r.id)), 1);
  const [fixed] = await db.select().from(itemConditionVerifications).where(eq(itemConditionVerifications.id, ids[0]));
  assert.deepEqual(fixed.photos, ["/storage/images/ok.jpg"]);
  assert.deepEqual([fixed.notes, fixed.status, fixed.actualConditionRating], ["two bad, one good", "approved", 4]);
  const [untouched] = await db.select().from(itemConditionVerifications).where(eq(itemConditionVerifications.id, ids[1]));
  assert.deepEqual(untouched.photos, ["/storage/images/ok2.jpg"]);
  assert.equal((await mine()).length, 0);
  assert.equal(await removeBrokenConditionPhotos([]), 0);
});
