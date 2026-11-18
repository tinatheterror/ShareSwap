import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, shareCoinHolds, shareCoinsTransactions, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { processHandoffDeadlines } from "./handoff-deadline-service.js";
import { resolveHandoffDispute } from "./handoff-dispute-service.js";
import {
  REQUEST_NOT_ACCEPTABLE_NOW_CODE,
  activeHoldFor,
  cancelAcceptedRequestsWithoutHolds,
  placeHold,
  quoteInputFromRows,
  quoteRequest,
  releaseHoldsOfEndedRequests,
  reservedBalance,
  settleRequestCoins,
  spendableBalance,
  totalBalance,
} from "./sharecoin-funds.js";

// Phase 2 of docs/sharecoin-funds-design.md: accepting reserves what the payer will owe (a hold), under a lock on the payer's
// row; every spend checks the balance minus holds; the handoff settles the hold exactly; every other ending releases it.

const UNIQUE = `holds-${Date.now()}`;
const PASSWORD = "HoldsGate!42";
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

// Each test sets the balance it means to spend, so any holds left by earlier tests go too.
const setCoins = async (id: number, amount: number) => {
  await db.delete(shareCoinHolds).where(eq(shareCoinHolds.payerId, id));
  await db.update(users).set({ shareCoins: `${amount}.00` }).where(eq(users.id, id));
};

// Accepting several swaps between the same two people trips the anti-farming cooldown, which is not what these tests are about.
const clearCooldowns = () => pool.query("DELETE FROM swap_cooldowns WHERE user_id_1 = ANY($1) OR user_id_2 = ANY($1)", [userIds]);
const accept = async (id: number) => {
  await clearCooldowns();
  return owner.patch(`/api/requests/${id}`, { status: "ACCEPTED" });
};

async function newItem(ownerOfItem: number, tier: number, extra: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId: ownerOfItem, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isSwappable: true, isLendable: true, isAvailable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "14.00", tier,
    ...extra,
  } as typeof items.$inferInsert).returning({ id: items.id, name: items.name });
  itemIds.push(item.id);
  return item;
}

/** A pending swap on the owner's item: the owner pays when the owner's tier is below the requester's. */
async function pendingSwap(ownerTier: number, requesterTier: number, fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const ownerItem = await newItem(ownerId, ownerTier);
  const requesterItem = await newItem(requesterId, requesterTier);
  const [request] = await db.insert(itemRequests).values({
    itemId: ownerItem.id, requesterId, requestType: "SWAP", status: "PENDING", swapOfferedItemIds: [requesterItem.id], ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, ownerItem, requesterItem };
}

/** A pending borrow of 7 days of a 14 SC a week item: 14 SC, paid by the requester. */
async function pendingBorrow(fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const item = await newItem(ownerId, 2, { shareCoinPrice: "14.00" });
  const start = new Date(Date.now() + 10 * 24 * 3_600_000);
  const end = new Date(start.getTime() + 7 * 24 * 3_600_000);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId, requestType: "BORROW", status: "PENDING", startDate: start, endDate: end, depositMethod: "in_person", ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, item };
}

const requestStatus = async (id: number) => (await db.select({ s: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id)))[0].s;
const holdsOf = (requestId: number) => db.select().from(shareCoinHolds).where(eq(shareCoinHolds.requestId, requestId));
const ledgerRows = (id: number) => db.select().from(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, id));
const loadRequest = async (id: number) => {
  const [row] = await db.select().from(itemRequests).innerJoin(items, eq(items.id, itemRequests.itemId)).where(eq(itemRequests.id, id));
  return row;
};

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, r] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Hollis Owner", password, emailVerified: true, shareCoins: "100.00" },
    { username: `${UNIQUE}-requester`, displayName: "Harper Requester", password, emailVerified: true, shareCoins: "100.00" },
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
    const created = itemIds.length ? await db.select({ id: itemRequests.id }).from(itemRequests).where(inArray(itemRequests.itemId, itemIds)) : [];
    const all = [...new Set([...requestIds, ...created.map((r) => r.id)])];
    if (all.length) {
      await pool.query("DELETE FROM delivery_arrangements WHERE request_id = ANY($1)", [all]);
      await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [all]);
      await pool.query("DELETE FROM refund_ledger WHERE request_id = ANY($1)", [all]).catch(() => {});
      await pool.query("DELETE FROM security_claims WHERE request_id = ANY($1)", [all]).catch(() => {});
      await db.delete(messages).where(inArray(messages.requestId, all));
      await db.delete(notifications).where(inArray(notifications.requestId, all));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, all));
      await db.delete(itemRequests).where(inArray(itemRequests.id, all)); // its holds go with it
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

// ── Accepting reserves ────────────────────────────────────────────────────────────

test("accepting a borrow reserves the quoted coins on the borrower: balance unchanged, spendable lower, the quote stored", async () => {
  await setCoins(requesterId, 30);
  const borrow = await pendingBorrow();
  const response = await accept(borrow.id);
  assert.equal(response.status, 200, response.text.slice(0, 200));

  const [hold] = await holdsOf(borrow.id);
  assert.deepEqual(
    [hold.kind, hold.amount, hold.payerId, hold.receiverId, hold.status, hold.reason],
    ["BORROW", 14, requesterId, ownerId, "ACTIVE", null],
  );
  assert.equal(await totalBalance(requesterId), 30, "nothing was spent yet");
  assert.equal(await reservedBalance(requesterId), 14);
  assert.equal(await spendableBalance(requesterId), 16);
  await setCoins(requesterId, 100);
});

test("accepting a swap reserves the difference on the side that pays, and accepting a counter does the same on the final terms", async () => {
  await setCoins(ownerId, 100);
  const swap = await pendingSwap(1, 3); // the owner pays 15
  assert.equal((await accept(swap.id)).status, 200);
  const [hold] = await holdsOf(swap.id);
  assert.deepEqual([hold.kind, hold.amount, hold.payerId, hold.receiverId], ["SWAP", 15, ownerId, requesterId]);
  assert.equal(await spendableBalance(ownerId), 85);

  // An accepted counter: the owner countered a swap of equals with a better item of theirs, so the requester pays 10.
  const counterSwap = await pendingSwap(2, 2);
  const better = await newItem(ownerId, 3);
  await db.update(itemRequests).set({
    negotiationStatus: "counter_proposed", counterProposedBy: ownerId, counterRound: 1,
    counterSwapOwnerItemIds: [better.id], counterSwapRequesterItemIds: [counterSwap.requesterItem.id],
  } as any).where(eq(itemRequests.id, counterSwap.id));
  assert.equal((await requester.post(`/api/requests/${counterSwap.id}/respond-to-counter`, { accept: true })).status, 200);
  const [counterHold] = await holdsOf(counterSwap.id);
  assert.deepEqual([counterHold.amount, counterHold.payerId, counterHold.receiverId], [10, requesterId, ownerId]);
});

test("requests that move no coins (a rental, a gift, a fair swap, a pending request) hold nothing", async () => {
  const fair = await pendingSwap(2, 2);
  assert.equal((await accept(fair.id)).status, 200);
  assert.deepEqual(await holdsOf(fair.id), []);

  const rentItem = await newItem(ownerId, 2, { isRentable: true, rentalPrice: "10.00" } as any);
  const [rental] = await db.insert(itemRequests).values({
    itemId: rentItem.id, requesterId, requestType: "RENT", status: "PENDING",
    startDate: new Date(Date.now() + 10 * 24 * 3_600_000), endDate: new Date(Date.now() + 12 * 24 * 3_600_000),
  } as any).returning({ id: itemRequests.id });
  requestIds.push(rental.id);
  assert.equal((await accept(rental.id)).status, 200);
  assert.deepEqual(await holdsOf(rental.id), [], "rentals are paid in money: no ShareCoins are held");

  const pending = await pendingBorrow();
  assert.deepEqual(await holdsOf(pending.id), [], "a request nobody has accepted holds nothing");
});

test("every spend checks the balance minus holds: with coins reserved the payer is refused what only their whole balance could cover", async () => {
  await setCoins(requesterId, 20);
  const first = await pendingBorrow();
  assert.equal((await accept(first.id)).status, 200); // 14 reserved, 6 spendable

  // Sending a swap the requester would pay 10 for, as the payer: the modal, with their own spendable figure and what is reserved.
  const listed = await newItem(ownerId, 3); // 20
  const mine = await newItem(requesterId, 2); // 10
  const sent = await requester.post(`/api/items/${listed.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [mine.id] });
  assert.equal(sent.status, 402, sent.text.slice(0, 300));
  assert.equal(sent.json.code, "INSUFFICIENT_SHARECOINS");
  assert.deepEqual([sent.json.required, sent.json.available, sent.json.reserved], [10, 6, 14]);

  // Accepting another one for them: the owner gets only the neutral answer and no hold is made.
  const second = await pendingBorrow();
  const refused = await accept(second.id);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.code, REQUEST_NOT_ACCEPTABLE_NOW_CODE);
  assert.equal(await requestStatus(second.id), "PENDING");
  assert.deepEqual(await holdsOf(second.id), []);
  await setCoins(requesterId, 100);
});

// ── Two simultaneous accepts against one payer ────────────────────────────────────

test("two simultaneous accepts that together need more than the BORROWER has: exactly one succeeds, one hold", async () => {
  for (let round = 0; round < 3; round++) {
    await setCoins(requesterId, 20); // each borrow is 14
    const a = await pendingBorrow();
    const b = await pendingBorrow();
    const [ra, rb] = await Promise.all([
      accept(a.id),
      accept(b.id),
    ]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409], `round ${round}: ${ra.status} ${rb.status}`);
    const loser = ra.status === 409 ? ra : rb;
    assert.equal(loser.json.code, REQUEST_NOT_ACCEPTABLE_NOW_CODE, "the accepter only ever sees the neutral answer");
    const held = [...(await holdsOf(a.id)), ...(await holdsOf(b.id))];
    assert.equal(held.length, 1);
    assert.equal(await spendableBalance(requesterId), 6);
    assert.ok(await requestStatus(ra.status === 200 ? b.id : a.id) === "PENDING", "the refused request stayed pending");
  }
  await setCoins(requesterId, 100);
});

test("two simultaneous accepts that together need more than the OWNER has (the owner pays both swaps): one succeeds, the other gets the modal", async () => {
  await setCoins(ownerId, 20); // each swap costs the owner 15
  const a = await pendingSwap(1, 3);
  const b = await pendingSwap(1, 3);
  const [ra, rb] = await Promise.all([
    accept(a.id),
    accept(b.id),
  ]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 402]);
  const loser = ra.status === 402 ? ra : rb;
  assert.equal(loser.json.code, "INSUFFICIENT_SHARECOINS");
  assert.equal(loser.json.available, 5);
  assert.equal([...(await holdsOf(a.id)), ...(await holdsOf(b.id))].length, 1);
  await setCoins(ownerId, 100);
});

// ── Settling at the handoff ───────────────────────────────────────────────────────

test("the handoff settles a swap's hold: exactly the held amount moves, the hold is SETTLED, and nothing is created or lost", async () => {
  await setCoins(ownerId, 100);
  await setCoins(requesterId, 100);
  const swap = await pendingSwap(1, 3); // the owner pays 15
  assert.equal((await accept(swap.id)).status, 200);
  const ownerBefore = (await ledgerRows(ownerId)).length;

  assert.equal((await owner.post(`/api/requests/${swap.id}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await requester.post(`/api/requests/${swap.id}/handoff`, { confirmedBy: "borrower" })).status, 200);

  const [hold] = await holdsOf(swap.id);
  assert.deepEqual([hold.status, hold.reason], ["SETTLED", "handoff_manual"]);
  const paid = (await ledgerRows(ownerId)).filter((t) => t.transactionType === "SWAP_OFFSET_PAID");
  const received = (await ledgerRows(requesterId)).filter((t) => t.transactionType === "SWAP_OFFSET_RECEIVED");
  assert.deepEqual([paid.length, Number(paid[0].amount)], [1, -15]);
  assert.deepEqual([received.length, Number(received[0].amount)], [1, 15]);
  assert.ok((await ledgerRows(ownerId)).length > ownerBefore);
  assert.equal(await reservedBalance(ownerId), 0, "nothing is reserved any more");
});

test("an auto-confirmed borrow settles its hold and charges the borrower in full, even if their other holds used up the rest", async () => {
  await setCoins(requesterId, 14); // exactly the borrow's price, and all of it is reserved once accepted
  await setCoins(ownerId, 0);
  const borrow = await pendingBorrow();
  assert.equal((await accept(borrow.id)).status, 200);
  assert.equal(await spendableBalance(requesterId), 0);

  // One person confirmed and the other stayed silent past the window.
  await db.update(itemRequests).set({
    status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true, borrowerConfirmedHandoff: false,
    handoffConfirmDeadline: new Date(Date.now() - 3_600_000),
  } as any).where(eq(itemRequests.id, borrow.id));
  const result = await processHandoffDeadlines({ onSwapAutoConfirmed: async () => {}, onGiftAutoConfirmed: async () => {} }, { onlyRequestIds: [borrow.id] });
  assert.equal(result.autoAdvancedCount, 1);

  assert.equal(await requestStatus(borrow.id), "IN_PROGRESS");
  const [hold] = await holdsOf(borrow.id);
  assert.deepEqual([hold.status, hold.reason], ["SETTLED", "handoff_auto"]);
  assert.equal(await totalBalance(requesterId), 0, "charged the whole 14");
  assert.equal(await totalBalance(ownerId), 14, "the lender got exactly what the borrower paid");
  const charge = (await ledgerRows(requesterId)).find((t) => t.transactionType === "BORROW_CHARGE");
  assert.equal(Number(charge?.amount), -14);
  await setCoins(requesterId, 100);
  await setCoins(ownerId, 100);
});

test("a request from before holds (nothing held) settles the old way, limited to what the payer can spend without touching other holds", async () => {
  await setCoins(requesterId, 20);
  const held = await pendingBorrow();
  assert.equal((await accept(held.id)).status, 200); // 14 reserved, 6 spendable
  const legacy = await pendingBorrow({ status: "ACCEPTED" } as any); // accepted straight in the database: no hold

  const row = await loadRequest(legacy.id);
  const quote = await quoteRequest(quoteInputFromRows(row.item_requests, row.items));
  assert.equal(quote?.amount, 14);
  const settled = await db.transaction((tx) => settleRequestCoins(tx, { requestId: legacy.id, reason: "handoff_manual", itemName: "x", fallbackQuote: quote }));
  assert.equal(settled.paid, 6, "only the 6 that nothing else holds");
  assert.equal(await totalBalance(requesterId), 14, "the 14 held for the other borrow is intact");
  assert.equal(await spendableBalance(requesterId), 0);
  await setCoins(requesterId, 100);
});

// ── Releasing ─────────────────────────────────────────────────────────────────────

test("cancelling a borrow or a swap releases its hold, with the reason", async () => {
  await setCoins(requesterId, 100);
  await setCoins(ownerId, 100);
  const borrow = await pendingBorrow();
  assert.equal((await accept(borrow.id)).status, 200);
  assert.equal(await reservedBalance(requesterId), 14);
  const cancelled = await requester.post(`/api/requests/${borrow.id}/cancel`, { reason: "changed_plans", acknowledgePenalty: true });
  assert.equal(cancelled.status, 200, cancelled.text.slice(0, 300));
  assert.deepEqual((await holdsOf(borrow.id)).map((h) => [h.status, h.reason]), [["RELEASED", "cancelled"]]);
  assert.equal(await reservedBalance(requesterId), 0);

  const swap = await pendingSwap(1, 3);
  assert.equal((await accept(swap.id)).status, 200);
  assert.equal(await reservedBalance(ownerId), 15);
  assert.equal((await requester.post(`/api/requests/${swap.id}/cancel`, { reason: "changed_plans" })).status, 200);
  assert.deepEqual((await holdsOf(swap.id)).map((h) => [h.status, h.reason]), [["RELEASED", "cancelled"]]);
  assert.equal(await spendableBalance(ownerId), 100);
});

test("the deposit timeout releases the hold of a borrow whose in-app deposit was never paid", async () => {
  await setCoins(requesterId, 100);
  const borrow = await pendingBorrow({ depositMethod: "in_app" } as any);
  assert.equal((await accept(borrow.id)).status, 200);
  assert.equal(await reservedBalance(requesterId), 14);
  await db.update(itemRequests).set({ acceptedAt: new Date(Date.now() - 3 * 24 * 3_600_000) }).where(eq(itemRequests.id, borrow.id));
  const result = await processHandoffDeadlines({ onSwapAutoConfirmed: async () => {}, onGiftAutoConfirmed: async () => {} }, { onlyRequestIds: [borrow.id] });
  assert.equal(result.depositExpiredCount, 1);
  assert.equal(await requestStatus(borrow.id), "CANCELLED");
  assert.deepEqual((await holdsOf(borrow.id)).map((h) => [h.status, h.reason]), [["RELEASED", "deposit_timeout"]]);
  assert.equal(await reservedBalance(requesterId), 0);
});

test("a hold on a request that ended without releasing it reserves nothing, and the sweep tidies it", async () => {
  await setCoins(requesterId, 50);
  const borrow = await pendingBorrow();
  assert.equal((await accept(borrow.id)).status, 200);
  assert.equal(await spendableBalance(requesterId), 36);
  await db.update(itemRequests).set({ status: "EXPIRED" }).where(eq(itemRequests.id, borrow.id)); // an ending that forgot to release
  assert.equal(await spendableBalance(requesterId), 50, "already not counted");
  assert.ok((await releaseHoldsOfEndedRequests()) >= 1);
  assert.deepEqual((await holdsOf(borrow.id)).map((h) => [h.status, h.reason]), [["RELEASED", "expired"]]);
  await setCoins(requesterId, 100);
});

// ── Disputes ──────────────────────────────────────────────────────────────────────

async function disputedBorrow() {
  const borrow = await pendingBorrow({ status: "HANDOFF_DISPUTED" } as any);
  const row = await loadRequest(borrow.id);
  const quote = await quoteRequest(quoteInputFromRows(row.item_requests, row.items));
  const placed = await db.transaction((tx) => placeHold(tx, borrow.id, quote));
  assert.ok(placed.ok);
  return borrow;
}

test("a dispute keeps the hold while it is open; the handoff standing settles it", async () => {
  await setCoins(requesterId, 40);
  await setCoins(ownerId, 0);
  const borrow = await disputedBorrow();
  assert.equal((await activeHoldFor(borrow.id))?.amount, 14, "still held while the dispute is open");
  assert.equal(await spendableBalance(requesterId), 26);

  const result = await resolveHandoffDispute({ requestId: borrow.id, decision: "owner", adminId: null, stripe: {} as any });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual((await holdsOf(borrow.id)).map((h) => [h.status, h.reason]), [["SETTLED", "dispute_settled"]]);
  assert.equal(await totalBalance(requesterId), 26);
  assert.equal(await totalBalance(ownerId), 14);
  await setCoins(requesterId, 100);
  await setCoins(ownerId, 100);
});

test("a dispute decided for the borrower (the handoff did not happen) releases the hold and moves no coins", async () => {
  await setCoins(requesterId, 40);
  const borrow = await disputedBorrow();
  const result = await resolveHandoffDispute({ requestId: borrow.id, decision: "borrower", adminId: null, stripe: { paymentIntents: {}, refunds: {} } as any });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(await requestStatus(borrow.id), "CANCELLED");
  assert.deepEqual((await holdsOf(borrow.id)).map((h) => [h.status, h.reason]), [["RELEASED", "dispute_released"]]);
  assert.equal(await totalBalance(requesterId), 40, "nothing moved");
  assert.equal(await spendableBalance(requesterId), 40);
  await setCoins(requesterId, 100);
});

// ── The deposit step ──────────────────────────────────────────────────────────────

test("paying the deposit for a borrow that holds nothing reserves the coins by the server's quote, or answers with the modal", async () => {
  const borrow = await pendingBorrow({ status: "ACCEPTED", depositMethod: "in_app" } as any);

  await setCoins(requesterId, 5);
  const short = await requester.post(`/api/requests/${borrow.id}/pay-deposit`, { depositAmount: 20, shareCoinAmount: 1 });
  assert.equal(short.status, 402, short.text.slice(0, 300));
  assert.deepEqual([short.json.code, short.json.required, short.json.available], ["INSUFFICIENT_SHARECOINS", 14, 5], "the client's own figure (1) is ignored");
  assert.equal(await requestStatus(borrow.id), "ACCEPTED");

  await setCoins(requesterId, 30);
  const ok = await requester.post(`/api/requests/${borrow.id}/pay-deposit`, { depositAmount: 20, shareCoinAmount: 1 });
  assert.ok([200, 400].includes(ok.status), ok.text.slice(0, 300)); // the deposit amount itself is checked after the funds
  if (ok.status === 200) {
    assert.equal((await holdsOf(borrow.id)).length, 1);
    assert.equal(Number((await db.select().from(itemRequests).where(eq(itemRequests.id, borrow.id)))[0].shareCoinAmount), 14);
  }
  await setCoins(requesterId, 100);
});

// ── From Phase 1: the maximum offset counts the owner's extra items ──────────────

test("the 20 SC maximum offset counts extra owner items the requester asked for", async () => {
  const listed = await newItem(ownerId, 3); // 20
  const extra = await newItem(ownerId, 3); // 20 more: the owner's side is 40
  const offered = await newItem(requesterId, 3); // 20: alone the swap is even, with the extra item the offset is 20 (allowed)...
  const smaller = await newItem(requesterId, 1); // 5: 40 against 5 is 35, over the limit

  const even = await requester.post(`/api/items/${listed.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [smaller.id] });
  assert.equal(even.status, 201, "the listed item alone: 20 against 5 is 15");

  const second = await newItem(ownerId, 3);
  const withExtra = await requester.post(`/api/items/${second.id}/request`, { requestType: "SWAP", swapOfferedItemIds: [smaller.id], swapRequestedItemIds: [extra.id] });
  assert.equal(withExtra.status, 400, "with the extra owner item it is 40 against 5");
  assert.equal(withExtra.json.code, "SWAP_OFFSET_TOO_LARGE");
  assert.equal(withExtra.json.offset, 35);
  assert.equal(withExtra.json.maxOffset, 20);
  void offered;
});

// ── Migration and constraints ────────────────────────────────────────────────────

test("the migration cancels accepted requests that owe coins without a hold, and leaves those that owe nothing or are held", async () => {
  await setCoins(requesterId, 100);
  const unheldBorrow = await pendingBorrow({ status: "ACCEPTED" } as any);
  const unheldSwap = await pendingSwap(1, 3, { status: "ACCEPTED" } as any);
  const fairSwap = await pendingSwap(2, 2, { status: "ACCEPTED" } as any);
  const heldBorrow = await pendingBorrow();
  assert.equal((await accept(heldBorrow.id)).status, 200);
  const rental = await pendingBorrow({ status: "ACCEPTED", requestType: "RENT" } as any);
  const charged = await pendingBorrow({ status: "DEPOSIT_CONFIRMED", shareCoinsCharged: true } as any);

  const mine = [unheldBorrow.id, unheldSwap.id, fairSwap.id, heldBorrow.id, rental.id, charged.id];
  const outcome = await cancelAcceptedRequestsWithoutHolds();
  assert.ok(outcome.cancelled.includes(unheldBorrow.id) && outcome.cancelled.includes(unheldSwap.id));
  for (const id of [fairSwap.id, heldBorrow.id, rental.id, charged.id]) assert.ok(!outcome.cancelled.includes(id), `request ${id} was left alone`);
  assert.equal(await requestStatus(unheldBorrow.id), "CANCELLED");
  assert.equal(await requestStatus(unheldSwap.id), "CANCELLED");
  assert.deepEqual([await requestStatus(fairSwap.id), await requestStatus(heldBorrow.id), await requestStatus(rental.id), await requestStatus(charged.id)], ["ACCEPTED", "DEPOSIT_CONFIRMED", "ACCEPTED", "DEPOSIT_CONFIRMED"]);
  const told = await db.select().from(notifications).where(and(inArray(notifications.requestId, mine), eq(notifications.type, "request_cancelled")));
  assert.equal(told.length, 4, "both people on each cancelled request are told");
  assert.equal((await cancelAcceptedRequestsWithoutHolds()).cancelled.filter((id) => mine.includes(id)).length, 0, "running it again changes nothing");
});

test("the table refuses a kind, a status, a reason or an amount it does not allow, and a second ACTIVE hold for one request", async () => {
  const swap = await pendingSwap(1, 3);
  const base = { requestId: swap.id, payerId: ownerId, receiverId: requesterId, kind: "SWAP", amount: 15 };
  const rejects = async (values: Record<string, unknown>, constraint: string) => {
    await assert.rejects(() => db.insert(shareCoinHolds).values({ ...base, ...values } as any), (error: any) => {
      const cause = error?.cause ?? error;
      return cause.code === "23514" || cause.code === "23505" ? cause.constraint === constraint || String(cause.message).includes(constraint) : false;
    }, constraint);
  };
  await rejects({ kind: "RENT" }, "sharecoin_holds_kind_check");
  // (a made-up status also fails the reason check, which is evaluated first; either way it is refused as a check violation)
  await assert.rejects(() => db.insert(shareCoinHolds).values({ ...base, status: "PAUSED" } as any), (error: any) => (error?.cause ?? error).code === "23514");
  await rejects({ amount: 0 }, "sharecoin_holds_amount_check");
  await rejects({ status: "RELEASED", reason: "because" }, "sharecoin_holds_reason_check");
  await rejects({ status: "SETTLED", reason: "cancelled" }, "sharecoin_holds_reason_check");
  await rejects({ status: "ACTIVE", reason: "cancelled" }, "sharecoin_holds_reason_check");
  await db.insert(shareCoinHolds).values(base as any);
  await rejects({}, "sharecoin_holds_active_request_uidx");
  // The dispute and flag reasons are allowed.
  await db.insert(shareCoinHolds).values({ ...base, status: "RELEASED", reason: "flag_rejected" } as any);
  await db.insert(shareCoinHolds).values({ ...base, status: "RELEASED", reason: "dispute_released" } as any);
  await db.insert(shareCoinHolds).values({ ...base, status: "SETTLED", reason: "dispute_settled" } as any);
});
