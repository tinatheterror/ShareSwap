import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import {
  MAX_SWAP_OFFSET_SC,
  REQUEST_NOT_ACCEPTABLE_NOW_CODE,
  REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE,
  notifyUnblockedRequests,
  quoteSwap,
} from "./sharecoin-funds.js";

// Funds checks and discretion (docs/sharecoin-funds-design.md): whoever would pay is checked when they send or accept, and
// sees the Not Enough ShareCoins response; if the OTHER person would pay and is short, the accepter gets a neutral answer,
// the payer a private nudge, and the accepter a notice (with no reason) once the payer can afford it.

const UNIQUE = `funds-${Date.now()}`;
const PASSWORD = "FundsGate!42";
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let owner: Client;
let requester: Client;
let ownerId: number;
let requesterId: number;

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

const setCoins = (id: number, amount: number) => db.update(users).set({ shareCoins: `${amount}.00` }).where(eq(users.id, id));

async function newItem(ownerOfItem: number, tier: number, extra: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId: ownerOfItem, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isSwappable: true, isLendable: true, isAvailable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier,
    ...extra,
  } as typeof items.$inferInsert).returning({ id: items.id, name: items.name });
  itemIds.push(item.id);
  return item;
}

async function pendingSwap(ownerTier: number, requesterTier: number, fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const ownerItem = await newItem(ownerId, ownerTier);
  const requesterItem = await newItem(requesterId, requesterTier);
  const [request] = await db.insert(itemRequests).values({
    itemId: ownerItem.id, requesterId, requestType: "SWAP", status: "PENDING", swapOfferedItemIds: [requesterItem.id], ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, ownerItem, requesterItem };
}

async function pendingBorrow() {
  const item = await newItem(ownerId, 2, { shareCoinPrice: "14.00" });
  const start = new Date(Date.now() + 10 * 24 * 3_600_000);
  const end = new Date(start.getTime() + 7 * 24 * 3_600_000);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId, requestType: "BORROW", status: "PENDING", startDate: start, endDate: end, depositMethod: "in_person",
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, item };
}

const notesFor = (userId: number, requestId?: number) =>
  db.select().from(notifications).where(eq(notifications.userId, userId)).then((rows) => rows.filter((n) => requestId === undefined || n.requestId === requestId));
const requestStatus = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const requestCount = async () => (await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.requesterId, [requesterId]))).length;

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, r] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Olive Owner", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-requester`, displayName: "Remy Requester", password, emailVerified: true, shareCoins: "100.00" },
  ]).returning({ id: users.id });
  ownerId = o.id;
  requesterId = r.id;
  userIds.push(o.id, r.id);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  owner = await new Client().signIn(`${UNIQUE}-owner`);
  requester = await new Client().signIn(`${UNIQUE}-requester`);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    // Requests created through the API are not in requestIds.
    if (itemIds.length) {
      const created = await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds));
      const all = [...new Set([...requestIds, ...created.map((r) => r.id)])];
      if (all.length) {
        await pool.query("DELETE FROM delivery_arrangements WHERE request_id = ANY($1)", [all]);
        await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [all]);
        await db.delete(messages).where(inArray(messages.requestId, all));
        await db.delete(notifications).where(inArray(notifications.requestId, all));
        await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, all));
        await db.delete(itemRequests).where(inArray(itemRequests.id, all));
      }
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

// ── The quote ──────────────────────────────────────────────────────────────────────

test("the swap quote: the lower-valued side pays the difference, counters replace a side, extra owner items count", async () => {
  const a = await newItem(ownerId, 2); // 10
  const b = await newItem(requesterId, 3); // 20
  const extra = await newItem(ownerId, 1); // 5
  const base = { requestType: "SWAP", requesterId, ownerId, itemId: a.id, swapOfferedItemIds: [b.id] };

  assert.deepEqual(await quoteSwap(base), { kind: "SWAP", payerId: ownerId, receiverId: requesterId, amount: 10 });
  assert.deepEqual(await quoteSwap({ ...base, swapRequestedItemIds: [extra.id] }), { kind: "SWAP", payerId: ownerId, receiverId: requesterId, amount: 5 }, "the owner's extra item counts (10 + 5 against 20)");
  assert.deepEqual(await quoteSwap({ ...base, counterSwapOwnerItemIds: [b.id], counterSwapRequesterItemIds: [a.id] }), { kind: "SWAP", payerId: requesterId, receiverId: ownerId, amount: 10 }, "a counter swaps the sides");
  assert.equal(await quoteSwap({ ...base, swapOfferedItemIds: [a.id] }), null, "equal values: nothing changes hands");
  assert.equal(await quoteSwap({ ...base, swapOfferedItemIds: [] }), null, "no offered items: no offset");
});

// ── Sending a request ─────────────────────────────────────────────────────────────

test("sending a swap request: the requester who would pay and cannot is blocked, with their own numbers only", async () => {
  const ownerItem = await newItem(ownerId, 3); // 20
  const mine = await newItem(requesterId, 2); // 10: the requester pays 10
  await setCoins(requesterId, 4);
  const before = await requestCount();
  const response = await requester.post(`/api/items/${ownerItem.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [mine.id], message: "swap?" });
  assert.equal(response.status, 402);
  assert.equal(response.json.code, "INSUFFICIENT_SHARECOINS");
  assert.equal(response.json.required, 10);
  assert.equal(response.json.available, 4);
  assert.equal(await requestCount(), before, "no request was created");

  await setCoins(requesterId, 10);
  const ok = await requester.post(`/api/items/${ownerItem.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [mine.id], message: "swap?" });
  assert.ok(ok.status === 200 || ok.status === 201, `created, got ${ok.status} ${ok.text.slice(0, 200)}`);
  await setCoins(requesterId, 100);
});

test("sending a swap request where the OWNER would pay is allowed, and nothing about the owner's balance is looked at or shown", async () => {
  const ownerItem = await newItem(ownerId, 1); // 5: the owner pays 15
  const mine = await newItem(requesterId, 3); // 20
  await setCoins(ownerId, 0);
  const response = await requester.post(`/api/items/${ownerItem.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [mine.id], message: "swap?" });
  assert.ok(response.status === 200 || response.status === 201, `sent, got ${response.status} ${response.text.slice(0, 200)}`);
  assert.doesNotMatch(response.text, /INSUFFICIENT|not enough|balance|shortfall/i);
  await setCoins(ownerId, 100);
});

test("a swap more than the maximum offset apart is refused by the server, at the request and at a counter", async () => {
  assert.equal(MAX_SWAP_OFFSET_SC, 20);
  const ownerItem = await newItem(ownerId, 4); // 40
  const mine = await newItem(requesterId, 1); // 5: offset 35
  const response = await requester.post(`/api/items/${ownerItem.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [mine.id] });
  assert.equal(response.status, 400);
  assert.equal(response.json.code, "SWAP_OFFSET_TOO_LARGE");
  assert.equal(response.json.maxOffset, 20);

  const swap = await pendingSwap(2, 2);
  const big = await newItem(ownerId, 4);
  const counter = await owner.post(`/api/requests/${swap.id}/counter-proposal`, { swapOwnerItemIds: [big.id], swapRequesterItemIds: [swap.requesterItem.id] });
  assert.equal(counter.status, 400);
  assert.equal(counter.json.code, "SWAP_OFFSET_TOO_LARGE");
});

// ── Accepting: the payer is the accepter ──────────────────────────────────────────

test("an owner who would pay and cannot gets the Not Enough ShareCoins response when accepting, and nothing changes", async () => {
  const swap = await pendingSwap(1, 3); // the owner pays 15
  await setCoins(ownerId, 6);
  const response = await owner.patch(`/api/requests/${swap.id}`, { status: "ACCEPTED" });
  assert.equal(response.status, 402);
  assert.deepEqual([response.json.code, response.json.required, response.json.available], ["INSUFFICIENT_SHARECOINS", 15, 6]);
  assert.equal(await requestStatus(swap.id), "PENDING");
  assert.deepEqual(await notesFor(requesterId, swap.id), [], "the other person hears nothing");
  await setCoins(ownerId, 100);
});

// ── Accepting: the other person is the payer ──────────────────────────────────────

test("a swap the requester would pay for: the owner gets only the neutral answer, the requester a private nudge, once", async () => {
  const swap = await pendingSwap(3, 2); // the requester pays 10
  await setCoins(requesterId, 3);
  const first = await owner.patch(`/api/requests/${swap.id}`, { status: "ACCEPTED" });
  assert.equal(first.status, 409);
  assert.deepEqual(first.json, { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE });
  assert.doesNotMatch(first.text, /ShareCoin|requester|payer|short|balance|\d/i, "no amount, role or reason");
  assert.equal(await requestStatus(swap.id), "PENDING");

  const second = await owner.patch(`/api/requests/${swap.id}`, { status: "ACCEPTED" });
  assert.equal(second.status, 409);

  const nudges = (await notesFor(requesterId, swap.id)).filter((n) => n.type === "sharecoin_needed");
  assert.equal(nudges.length, 1, "one nudge for the block, not one per attempt");
  assert.equal(nudges[0].message, `You need 10 ShareCoins to continue with "${swap.ownerItem.name}".`);
  assert.equal(nudges[0].requestId, swap.id, "it links to the request");

  // Nothing about it reaches the blocked person's notifications or the chat.
  assert.deepEqual(await notesFor(ownerId, swap.id), []);
  const chat = await db.select().from(messages).where(eq(messages.requestId, swap.id));
  assert.ok(!chat.some((m) => /ShareCoin|short|enough|need/i.test(m.content)), "no chat line mentions it");
  await setCoins(requesterId, 100);
});

test("once the payer can afford it again, the blocked person is told it can be accepted, once, with no reason", async () => {
  const swap = await pendingSwap(3, 2);
  await setCoins(requesterId, 3);
  assert.equal((await owner.patch(`/api/requests/${swap.id}`, { status: "ACCEPTED" })).status, 409);

  await notifyUnblockedRequests();
  assert.deepEqual((await notesFor(ownerId, swap.id)).filter((n) => n.type === "request_acceptable"), [], "still short: nothing yet");

  await setCoins(requesterId, 50);
  assert.ok((await notifyUnblockedRequests()) >= 1);
  const ready = (await notesFor(ownerId, swap.id)).filter((n) => n.type === "request_acceptable");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].message, `You can now accept the request for "${swap.ownerItem.name}".`);
  assert.doesNotMatch(`${ready[0].title} ${ready[0].message}`.replace(swap.ownerItem.name, ""), /ShareCoin|requester|payer|short|balance|\d/i);
  await notifyUnblockedRequests();
  assert.equal((await notesFor(ownerId, swap.id)).filter((n) => n.type === "request_acceptable").length, 1, "not repeated");

  const accepted = await owner.patch(`/api/requests/${swap.id}`, { status: "ACCEPTED" });
  assert.equal(accepted.status, 200, "and now it can be");
  await setCoins(requesterId, 100);
});

test("a borrow the borrower cannot afford: the owner gets the neutral answer (not 'the borrower needs N'), the borrower the nudge", async () => {
  const borrow = await pendingBorrow(); // 14 SC a week, 7 days: 14
  await setCoins(requesterId, 5);
  const response = await owner.patch(`/api/requests/${borrow.id}`, { status: "ACCEPTED" });
  assert.equal(response.status, 409);
  assert.deepEqual(response.json, { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE });
  const nudge = (await notesFor(requesterId, borrow.id)).find((n) => n.type === "sharecoin_needed");
  assert.equal(nudge?.message, `You need 14 ShareCoins to continue with "${borrow.item.name}".`);

  await setCoins(requesterId, 14);
  assert.equal((await owner.patch(`/api/requests/${borrow.id}`, { status: "ACCEPTED" })).status, 200);
  await setCoins(requesterId, 100);
});

// ── Counters ──────────────────────────────────────────────────────────────────────

test("accepting a counter: the payer is checked whoever accepts (the gap that existed before)", async () => {
  // The owner countered a swap of equal items with a better one of theirs (20 against the requester's 10): the requester pays 10.
  const swap = await pendingSwap(2, 2);
  const mid = await newItem(ownerId, 3);
  await db.update(itemRequests).set({
    negotiationStatus: "counter_proposed", counterProposedBy: ownerId, counterRound: 1,
    counterSwapOwnerItemIds: [mid.id], counterSwapRequesterItemIds: [swap.requesterItem.id],
  } as any).where(eq(itemRequests.id, swap.id));

  await setCoins(requesterId, 2);
  const requesterAccepts = await requester.post(`/api/requests/${swap.id}/respond-to-counter`, { accept: true });
  assert.equal(requesterAccepts.status, 402, "the requester would pay 10 and has 2");
  assert.equal(requesterAccepts.json.code, "INSUFFICIENT_SHARECOINS");
  assert.equal(await requestStatus(swap.id), "PENDING");

  // The other way round: the requester countered, the owner accepts, and the requester is the payer and short.
  await db.update(itemRequests).set({ counterProposedBy: requesterId } as any).where(eq(itemRequests.id, swap.id));
  const ownerAccepts = await owner.post(`/api/requests/${swap.id}/respond-to-counter`, { accept: true });
  assert.equal(ownerAccepts.status, 409);
  assert.deepEqual(ownerAccepts.json, { code: REQUEST_NOT_ACCEPTABLE_NOW_CODE, error: REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE });
  assert.equal((await notesFor(requesterId, swap.id)).filter((n) => n.type === "sharecoin_needed").length, 1);
  assert.equal(await requestStatus(swap.id), "PENDING");

  await setCoins(requesterId, 100);
  assert.equal((await owner.post(`/api/requests/${swap.id}/respond-to-counter`, { accept: true })).status, 200);
});

test("sending a counter: blocked for the sender if they would pay under it, allowed if the other person would", async () => {
  const swap = await pendingSwap(2, 2);
  const cheap = await newItem(ownerId, 1); // owner side 5 vs requester 10: the owner pays 5
  const rich = await newItem(ownerId, 3); // owner side 20 vs requester 10: the requester pays 10

  await setCoins(ownerId, 1);
  const blocked = await owner.post(`/api/requests/${swap.id}/counter-proposal`, { swapOwnerItemIds: [cheap.id], swapRequesterItemIds: [swap.requesterItem.id] });
  assert.equal(blocked.status, 402, "the owner would pay 5 and has 1");
  assert.equal(blocked.json.required, 5);
  assert.equal(blocked.json.available, 1);

  await setCoins(requesterId, 0);
  const sent = await owner.post(`/api/requests/${swap.id}/counter-proposal`, { swapOwnerItemIds: [rich.id], swapRequesterItemIds: [swap.requesterItem.id] });
  assert.equal(sent.status, 200, "the requester would pay but the owner may still propose it");
  assert.doesNotMatch(sent.text, /INSUFFICIENT|not enough|balance|shortfall/i);
  await setCoins(ownerId, 100);
  await setCoins(requesterId, 100);
});
