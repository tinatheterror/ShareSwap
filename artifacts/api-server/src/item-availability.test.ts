import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, shareCoinHolds, shareCoinsTransactions, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { ITEM_NO_LONGER_AVAILABLE_CODE, ITEM_NO_LONGER_AVAILABLE_MESSAGE, declineRequestsForGoneItems, involvedItemIds } from "./item-availability.js";

// When a gift or a swap completes, every other pending request for the items involved is declined with "This item is no
// longer available."; and nothing can be accepted for an item that has been given away or swapped.

const UNIQUE = `item-gone-${Date.now()}`;
const PASSWORD = "ItemGone!42";
const DAY = 24 * 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: Client;
let alice: Client;
let ownerId: number;
let aliceId: number;
let bobId: number;

class Client {
  private cookies = new Map<string, string>();
  private csrfToken = "";

  private async send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return response;
  }

  private async call(method: string, path: string, body: unknown) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    const response = await this.send(path, { method, headers, body: JSON.stringify(body) });
    const text = await response.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text };
  }

  post(path: string, body: unknown = {}) { return this.call("POST", path, body); }
  patch(path: string, body: unknown = {}) { return this.call("PATCH", path, body); }

  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }
}

async function newItem(by: number, extra: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId: by, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isAvailable: true,
    isGift: true, isSwappable: true, isLendable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier: 2, ...extra,
  } as typeof items.$inferInsert).returning({ id: items.id, name: items.name });
  itemIds.push(item.id);
  return item;
}

async function request(itemId: number, by: number, requestType: string, fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [row] = await db.insert(itemRequests).values({
    itemId, requesterId: by, requestType, status: "PENDING",
    ...(requestType === "BORROW" ? { startDate: new Date(Date.now() + 10 * DAY), endDate: new Date(Date.now() + 17 * DAY), depositMethod: "in_person" } : {}),
    ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(row.id);
  return row.id;
}

const statusOf = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const clearCooldowns = () => pool.query("DELETE FROM swap_cooldowns WHERE user_id_1 = ANY($1) OR user_id_2 = ANY($1)", [userIds]);
const notesFor = (userId: number, requestId: number) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.requestId, requestId)));

/** The server's own handoff sweep, with its real rewards and clean-up, run live (it is captured from the app's scheduled-job hook). */
let handoffSweep: ((mode: "off" | "dry-run" | "live", log: (line: string) => void, scope?: { onlyRequestIds?: number[] }) => Promise<unknown>) | null = null;
/** Scoped to the request under test, so it never advances another test file's rows. */
async function runLiveSweep(requestId: number) {
  assert.ok(handoffSweep, "the app handed over its handoff sweep");
  await handoffSweep("live", () => {}, { onlyRequestIds: [requestId] });
}

/** The request goes from pending to ACCEPTED through the route, so its PIN exists. */
async function accepted(id: number) {
  await clearCooldowns();
  assert.equal((await owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" })).status, 200);
}

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, a, b] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Orla Owner", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-alice`, displayName: "Alice Asker", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-bob`, displayName: "Bob Bystander", password, emailVerified: true, shareCoins: "100.00" },
  ]).returning({ id: users.id });
  [ownerId, aliceId, bobId] = [o.id, a.id, b.id];
  userIds.push(o.id, a.id, b.id);
  const server = registerRoutes(app, { startBackgroundJobs: false, onScheduledJobs: (jobs: any) => { handoffSweep = jobs.runHandoffSweep; } });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  owner = await new Client().signIn(`${UNIQUE}-owner`);
  alice = await new Client().signIn(`${UNIQUE}-alice`);
});

after(async () => {
  try {
    const created = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const all = [...new Set([...requestIds, ...created.map((r) => r.id)])];
    if (all.length) {
      await pool.query("DELETE FROM delivery_arrangements WHERE request_id = ANY($1)", [all]);
      await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [all]);
      await db.delete(messages).where(inArray(messages.requestId, all));
      await db.delete(notifications).where(inArray(notifications.requestId, all));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, all));
      await db.delete(shareCoinHolds).where(inArray(shareCoinHolds.requestId, all));
      await db.delete(itemRequests).where(inArray(itemRequests.id, all));
    }
    if (userIds.length) {
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
      await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
      await pool.query("DELETE FROM user_achievements WHERE user_id = ANY($1)", [userIds]);
      await pool.query("DELETE FROM reputation_activities WHERE user_id = ANY($1)", [userIds]);
    }
    if (itemIds.length) {
      await pool.query("DELETE FROM farming_detections WHERE item_id = ANY($1)", [itemIds]);
      await db.delete(items).where(inArray(items.id, itemIds));
    }
    if (userIds.length) {
      await pool.query("DELETE FROM swap_cooldowns WHERE user_id_1 = ANY($1) OR user_id_2 = ANY($1)", [userIds]);
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await closeServer();
    await pool.end();
  }
});

// ── A gift completes ─────────────────────────────────────────────────────────────

test("a completed gift declines every other pending request for the item, with the notice, and leaves the rest alone", async () => {
  const gift = await newItem(ownerId);
  const other = await newItem(ownerId);
  const winning = await request(gift.id, aliceId, "GIFT");
  const asGift = await request(gift.id, bobId, "GIFT");
  const asBorrow = await request(gift.id, bobId, "BORROW");
  const elsewhere = await request(other.id, bobId, "GIFT");
  await accepted(winning);

  assert.equal((await owner.post(`/api/requests/${winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await alice.post(`/api/requests/${winning}/handoff`, { confirmedBy: "borrower" })).status, 200);
  assert.equal(await statusOf(winning), "COMPLETED");

  assert.equal(await statusOf(asGift), "DECLINED");
  assert.equal(await statusOf(asBorrow), "DECLINED");
  assert.equal(await statusOf(elsewhere), "PENDING", "a request for another item is untouched");

  const told = (await notesFor(bobId, asGift)).find((n) => n.type === "request_declined");
  assert.equal(told?.message, ITEM_NO_LONGER_AVAILABLE_MESSAGE);
  assert.equal(ITEM_NO_LONGER_AVAILABLE_MESSAGE, "This item is no longer available.");
  const thread = await db.select().from(messages).where(eq(messages.requestId, asBorrow));
  assert.ok(thread.some((m) => m.content === ITEM_NO_LONGER_AVAILABLE_MESSAGE), "and a line in the thread");
  assert.deepEqual((await notesFor(bobId, winning)).filter((n) => n.type === "request_declined"), []);
});

test("a gift confirmed with the code declines the others too", async () => {
  const gift = await newItem(ownerId);
  const winning = await request(gift.id, aliceId, "GIFT");
  const loser = await request(gift.id, bobId, "GIFT");
  await accepted(winning);
  const [row] = await db.select({ pin: itemRequests.handoffPin }).from(itemRequests).where(eq(itemRequests.id, winning));
  assert.ok(row.pin, "the code was issued at accept");

  const response = await alice.post(`/api/requests/${winning}/verify-pin`, { pin: row.pin });
  assert.equal(response.status, 200, response.text.slice(0, 300));
  assert.equal(await statusOf(winning), "COMPLETED");
  assert.equal(await statusOf(loser), "DECLINED");
  assert.equal((await notesFor(bobId, loser)).find((n) => n.type === "request_declined")?.message, ITEM_NO_LONGER_AVAILABLE_MESSAGE);
});

test("a gift the sweep confirms for a silent receiver declines the others too", async () => {
  const gift = await newItem(ownerId);
  const winning = await request(gift.id, aliceId, "GIFT");
  const loser = await request(gift.id, bobId, "GIFT");
  await accepted(winning);
  assert.equal((await owner.post(`/api/requests/${winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  await db.update(itemRequests).set({ handoffConfirmDeadline: new Date(Date.now() - 3_600_000) }).where(eq(itemRequests.id, winning));
  await runLiveSweep(winning);
  assert.equal(await statusOf(winning), "COMPLETED");
  assert.equal(await statusOf(loser), "DECLINED");
});

// ── A swap completes ─────────────────────────────────────────────────────────────

async function swapPair() {
  const ownerItem = await newItem(ownerId); // 10
  const aliceItem = await newItem(aliceId); // 10: even, no coins
  const winning = await request(ownerItem.id, aliceId, "SWAP", { swapOfferedItemIds: [aliceItem.id] });
  return { ownerItem, aliceItem, winning };
}

test("a completed swap declines the other requests for the items on BOTH sides, and swaps that offered one of them", async () => {
  const { ownerItem, aliceItem, winning } = await swapPair();
  const forOwnersItem = await request(ownerItem.id, bobId, "BORROW");
  const forAlicesItem = await request(aliceItem.id, bobId, "GIFT");
  const spare = await newItem(ownerId);
  const aliceOffersTheSameItemElsewhere = await request(spare.id, aliceId, "SWAP", { swapOfferedItemIds: [aliceItem.id] });
  const unrelated = await request((await newItem(ownerId)).id, bobId, "GIFT");
  await accepted(winning);

  assert.equal((await owner.post(`/api/requests/${winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await alice.post(`/api/requests/${winning}/handoff`, { confirmedBy: "borrower" })).status, 200);
  assert.equal(await statusOf(winning), "COMPLETED");

  for (const id of [forOwnersItem, forAlicesItem, aliceOffersTheSameItemElsewhere]) assert.equal(await statusOf(id), "DECLINED", `request ${id}`);
  assert.equal(await statusOf(unrelated), "PENDING");
  assert.equal((await notesFor(bobId, forAlicesItem)).find((n) => n.type === "request_declined")?.message, ITEM_NO_LONGER_AVAILABLE_MESSAGE);
  assert.equal((await notesFor(aliceId, aliceOffersTheSameItemElsewhere)).find((n) => n.type === "request_declined")?.message, ITEM_NO_LONGER_AVAILABLE_MESSAGE);
});

test("a swap confirmed with the code, or by the sweep, declines the others too", async () => {
  const viaPin = await swapPair();
  const pinLoser = await request(viaPin.ownerItem.id, bobId, "BORROW");
  await accepted(viaPin.winning);
  const [row] = await db.select({ pin: itemRequests.handoffPin }).from(itemRequests).where(eq(itemRequests.id, viaPin.winning));
  assert.equal((await alice.post(`/api/requests/${viaPin.winning}/verify-pin`, { pin: row.pin })).status, 200);
  assert.equal(await statusOf(pinLoser), "DECLINED");

  const viaSweep = await swapPair();
  const sweepLoser = await request(viaSweep.aliceItem.id, bobId, "GIFT");
  await accepted(viaSweep.winning);
  assert.equal((await owner.post(`/api/requests/${viaSweep.winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  await db.update(itemRequests).set({ handoffConfirmDeadline: new Date(Date.now() - 3_600_000) }).where(eq(itemRequests.id, viaSweep.winning));
  await runLiveSweep(viaSweep.winning);
  assert.equal(await statusOf(viaSweep.winning), "COMPLETED");
  assert.equal(await statusOf(sweepLoser), "DECLINED");
});

test("a swap that has only been accepted declines nothing: the others are declined when it completes, not before", async () => {
  const { ownerItem, winning } = await swapPair();
  const bystander = await request(ownerItem.id, bobId, "BORROW");
  await accepted(winning);
  assert.equal(await statusOf(bystander), "PENDING");
  assert.deepEqual(await declineRequestsForGoneItems(999_999_999), [], "and a request that does not exist declines nothing");
});

// ── Refusing to accept what is gone ──────────────────────────────────────────────

test("a request for an item that has been given away cannot be accepted", async () => {
  const gift = await newItem(ownerId);
  const winning = await request(gift.id, aliceId, "GIFT");
  await accepted(winning);
  assert.equal((await owner.post(`/api/requests/${winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await alice.post(`/api/requests/${winning}/handoff`, { confirmedBy: "borrower" })).status, 200);

  // A request that got in after it was given away (or one the clean-up above missed).
  const late = await request(gift.id, bobId, "GIFT");
  const response = await owner.patch(`/api/requests/${late}`, { status: "ACCEPTED" });
  assert.equal(response.status, 409);
  assert.deepEqual([response.json.error, response.json.code, response.json.itemId, response.json.itemName], [ITEM_NO_LONGER_AVAILABLE_MESSAGE, ITEM_NO_LONGER_AVAILABLE_CODE, gift.id, gift.name]);
  assert.equal(await statusOf(late), "PENDING");

  // Also by accepting a counter.
  const lateCounter = await request(gift.id, bobId, "BORROW", { negotiationStatus: "counter_proposed", counterProposedBy: bobId, counterRound: 1 } as any);
  const viaCounter = await owner.post(`/api/requests/${lateCounter}/respond-to-counter`, { accept: true });
  assert.equal(viaCounter.status, 409);
  assert.equal(viaCounter.json.code, ITEM_NO_LONGER_AVAILABLE_CODE);
  assert.equal(await statusOf(lateCounter), "PENDING");
});

test("a request for an item that has been swapped cannot be accepted, whichever side's item it is, nor can a swap that offers one", async () => {
  const { ownerItem, aliceItem, winning } = await swapPair();
  await accepted(winning);
  assert.equal((await owner.post(`/api/requests/${winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await alice.post(`/api/requests/${winning}/handoff`, { confirmedBy: "borrower" })).status, 200);

  const onOwnersItem = await request(ownerItem.id, bobId, "BORROW");
  const offersGoneItem = await request((await newItem(ownerId)).id, aliceId, "SWAP", { swapOfferedItemIds: [aliceItem.id] });
  for (const id of [onOwnersItem, offersGoneItem]) {
    const response = await owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" });
    assert.equal(response.status, 409, `request ${id}`);
    assert.equal(response.json.code, ITEM_NO_LONGER_AVAILABLE_CODE);
    assert.equal(await statusOf(id), "PENDING");
  }

  // Alice's own item was swapped to the owner: a request for it is refused when ITS owner (Alice) accepts.
  const forAlicesItem = await request(aliceItem.id, bobId, "GIFT");
  assert.equal((await alice.patch(`/api/requests/${forAlicesItem}`, { status: "ACCEPTED" })).status, 409);
});

test("items that are still here are unaffected: the same accept works", async () => {
  const fresh = await newItem(ownerId);
  const id = await request(fresh.id, bobId, "GIFT");
  assert.equal((await owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" })).status, 200);
  assert.deepEqual(involvedItemIds({ itemId: 7, requestType: "SWAP", swapOfferedItemIds: [8, 9], swapRequestedItemIds: [10], counterSwapOwnerItemIds: [7, 11], counterSwapRequesterItemIds: [] } as any).sort((a, b) => a - b), [7, 8, 9, 10, 11]);
  assert.deepEqual(involvedItemIds({ itemId: 7, requestType: "BORROW", swapOfferedItemIds: [8] } as any), [7], "only a swap has sides");
});

test("an item the counter dropped does not block accepting: only the items the exchange would move count", async () => {
  const ownerItem = await newItem(ownerId);
  const offered = await newItem(aliceId); // the original offer
  const counterItem = await newItem(aliceId); // what the counter asks for instead
  await db.update(items).set({ isSwapped: true, isAvailable: false }).where(eq(items.id, offered.id)); // the dropped item has since gone elsewhere
  const id = await request(ownerItem.id, aliceId, "SWAP", {
    swapOfferedItemIds: [offered.id], negotiationStatus: "counter_proposed", counterProposedBy: ownerId, counterRound: 1,
    counterSwapOwnerItemIds: [ownerItem.id], counterSwapRequesterItemIds: [counterItem.id],
  } as any);
  await clearCooldowns();
  const response = await alice.post(`/api/requests/${id}/respond-to-counter`, { accept: true });
  assert.equal(response.status, 200, response.text.slice(0, 300));

  // Whereas a counter that still includes a swapped item is refused, and says which item it is.
  const other = await newItem(ownerId);
  const swappedAway = await newItem(aliceId);
  await db.update(items).set({ isSwapped: true, isAvailable: false }).where(eq(items.id, swappedAway.id));
  const blocked = await request(other.id, aliceId, "SWAP", {
    swapOfferedItemIds: [swappedAway.id], counterSwapOwnerItemIds: [other.id], counterSwapRequesterItemIds: [swappedAway.id], negotiationStatus: "counter_proposed", counterProposedBy: ownerId, counterRound: 1,
  } as any);
  const refused = await alice.post(`/api/requests/${blocked}/respond-to-counter`, { accept: true });
  assert.equal(refused.status, 409);
  assert.deepEqual([refused.json.code, refused.json.itemId, refused.json.itemName], [ITEM_NO_LONGER_AVAILABLE_CODE, swappedAway.id, swappedAway.name]);
});

test("an item the owner has relisted after it was swapped or given can be accepted again; unlisted, it is still gone", async () => {
  // Swapped, then relisted (isSwapped stays set; the relist route only makes it available again).
  const { ownerItem, winning } = await swapPair();
  await accepted(winning);
  assert.equal((await owner.post(`/api/requests/${winning}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await alice.post(`/api/requests/${winning}/handoff`, { confirmedBy: "borrower" })).status, 200);
  const [swapped] = await db.select({ s: items.isSwapped, a: items.isAvailable }).from(items).where(eq(items.id, ownerItem.id));
  assert.deepEqual(swapped, { s: true, a: false }, "the completed swap took it off the market");

  const whileGone = await request(ownerItem.id, bobId, "BORROW");
  assert.equal((await owner.patch(`/api/requests/${whileGone}`, { status: "ACCEPTED" })).status, 409, "unlisted: gone");

  assert.equal((await owner.post(`/api/items/${ownerItem.id}/relist`, {})).status, 200);
  const [relisted] = await db.select({ s: items.isSwapped, a: items.isAvailable }).from(items).where(eq(items.id, ownerItem.id));
  assert.deepEqual(relisted, { s: true, a: true }, "relisted: available again, flag untouched");
  const afterRelist = await request(ownerItem.id, bobId, "GIFT");
  assert.equal((await owner.patch(`/api/requests/${afterRelist}`, { status: "ACCEPTED" })).status, 200, "relisted: no longer refused");

  // The same for a swap whose counter lists the relisted item on the owner's side (the case that was reported).
  const counterTarget = await newItem(ownerId);
  const offered = await newItem(aliceId);
  await db.update(items).set({ isSwapped: true, isAvailable: true }).where(eq(items.id, counterTarget.id));
  const counter = await request(counterTarget.id, aliceId, "SWAP", {
    swapOfferedItemIds: [offered.id], negotiationStatus: "counter_proposed", counterProposedBy: aliceId, counterRound: 1,
    counterSwapOwnerItemIds: [counterTarget.id], counterSwapRequesterItemIds: [offered.id],
  } as any);
  await clearCooldowns();
  const response = await owner.post(`/api/requests/${counter}/respond-to-counter`, { accept: true });
  assert.equal(response.status, 200, response.text.slice(0, 300));
});
