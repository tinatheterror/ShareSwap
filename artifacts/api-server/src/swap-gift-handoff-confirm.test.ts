import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, shareCoinsTransactions, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// The one-sided extras are off by default (handoff-flags.ts). This file tests them, so it switches them on, as an operator would.
for (const name of ["HANDOFF_AUTO_CONFIRM", "HANDOFF_FLAGGED", "HANDOFF_ONE_SIDED_DENY_WAIT", "HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW", "HANDOFF_REMINDER_2H", "HANDOFF_REMINDER_12H"]) process.env[name] = "on";

// One person confirms a swap or a gift: the other is told "[name] confirmed the [swap/gift]. Confirm, or report a
// problem within 24 hours." and has 24 hours. Both confirming completes it (a gift through the same /handoff route a
// swap uses); one reporting a problem opens a dispute; and the handoff sweep confirms it for the silent person.

const UNIQUE = `swap-gift-confirm-${Date.now()}`;
const PASSWORD = "SwapGiftConfirm!42";
const HOUR = 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let ownerId: number;
let requesterId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;
let callerCount = 0;

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

  post(path: string, body: unknown = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }
}

let owner: Client;
let requester: Client;

async function seed(requestType: "SWAP" | "GIFT", fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-${requestType}-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isSwappable: true, isGift: true, isAvailable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "7.00",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId, requestType, status: "ACCEPTED", acceptedAt: new Date(),
    ownerConfirmedHandoff: false, borrowerConfirmedHandoff: false,
    ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId: item.id };
}

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const notesFor = (id: number, userId: number) =>
  db.select().from(notifications).where(eq(notifications.requestId, id)).then((rows) => rows.filter((n) => n.userId === userId));

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, r] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Olive Owner", password, emailVerified: true },
    { username: `${UNIQUE}-requester`, displayName: "Remy Requester", password, emailVerified: true },
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
    await pool.query("DELETE FROM job_switches WHERE job_name = 'handoff-deadlines'");
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [requestIds]);
    }
    if (userIds.length) {
      await pool.query("DELETE FROM user_achievements WHERE user_id = ANY($1)", [userIds]);
      await pool.query("DELETE FROM share_coins_transactions WHERE user_id = ANY($1)", [userIds]);
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});

for (const type of ["SWAP", "GIFT"] as const) {
  const word = type === "SWAP" ? "swap" : "gift";

  test(`${type}: the first person to confirm starts the other's 24 hours and the silent person gets the notice`, async () => {
    const { id } = await seed(type);
    const before = Date.now();
    const response = await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" });
    assert.equal(response.status, 200);

    const request = await load(id);
    assert.equal(request.status, "AWAITING_HANDOFF_CONFIRM");
    assert.equal(request.ownerConfirmedHandoff, true);
    const left = request.handoffConfirmDeadline!.getTime() - before;
    assert.ok(left > 23.9 * HOUR && left < 24.1 * HOUR, `a 24 hour window, got ${left / HOUR}h`);

    const expected = `Olive Owner confirmed the ${word}. Confirm, or report a problem within 24 hours.`;
    const toRequester = (await notesFor(id, requesterId)).filter((n) => n.type === "handoff_pending");
    assert.equal(toRequester.length, 1);
    assert.equal(toRequester[0].message, expected);
    assert.deepEqual(await notesFor(id, ownerId), [], "the person who confirmed is not sent the notice");

    const chat = await db.select().from(messages).where(eq(messages.requestId, id));
    const forRequester = chat.filter((m) => (m.metadata as any)?.visibleToUserId === requesterId);
    assert.deepEqual(forRequester.map((m) => m.content), [`✅ ${expected}`]);
    assert.ok(!chat.some((m) => m.content.includes("we'll complete this automatically")), "the notice already says what happens");
  });

  test(`${type}: the other person reporting a problem opens a dispute`, async () => {
    const { id } = await seed(type);
    assert.equal((await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" })).status, 200);
    const response = await requester.post(`/api/requests/${id}/deny-handoff`);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).disputeTriggered, true);
    const request = await load(id);
    assert.equal(request.status, "HANDOFF_DISPUTED");
    assert.equal(request.borrowerDeniedHandoff, true);
  });
}

test("GIFT: both confirming through /handoff completes it, once, with the gift's rewards and messages", async () => {
  const { id, itemId } = await seed("GIFT");
  assert.equal((await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" })).status, 200);
  const response = await requester.post(`/api/requests/${id}/handoff`, { confirmedBy: "borrower" });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as any).bothConfirmed, true);

  const request = await load(id);
  assert.equal(request.status, "COMPLETED", "a gift is finished at handoff, not IN_PROGRESS");
  assert.equal(request.depositStatus, null);
  const [item] = await db.select({ isAvailable: items.isAvailable }).from(items).where(eq(items.id, itemId));
  assert.equal(item.isAvailable, false);

  const giverNotes = (await notesFor(id, ownerId)).filter((n) => n.type === "gift_completed");
  const receiverNotes = (await notesFor(id, requesterId)).filter((n) => n.type === "gift_completed");
  assert.equal(giverNotes.length, 1);
  assert.equal(receiverNotes.length, 1);
  const chat = await db.select().from(messages).where(eq(messages.requestId, id));
  assert.equal(chat.filter((m) => m.content.startsWith("🎁")).length, 1, "one completion message, not two");

  const again = await requester.post(`/api/requests/${id}/handoff`, { confirmedBy: "borrower" });
  assert.equal(again.status, 400, "a completed gift cannot be confirmed again");
  assert.equal((await notesFor(id, ownerId)).filter((n) => n.type === "gift_completed").length, 1);
});

test("GIFT: a silent receiver is confirmed for by the live handoff sweep, and the gift's rewards run once", async () => {
  const { id } = await seed("GIFT");
  assert.equal((await owner.post(`/api/requests/${id}/handoff`, { confirmedBy: "owner" })).status, 200);
  await db.update(itemRequests).set({ handoffConfirmDeadline: new Date(Date.now() - HOUR) }).where(eq(itemRequests.id, id));

  await pool.query("DELETE FROM job_switches WHERE job_name = 'handoff-deadlines'");
  await pool.query("INSERT INTO job_switches (job_name, mode, updated_by, note) VALUES ('handoff-deadlines', 'live', 'test', 'test fixture')");
  // The endpoint allows one call a minute per user, so call it as a user who has not.
  const username = `${UNIQUE}-caller-${callerCount++}`;
  const [caller] = await db.insert(users).values({ username, password: await hashPassword(PASSWORD), emailVerified: true }).returning({ id: users.id });
  userIds.push(caller.id);
  const client = await new Client().signIn(username);
  const response = await client.post("/api/requests/check-handoff-deadlines");
  assert.equal(response.status, 200);

  const request = await load(id);
  assert.equal(request.status, "COMPLETED");
  assert.equal(request.handoffAutoAdvanced, true);
  assert.equal((await notesFor(id, ownerId)).filter((n) => n.type === "gift_completed").length, 1);
  assert.equal((await notesFor(id, requesterId)).filter((n) => n.type === "gift_completed").length, 1);
});

// ── Coin settlement ───────────────────────────────────────────────────────────────

/** A fresh pair of people (so the one-time first-swap and first-gift bonuses are untouched), signed in. */
async function freshPair(coins: [string, string]) {
  const password = await hashPassword(PASSWORD);
  const tag = `${UNIQUE}-pair-${callerCount++}`;
  const [o, r] = await db.insert(users).values([
    { username: `${tag}-o`, displayName: "Pair Owner", password, emailVerified: true, shareCoins: coins[0] },
    { username: `${tag}-r`, displayName: "Pair Requester", password, emailVerified: true, shareCoins: coins[1] },
  ]).returning({ id: users.id });
  userIds.push(o.id, r.id);
  return { ownerId: o.id, requesterId: r.id, ownerClient: await new Client().signIn(`${tag}-o`), requesterClient: await new Client().signIn(`${tag}-r`) };
}

async function seedSwap(pair: { ownerId: number; requesterId: number }, ownerTier: number, requesterTier: number, fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const mk = async (ownerOfItem: number, tier: number) => {
    const [item] = await db.insert(items).values({
      ownerId: ownerOfItem, name: `${UNIQUE}-settle-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
      isSwappable: true, isAvailable: true, replacementValue: 100, shareCoinsReward: "0", tier,
    } as typeof items.$inferInsert).returning({ id: items.id });
    itemIds.push(item.id);
    return item.id;
  };
  const ownerItem = await mk(pair.ownerId, ownerTier);
  const requesterItem = await mk(pair.requesterId, requesterTier);
  const [request] = await db.insert(itemRequests).values({
    itemId: ownerItem, requesterId: pair.requesterId, requestType: "SWAP", status: "ACCEPTED", acceptedAt: new Date(),
    swapOfferedItemIds: [requesterItem], ownerConfirmedHandoff: false, borrowerConfirmedHandoff: false, ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, ownerItem, requesterItem };
}

const balance = async (id: number) => Number((await db.select({ c: users.shareCoins }).from(users).where(eq(users.id, id)))[0].c);
const ledgerRows = (id: number) => db.select().from(shareCoinsTransactions).where(eq(shareCoinsTransactions.userId, id));
// (item names differ between two swaps, so they are taken out of the descriptions)
const ledger = async (id: number) =>
  (await ledgerRows(id)).map((t) => `${t.transactionType}:${Number(t.amount)}:${(t.description ?? "").replace(/swap-gift-confirm-\d+-settle-\d+/, "<item>")}`).sort();
const bonusRows = async (id: number, kind: "Swap" | "Gift") => (await ledgerRows(id)).filter((t) => t.description?.startsWith(`First Time ${kind} Bonus`));

async function runLiveSweep() {
  await pool.query("DELETE FROM job_switches WHERE job_name = 'handoff-deadlines'");
  await pool.query("INSERT INTO job_switches (job_name, mode, updated_by, note) VALUES ('handoff-deadlines', 'live', 'test', 'test fixture')");
  const username = `${UNIQUE}-caller-${callerCount++}`;
  const [caller] = await db.insert(users).values({ username, password: await hashPassword(PASSWORD), emailVerified: true }).returning({ id: users.id });
  userIds.push(caller.id);
  assert.equal((await (await new Client().signIn(username)).post("/api/requests/check-handoff-deadlines")).status, 200);
}

test("a SWAP the sweep confirms settles coins exactly as one both people confirm: the same offset, the first-swap bonus once each", async () => {
  // Owner's item is tier 2 (10 SC), the requester's tier 3 (20 SC): the owner pays the 10 SC difference.
  const auto = await freshPair(["100.00", "100.00"]);
  const swap = await seedSwap(auto, 2, 3);
  assert.equal((await auto.ownerClient.post(`/api/requests/${swap.id}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal(await balance(auto.ownerId), 100, "confirming one side moves nothing");
  await db.update(itemRequests).set({ handoffConfirmDeadline: new Date(Date.now() - HOUR) }).where(eq(itemRequests.id, swap.id));
  await runLiveSweep();
  assert.equal((await load(swap.id)).status, "COMPLETED");

  const manual = await freshPair(["100.00", "100.00"]);
  const swap2 = await seedSwap(manual, 2, 3);
  assert.equal((await manual.ownerClient.post(`/api/requests/${swap2.id}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await manual.requesterClient.post(`/api/requests/${swap2.id}/handoff`, { confirmedBy: "borrower" })).status, 200);
  assert.equal((await load(swap2.id)).status, "COMPLETED");

  for (const [a, m] of [[auto.ownerId, manual.ownerId], [auto.requesterId, manual.requesterId]] as const) {
    assert.deepEqual(await ledger(a), await ledger(m), "the same ledger rows");
    assert.equal(await balance(a), await balance(m), "the same balance");
  }
  // Both people are told "Trust Score" and "Swap completed +20", on the auto-confirm path as on the manual one.
  for (const [swapId, people] of [[swap.id, auto], [swap2.id, manual]] as const) {
    for (const personId of [people.ownerId, people.requesterId]) {
      const trust = (await notesFor(swapId, personId)).filter((n) => n.type === "trust_score_changed");
      assert.deepEqual(trust.map((n) => `${n.title}|${n.message}`), ["Trust Score|Swap completed +20"], `swap ${swapId}, user ${personId}`);
    }
  }
  // The offset is the tier difference (20 - 10): the side with the cheaper item pays it, once, and the other receives it.
  assert.ok((await ledger(auto.ownerId)).some((row) => row.startsWith("SWAP_OFFSET_PAID:-10:")), "the owner paid 10");
  assert.ok((await ledger(auto.requesterId)).some((row) => row.startsWith("SWAP_OFFSET_RECEIVED:10:")), "the requester received 10");
  assert.equal((await ledgerRows(auto.ownerId)).filter((t) => t.transactionType.startsWith("SWAP_OFFSET")).length, 1);
  assert.equal((await ledgerRows(auto.requesterId)).filter((t) => t.transactionType.startsWith("SWAP_OFFSET")).length, 1);
  assert.equal((await bonusRows(auto.ownerId, "Swap")).length, 1, "one first-swap bonus each");
  assert.equal((await bonusRows(auto.requesterId, "Swap")).length, 1);
  for (const itemId of [swap.ownerItem, swap.requesterItem]) {
    const [item] = await db.select({ isAvailable: items.isAvailable, isSwapped: items.isSwapped }).from(items).where(eq(items.id, itemId));
    assert.deepEqual(item, { isAvailable: false, isSwapped: true });
  }

  // Sweeping it again changes nothing.
  const [ownerBefore, requesterBefore] = [await balance(auto.ownerId), await balance(auto.requesterId)];
  await runLiveSweep();
  assert.equal(await balance(auto.ownerId), ownerBefore);
  assert.equal(await balance(auto.requesterId), requesterBefore);
});

test("a GIFT the sweep confirms moves no coins from the receiver; the giver gets the one-time first-gift bonus and no more", async () => {
  const pair = await freshPair(["10.00", "10.00"]);
  const [item] = await db.insert(items).values({
    ownerId: pair.ownerId, name: `${UNIQUE}-gift-settle`, description: "x", conditionRating: 4, photos: [], isGift: true, isAvailable: true, shareCoinsReward: "0", shareCoinPrice: "7.00",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId: pair.requesterId, requestType: "GIFT", status: "ACCEPTED", acceptedAt: new Date(),
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);

  assert.equal((await pair.requesterClient.post(`/api/requests/${request.id}/handoff`, { confirmedBy: "borrower" })).status, 200);
  await db.update(itemRequests).set({ handoffConfirmDeadline: new Date(Date.now() - HOUR) }).where(eq(itemRequests.id, request.id));
  await runLiveSweep();
  assert.equal((await load(request.id)).status, "COMPLETED");
  // Nothing is charged to the receiver and nothing is paid to the giver for the gift itself: no negative rows, no
  // borrow/lend/offset rows, and the giver's only gift row is the one-time first-gift bonus (badges may add their own).
  const receiverRows = await ledgerRows(pair.requesterId);
  assert.ok(receiverRows.every((t) => Number(t.amount) > 0), "the receiver is never debited");
  assert.ok(await balance(pair.requesterId) >= 10);
  const giverRows = await ledgerRows(pair.ownerId);
  assert.ok(giverRows.every((t) => !["BORROW_CHARGE", "LEND_REWARD", "SWAP_OFFSET_PAID", "SWAP_OFFSET_RECEIVED"].includes(t.transactionType)));
  assert.equal((await bonusRows(pair.ownerId, "Gift")).length, 1, "the first-gift bonus, once");
  assert.equal((await bonusRows(pair.requesterId, "Gift")).length, 0, "the receiver gets none");
});

test("the swap offset is capped at what the payer has, and the receiver gets exactly what the payer paid: no coins are created", async () => {
  // Owner's item is tier 1 (5 SC), the requester's tier 4 (40 SC): the owner owes 35 SC but starts with 2.
  const pair = await freshPair(["2.00", "0.00"]);
  const swap = await seedSwap(pair, 1, 4);
  assert.equal((await pair.ownerClient.post(`/api/requests/${swap.id}/handoff`, { confirmedBy: "owner" })).status, 200);
  assert.equal((await pair.requesterClient.post(`/api/requests/${swap.id}/handoff`, { confirmedBy: "borrower" })).status, 200);
  assert.equal((await load(swap.id)).status, "COMPLETED", "the swap itself still completes");

  const sum = async (id: number) => (await ledgerRows(id)).reduce((total, row) => total + Number(row.amount), 0);
  const paidRows = (await ledgerRows(pair.ownerId)).filter((t) => t.transactionType === "SWAP_OFFSET_PAID");
  const receivedRows = (await ledgerRows(pair.requesterId)).filter((t) => t.transactionType === "SWAP_OFFSET_RECEIVED");
  assert.equal(paidRows.length, 1);
  assert.equal(receivedRows.length, 1);
  const paid = -Number(paidRows[0].amount);
  assert.ok(paid > 0 && paid < 35, `the owner paid ${paid}, less than the 35 owed`);
  assert.equal(Number(receivedRows[0].amount), paid, "the requester received exactly what the owner paid");
  // What the owner had when the offset ran: the 2 they started with plus the first-swap bonus (badges are awarded after).
  const bonus = (await bonusRows(pair.ownerId, "Swap")).reduce((total, row) => total + Number(row.amount), 0);
  assert.equal(paid, 2 + bonus, "the owner paid everything they had toward the offset, no more");
  // Every coin on both balances is in the ledger: the starting 2 plus the recorded rows, nothing from nowhere.
  assert.equal(await balance(pair.ownerId), 2 + (await sum(pair.ownerId)));
  assert.equal(await balance(pair.requesterId), 0 + (await sum(pair.requesterId)));
});
