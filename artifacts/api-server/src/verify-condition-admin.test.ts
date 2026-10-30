import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemConditionVerifications, items, pool, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

// POST /api/items/:itemId/verify-condition writes an item's condition verification and can mark the item
// verified, so only an admin may call it.

const UNIQUE = `verify-cond-${Date.now()}`;
const PASSWORD = "Verify!42";
const userIds: number[] = [];
const itemIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let itemId: number;

async function makeUser(label: string, isAdmin: boolean) {
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, isAdmin })
    .returning();
  userIds.push(row.id);
  return row;
}

async function signIn(label: string, isAdmin: boolean) {
  const user = await makeUser(label, isAdmin);
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}

const verifications = () => db.select().from(itemConditionVerifications).where(eq(itemConditionVerifications.itemId, itemId));

before(async () => {
  ({ baseUrl, close: closeServer } = await startApp());
  const owner = await makeUser("owner", false);
  const [item] = await db
    .insert(items)
    .values({ ownerId: owner.id, name: `${UNIQUE}-item`, description: "Needs verifying", conditionRating: 3, photos: [], isAvailable: true, shareCoinsReward: "0" })
    .returning({ id: items.id });
  itemId = item.id;
  itemIds.push(item.id);
});

after(async () => {
  try {
    if (itemIds.length) {
      await db.delete(itemConditionVerifications).where(inArray(itemConditionVerifications.itemId, itemIds));
      await db.delete(items).where(inArray(items.id, itemIds));
    }
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("a signed-out caller gets 401 and nothing is written", async () => {
  const client = new Client(baseUrl);
  await client.fetchCsrfToken();
  const res = await client.post(`/api/items/${itemId}/verify-condition`, { actualConditionRating: 5, status: "approved" });
  assert.equal(res.status, 401);
  assert.equal((await verifications()).length, 0);
});

test("a regular user gets 403 and nothing is written, and the item stays unverified", async () => {
  const client = await signIn("regular", false);
  const res = await client.post(`/api/items/${itemId}/verify-condition`, { actualConditionRating: 5, status: "approved" });
  assert.equal(res.status, 403);
  assert.equal((await verifications()).length, 0);
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  assert.equal(item.isConditionVerified, false);
  assert.equal(item.conditionRating, 3);
});

test("an admin records the verification and the approved rating lands on the item", async () => {
  const client = await signIn("admin", true);
  const res = await client.post(`/api/items/${itemId}/verify-condition`, { actualConditionRating: 4, status: "approved", notes: "Looks right" });
  assert.equal(res.status, 201, await res.clone().text());
  const rows = await verifications();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actualConditionRating, 4);
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  assert.equal(item.isConditionVerified, true);
  assert.equal(item.conditionRating, 4);
});
