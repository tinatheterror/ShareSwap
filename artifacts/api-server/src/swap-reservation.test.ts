import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, reputationActivities, shareCoinsTransactions, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { COMMITTED_STATUSES, heldItemIds, type ReservableRequest } from "./swap-reservation.js";

const UNIQUE = `swap-reservation-${Date.now()}`;
const PASSWORD = "SwapReservation!42";
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let server: Awaited<ReturnType<typeof startApp>>;
let owner: { id: number; username: string };

before(async () => {
  server = await startApp();
  owner = await makeUser("owner");
});

after(async () => {
  try {
    if (requestIds.length) {
      await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [requestIds]);
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) {
      await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
    }
    // Accepting a swap records an anti-farming check for the two people and the item.
    if (itemIds.length) await pool.query("DELETE FROM farming_detections WHERE item_id = ANY($1)", [itemIds]);
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await pool.query("DELETE FROM swap_cooldowns WHERE user_id_1 = ANY($1) OR user_id_2 = ANY($1)", [userIds]);
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await server.close();
    await pool.end();
  }
});

async function makeUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, shareCoins: "100.00" })
    .returning({ id: users.id, username: users.username });
  userIds.push(user.id);
  return user;
}

async function makeItem(ownerId: number, label: string) {
  const [item] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-${label}`, description: "x", conditionRating: 4, photos: [], isSwappable: true, isAvailable: true, tier: 2, shareCoinsReward: "0" })
    .returning({ id: items.id });
  itemIds.push(item.id);
  return item.id;
}

async function makeSwap(itemId: number, requesterId: number, offered: number[], status: string, extra: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId, requesterId, requestType: "SWAP", status, swapOfferedItemIds: offered, acceptedAt: status === "ACCEPTED" ? new Date() : null, ...extra })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

async function ownerAccepts(requestId: number) {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/login", { username: owner.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client.patch(`/api/requests/${requestId}`, { status: "ACCEPTED" });
}

const status = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const asRequest = (over: Partial<ReservableRequest>): ReservableRequest => ({
  id: 1, itemId: 10, requestType: "SWAP", swapOfferedItemIds: [], swapRequestedItemIds: [], counterSwapOwnerItemIds: [], counterSwapRequesterItemIds: [], ...over,
});

test("a swap holds the listing item, any extra items asked for and the offered items; a counter replaces both sides", () => {
  assert.deepEqual(heldItemIds(asRequest({ swapOfferedItemIds: [20, 21], swapRequestedItemIds: [11] })).sort(), [10, 11, 20, 21]);
  assert.deepEqual(heldItemIds(asRequest({ swapOfferedItemIds: [20], counterSwapOwnerItemIds: [12], counterSwapRequesterItemIds: [22, 23] })).sort(), [12, 22, 23]);
  assert.deepEqual(heldItemIds(asRequest({ counterSwapRequesterItemIds: [22] })).sort(), [10, 22], "a one-sided counter keeps the other side");
  assert.deepEqual(heldItemIds(asRequest({ requestType: "BORROW", swapOfferedItemIds: [99] })), [10], "only a swap holds more than its listing item");
  assert.ok(COMMITTED_STATUSES.includes("ACCEPTED" as never) && !COMMITTED_STATUSES.includes("PENDING" as never));
});

test("an owner cannot accept a swap for an item an accepted swap already holds", async () => {
  const requesterA = await makeUser("reqA");
  const requesterB = await makeUser("reqB");
  const listed = await makeItem(owner.id, "listed");
  const offeredA = await makeItem(requesterA.id, "offeredA");
  const offeredB = await makeItem(requesterB.id, "offeredB");
  const first = await makeSwap(listed, requesterA.id, [offeredA], "ACCEPTED");
  const second = await makeSwap(listed, requesterB.id, [offeredB], "PENDING");

  const res = await ownerAccepts(second);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code: string; conflictingRequestId: number; itemId: number };
  assert.deepEqual([body.code, body.conflictingRequestId, body.itemId], ["ITEM_ALREADY_COMMITTED", first, listed]);
  assert.equal(await status(second), "PENDING");

  // The hold ends with the swap: once the first one is cancelled the second can be accepted.
  await db.update(itemRequests).set({ status: "CANCELLED" }).where(eq(itemRequests.id, first));
  assert.equal((await ownerAccepts(second)).status, 200);
  assert.equal(await status(second), "ACCEPTED");
});

test("an offered item cannot be committed to two accepted swaps", async () => {
  const requester = await makeUser("reqC");
  const listed1 = await makeItem(owner.id, "listed1");
  const listed2 = await makeItem(owner.id, "listed2");
  const offered = await makeItem(requester.id, "offeredShared");
  await makeSwap(listed1, requester.id, [offered], "ACCEPTED");
  const second = await makeSwap(listed2, requester.id, [offered], "PENDING");

  const res = await ownerAccepts(second);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { itemId: number }).itemId, offered);
  assert.equal(await status(second), "PENDING");
});

test("a swap that shares no item with another accepted swap is accepted as before", async () => {
  const requester = await makeUser("reqD");
  const other = await makeUser("reqE");
  await makeSwap(await makeItem(owner.id, "heldListed"), other.id, [await makeItem(other.id, "heldOffered")], "ACCEPTED");
  const free = await makeSwap(await makeItem(owner.id, "freeListed"), requester.id, [await makeItem(requester.id, "freeOffered")], "PENDING");
  assert.equal((await ownerAccepts(free)).status, 200);
  assert.equal(await status(free), "ACCEPTED");
});

test("a borrow of an item an accepted swap holds is refused too", async () => {
  const requester = await makeUser("reqF");
  const borrower = await makeUser("borrowerF");
  const listed = await makeItem(owner.id, "swapHeldListed");
  await makeSwap(listed, requester.id, [await makeItem(requester.id, "swapHeldOffered")], "ACCEPTED");
  const [borrow] = await db
    .insert(itemRequests)
    .values({ itemId: listed, requesterId: borrower.id, requestType: "BORROW", status: "PENDING", startDate: new Date(Date.now() + 5 * 86_400_000), endDate: new Date(Date.now() + 9 * 86_400_000) })
    .returning({ id: itemRequests.id });
  requestIds.push(borrow.id);
  const res = await ownerAccepts(borrow.id);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "ITEM_ALREADY_COMMITTED");
});

test("the swap item picker leaves out items an accepted swap holds, on either side", async () => {
  const requester = await makeUser("reqG");
  const heldOffered = await makeItem(requester.id, "pickerHeldOffered");
  const freeOffered = await makeItem(requester.id, "pickerFreeOffered");
  await makeSwap(await makeItem(owner.id, "pickerListed"), requester.id, [heldOffered], "ACCEPTED");

  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/login", { username: owner.username, password: PASSWORD })).status, 200);
  const list = (await (await client.get(`/api/swap-eligible-items?partnerId=${requester.id}`)).json()) as { id: number }[];
  const ids = list.map((i) => i.id);
  assert.ok(ids.includes(freeOffered));
  assert.ok(!ids.includes(heldOffered), "an item offered in an accepted swap is not offered again");
});
