import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, requestRefunds, shareCoinHolds, shareCoinsTransactions, users,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureCancellationRecord, ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";
import { placeHold, quoteInputFromRows, quoteRequest, totalBalance } from "./sharecoin-funds.js";
import { ITEM_NO_LONGER_AVAILABLE_MESSAGE } from "./item-availability.js";

// The admin queue of exchanges waiting for a decision (disputes and flagged exchanges, oldest first, with both people's
// messages and proof) and the two decisions: for the owner (the handoff stands, the hold settles) or for the requester (it
// did not happen, the hold is released with the dispute or flag_rejected reason). Both people are told either way.

const UNIQUE = `admin-queue-${Date.now()}`;
const PASSWORD = "AdminQueue!42";
const DAY = 24 * 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
const stripe = fakeStripe({ refundIdPrefix: `re_${UNIQUE}_` });
let baseUrl: string;
let closeServer: () => Promise<void>;
let admin: TestClient;
let plain: TestClient;
let ownerId: number;
let requesterId: number;
let otherId: number;
let counter = 0;

class TestClient {
  private cookies = new Map<string, string>();
  private csrfToken = "";
  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("content-type", "application/json");
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies.entries()].map(([n, v]) => `${n}=${v}`).join("; "));
    if (this.csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", this.csrfToken);
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const separator = pair.indexOf("=");
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
  queue() { return this.request("/api/admin/handoff-disputes"); }
  decide(id: number, decision: string) { return this.request(`/api/admin/handoff-disputes/${id}/resolve`, { method: "POST", body: JSON.stringify({ decision }) }); }
  async login(username: string) {
    assert.equal((await this.request("/api/login", { method: "POST", body: JSON.stringify({ username, password: PASSWORD }) })).status, 200);
    this.csrfToken = ((await (await this.request("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
  }
}

async function newItem(by: number, tier: number, extra: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId: by, name: `${UNIQUE}-item-${++counter}`, description: "x", conditionRating: 4, photos: [], isAvailable: true, isSwappable: true, isLendable: true,
    isGift: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier, ...extra,
  } as typeof items.$inferInsert).returning({ id: items.id, name: items.name });
  itemIds.push(item.id);
  return item;
}

/** An exchange waiting for a decision, with its coins held as accepting would have left them. */
async function waiting(requestType: "SWAP" | "BORROW", status: "HANDOFF_DISPUTED" | "HANDOFF_FLAGGED", fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const ownerItem = await newItem(ownerId, requestType === "SWAP" ? 1 : 2);
  const requesterItem = requestType === "SWAP" ? await newItem(requesterId, 3) : null;
  const [request] = await db.insert(itemRequests).values({
    itemId: ownerItem.id, requesterId, requestType, status, ownerConfirmedHandoff: true, borrowerDeniedHandoff: true,
    ...(requestType === "SWAP" ? { swapOfferedItemIds: [requesterItem!.id] } : { startDate: new Date(Date.now() + 5 * DAY), endDate: new Date(Date.now() + 12 * DAY), depositMethod: "in_person" }),
    ...fields,
  } as typeof itemRequests.$inferInsert).returning();
  requestIds.push(request.id);
  const [row] = await db.select().from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(eq(itemRequests.id, request.id));
  const quote = await quoteRequest(quoteInputFromRows(row.item_requests, row.items));
  assert.ok((await db.transaction((tx) => placeHold(tx, request.id, quote))).ok);
  return { id: request.id, ownerItem, requesterItem };
}

const holdsOf = (id: number) => db.select().from(shareCoinHolds).where(eq(shareCoinHolds.requestId, id));
const statusOf = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const setCoins = async (id: number, amount: number) => {
  await db.delete(shareCoinHolds).where(eq(shareCoinHolds.payerId, id));
  await db.update(users).set({ shareCoins: `${amount}.00` }).where(eq(users.id, id));
};
const told = (userId: number, requestId: number) =>
  db.select().from(notifications).where(eq(notifications.requestId, requestId)).then((rows) => rows.filter((n) => n.userId === userId && n.type === "dispute_resolved"));

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  await ensureCancellationRecord();
  const password = await hashPassword(PASSWORD);
  const created = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Olwen Owner", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-requester`, displayName: "Rhys Requester", password, emailVerified: true, shareCoins: "100.00", subscriptionTier: "member" },
    { username: `${UNIQUE}-admin`, password, emailVerified: true, isAdmin: true },
    { username: `${UNIQUE}-plain`, password, emailVerified: true },
    { username: `${UNIQUE}-other`, password, emailVerified: true },
  ]).returning({ id: users.id, username: users.username });
  userIds.push(...created.map((u) => u.id));
  [ownerId, requesterId, , , otherId] = created.map((u) => u.id);

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false, stripe: stripe.client as any });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  admin = new TestClient();
  plain = new TestClient();
  await admin.login(created[2].username);
  await plain.login(created[3].username);
});

after(async () => {
  try {
    const created = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const all = [...new Set([...requestIds, ...created.map((r) => r.id)])];
    if (all.length) {
      await db.delete(requestRefunds).where(inArray(requestRefunds.requestId, all));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, all));
      await db.delete(messages).where(inArray(messages.requestId, all));
      await db.delete(notifications).where(inArray(notifications.requestId, all));
      await db.delete(shareCoinHolds).where(inArray(shareCoinHolds.requestId, all));
      await db.delete(itemRequests).where(inArray(itemRequests.id, all));
    }
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});

test("the queue is for admins only", async () => {
  assert.equal((await plain.queue()).status, 403);
});

test("the queue lists disputes and flagged exchanges, oldest first, with both people's messages, proof and the held coins", async () => {
  const newer = await waiting("SWAP", "HANDOFF_DISPUTED", { handoffDisputeAt: new Date(Date.now() - 1 * DAY), handoffProofOwner: "photo of the swap", handoffProofBorrower: "I was never there" });
  const oldest = await waiting("SWAP", "HANDOFF_FLAGGED", { handoffConfirmDeadline: new Date(Date.now() - 3 * DAY) });
  const middle = await waiting("BORROW", "HANDOFF_DISPUTED", { handoffDisputeAt: new Date(Date.now() - 2 * DAY) });
  const notWaiting = await waiting("BORROW", "HANDOFF_DISPUTED");
  await db.update(itemRequests).set({ status: "IN_PROGRESS" }).where(eq(itemRequests.id, notWaiting.id));
  await db.insert(messages).values([
    { senderId: ownerId, receiverId: requesterId, requestId: newer.id, content: "I handed it over at noon", messageType: "text" },
    { senderId: requesterId, receiverId: ownerId, requestId: newer.id, content: "No you did not", messageType: "text" },
    { senderId: ownerId, receiverId: requesterId, requestId: newer.id, content: "system line", messageType: "system" },
  ] as any);

  const response = await admin.queue();
  assert.equal(response.status, 200);
  const rows = (await response.json()) as any[];
  const mine = rows.filter((r) => [newer.id, oldest.id, middle.id, notWaiting.id].includes(r.id));
  assert.deepEqual(mine.map((r) => r.id), [oldest.id, middle.id, newer.id], "oldest first; an exchange that is not waiting is not listed");
  assert.deepEqual(mine.map((r) => r.kind), ["flagged", "dispute", "dispute"]);

  const row = mine[2];
  assert.deepEqual([row.owner.name, row.requester.name], ["Olwen Owner", "Rhys Requester"]);
  assert.deepEqual(row.proof, { owner: "photo of the swap", requester: "I was never there" });
  assert.deepEqual(row.messages.filter((m: any) => m.type === "text").map((m: any) => [m.from, m.content]), [["owner", "I handed it over at noon"], ["requester", "No you did not"]]);
  assert.equal(row.messages.length, 3, "system lines are shown too");
  assert.deepEqual(row.held, { amount: 15, kind: "SWAP", payer: "owner" });
  assert.equal(row.ownerConfirmed, true);
  assert.equal(row.requesterDenied, true);
});

test("deciding for the owner settles the hold and completes a flagged swap; the other requests for its items are declined; both are told", async () => {
  await setCoins(ownerId, 100);
  await setCoins(requesterId, 100);
  const swap = await waiting("SWAP", "HANDOFF_FLAGGED", { handoffConfirmDeadline: new Date(Date.now() - 1 * DAY) });
  const [bystander] = await db.insert(itemRequests).values({ itemId: swap.ownerItem.id, requesterId: otherId, requestType: "GIFT", status: "PENDING" } as any).returning({ id: itemRequests.id });
  requestIds.push(bystander.id);

  const response = await admin.decide(swap.id, "owner");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await statusOf(swap.id), "COMPLETED");
  assert.deepEqual((await holdsOf(swap.id)).map((h) => [h.status, h.reason]), [["SETTLED", "dispute_settled"]]);
  assert.equal(await totalBalance(ownerId), 85, "the owner paid the held 15");
  assert.equal(await totalBalance(requesterId), 115);
  const [moved] = await db.select({ swapped: items.isSwapped, available: items.isAvailable }).from(items).where(eq(items.id, swap.ownerItem.id));
  assert.deepEqual([moved.swapped, moved.available], [true, false]);
  assert.equal(await statusOf(bystander.id), "DECLINED");
  assert.equal((await db.select().from(notifications).where(eq(notifications.requestId, bystander.id))).find((n) => n.type === "request_declined")?.message, ITEM_NO_LONGER_AVAILABLE_MESSAGE);
  assert.equal((await told(ownerId, swap.id)).length, 1);
  assert.equal((await told(requesterId, swap.id)).length, 1);

  const rows = (await (await admin.queue()).json()) as any[];
  assert.ok(!rows.some((r) => r.id === swap.id), "decided, so no longer in the queue");
  assert.equal((await admin.decide(swap.id, "owner")).status, 200, "repeating the same decision is answered as already decided");
});

test("deciding for the requester releases a flagged exchange's hold as flag_rejected and cancels it; both are told", async () => {
  await setCoins(ownerId, 100);
  await setCoins(requesterId, 100);
  const swap = await waiting("SWAP", "HANDOFF_FLAGGED", { handoffConfirmDeadline: new Date(Date.now() - 1 * DAY) });
  const response = await admin.decide(swap.id, "requester");
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(await statusOf(swap.id), "CANCELLED");
  assert.deepEqual((await holdsOf(swap.id)).map((h) => [h.status, h.reason]), [["RELEASED", "flag_rejected"]]);
  assert.equal(await totalBalance(ownerId), 100);
  assert.equal(await totalBalance(requesterId), 100);
  const [freed] = await db.select({ available: items.isAvailable }).from(items).where(eq(items.id, swap.ownerItem.id));
  assert.equal(freed.available, true);
  assert.equal((await told(ownerId, swap.id)).length, 1);
  assert.equal((await told(requesterId, swap.id)).length, 1);
});

test("a disputed borrow: for the owner the hold settles (dispute_settled), for the requester it is released (dispute_released)", async () => {
  await setCoins(ownerId, 0);
  await setCoins(requesterId, 100);
  const forOwner = await waiting("BORROW", "HANDOFF_DISPUTED", { handoffDisputeAt: new Date() });
  assert.equal((await admin.decide(forOwner.id, "owner")).status, 200);
  assert.equal(await statusOf(forOwner.id), "IN_PROGRESS");
  assert.deepEqual((await holdsOf(forOwner.id)).map((h) => [h.status, h.reason]), [["SETTLED", "dispute_settled"]]);
  assert.equal(await totalBalance(requesterId), 86);
  assert.equal(await totalBalance(ownerId), 14);
  const [after] = await db.select({ charged: itemRequests.shareCoinsCharged, started: itemRequests.borrowPeriodStartedAt, confirmed: itemRequests.handoffConfirmedAt }).from(itemRequests).where(eq(itemRequests.id, forOwner.id));
  assert.deepEqual([after.charged, Boolean(after.started), Boolean(after.confirmed)], [true, true, true], "a handoff that was never confirmed gets the fields the handoff sets");

  const forRequester = await waiting("BORROW", "HANDOFF_DISPUTED", { handoffDisputeAt: new Date() });
  assert.equal((await admin.decide(forRequester.id, "borrower")).status, 200);
  assert.equal(await statusOf(forRequester.id), "CANCELLED");
  assert.deepEqual((await holdsOf(forRequester.id)).map((h) => [h.status, h.reason]), [["RELEASED", "dispute_released"]]);
  assert.equal(await totalBalance(requesterId), 86, "no further coins moved");
  assert.equal((await told(ownerId, forRequester.id)).length, 1);
  assert.equal((await told(requesterId, forRequester.id)).length, 1);
});

test("a flagged borrow decided for the owner goes on; an unknown decision, or a request that is not waiting, is refused", async () => {
  await setCoins(ownerId, 0);
  await setCoins(requesterId, 100);
  const flagged = await waiting("BORROW", "HANDOFF_FLAGGED", { handoffConfirmDeadline: new Date(Date.now() - 3_600_000) });
  assert.equal((await admin.decide(flagged.id, "maybe")).status, 400);
  assert.equal((await admin.decide(flagged.id, "owner")).status, 200);
  assert.equal(await statusOf(flagged.id), "IN_PROGRESS");
  assert.deepEqual((await holdsOf(flagged.id)).map((h) => h.status), ["SETTLED"]);
  assert.equal(await totalBalance(ownerId), 14);
  assert.equal((await admin.decide(flagged.id, "requester")).status === 200, false, "already decided: the other decision is refused");
});
