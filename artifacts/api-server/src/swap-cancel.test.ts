import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, reputationActivities, requestLifecycleEvents, users } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { SWAP_PARTNER_SILENCE_MS, swapNoShowEligibleAt } from "./swap-no-show-rules.js";

const UNIQUE = `swap-cancel-${Date.now()}`;
const PASSWORD = "SwapCancel!42";
const H = 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let server: Awaited<ReturnType<typeof startApp>>;

before(async () => {
  server = await startApp();
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(reputationActivities).where(inArray(reputationActivities.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) {
      await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await server.close();
    await pool.end();
  }
});

async function makeUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, trustScore: 80, reputationLevel: "Neighbour" })
    .returning({ id: users.id, username: users.username });
  userIds.push(user.id);
  return user;
}

async function loggedIn(username: string) {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(server.baseUrl);
  assert.equal((await client.post("/api/login", { username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}

/** An accepted swap; `acceptedHoursAgo` sets how long ago it was accepted. */
async function acceptedSwap(acceptedHoursAgo: number) {
  const owner = await makeUser(`owner${userIds.length}`);
  const requester = await makeUser(`requester${userIds.length}`);
  const [item] = await db
    .insert(items)
    .values({ ownerId: owner.id, name: `${UNIQUE}-item-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isSwappable: true, isAvailable: false, shareCoinsReward: "0" })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId: item.id, requesterId: requester.id, requestType: "SWAP", status: "ACCEPTED", acceptedAt: new Date(Date.now() - acceptedHoursAgo * H) })
    .returning({ id: itemRequests.id, acceptedAt: itemRequests.acceptedAt });
  requestIds.push(request.id);
  return { owner, requester, requestId: request.id, acceptedAt: request.acceptedAt, itemId: item.id };
}

/** Makes the next cancellation by this person cost points: they already used their first-offence pass. */
async function usedGracePass(userId: number) {
  await db.insert(reputationActivities).values({ userId, activityType: "cancel_after_acceptance", points: -5, description: "Cancelled after acceptance" });
}

const penaltyRows = (userId: number, requestId: number) =>
  db.select().from(reputationActivities).where(and(eq(reputationActivities.userId, userId), eq(reputationActivities.requestId, requestId)));

test("a no-show can be reported 72 hours after the other person last wrote, counted from acceptance when they never did", async () => {
  const { owner, requester, requestId, acceptedAt } = await acceptedSwap(100);
  const request = { id: requestId, acceptedAt };
  assert.equal((await swapNoShowEligibleAt(request, requester.id))!.getTime(), acceptedAt!.getTime() + SWAP_PARTNER_SILENCE_MS);

  // A system line or an event sent in their name is not a reply.
  await db.insert(messages).values({ content: "accepted", senderId: requester.id, receiverId: owner.id, requestId, messageType: "event" });
  assert.equal((await swapNoShowEligibleAt(request, requester.id))!.getTime(), acceptedAt!.getTime() + SWAP_PARTNER_SILENCE_MS);
  // A real message 10 hours ago is.
  const wrote = new Date(Date.now() - 10 * H);
  await db.insert(messages).values({ content: "see you saturday", senderId: requester.id, receiverId: owner.id, requestId, messageType: "text", createdAt: wrote });
  assert.equal((await swapNoShowEligibleAt(request, requester.id))!.getTime(), wrote.getTime() + SWAP_PARTNER_SILENCE_MS);
});

test("an owner can change their mind and cancel an accepted swap: never penalised, even after a first cancellation and with a partner who answered", async () => {
  const { owner, requester, requestId, itemId } = await acceptedSwap(100);
  await db.insert(messages).values({ content: "still on?", senderId: requester.id, receiverId: owner.id, requestId, messageType: "text", createdAt: new Date(Date.now() - 5 * H) });
  await usedGracePass(owner.id);
  const ownerScore = await trust(owner.id);

  const res = await (await loggedIn(owner.username)).post(`/api/requests/${requestId}/cancel`, {});
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { message: string }).message, "Swap cancelled.");
  assert.equal((await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)))[0].status, "CANCELLED");
  assert.deepEqual(await penaltyRows(owner.id, requestId), [], "no penalty and no grace-pass warning");
  assert.equal(await trust(owner.id), ownerScore);
  assert.equal((await db.select().from(items).where(eq(items.id, itemId)))[0].isAvailable, true);
});

test("a requester cancelling an accepted swap is not penalised either, first time or later", async () => {
  const first = await acceptedSwap(5);
  const res1 = await (await loggedIn(first.requester.username)).post(`/api/requests/${first.requestId}/cancel`, {});
  assert.equal(res1.status, 200);
  assert.equal(((await res1.json()) as { message: string }).message, "Swap cancelled.");
  assert.deepEqual(await penaltyRows(first.requester.id, first.requestId), [], "not even a grace-pass warning");

  const later = await acceptedSwap(5);
  await usedGracePass(later.requester.id);
  const before = await trust(later.requester.id);
  assert.equal((await (await loggedIn(later.requester.username)).post(`/api/requests/${later.requestId}/cancel`, {})).status, 200);
  assert.deepEqual(await penaltyRows(later.requester.id, later.requestId), []);
  assert.equal(await trust(later.requester.id), before);
});

/** An accepted swap or gift; `extra` sets fields such as who has confirmed the handoff. */
async function acceptedExchange(requestType: "SWAP" | "GIFT", extra: Partial<typeof itemRequests.$inferInsert> = {}) {
  const made = await acceptedSwap(5);
  await db.update(itemRequests).set({ requestType, ...extra }).where(eq(itemRequests.id, made.requestId));
  return made;
}

test("a gift can be cancelled by either person while accepted, and never costs anyone anything", async () => {
  for (const who of ["owner", "requester"] as const) {
    const gift = await acceptedExchange("GIFT");
    const person = gift[who];
    await usedGracePass(person.id);
    const before = await trust(person.id);
    const res = await (await loggedIn(person.username)).post(`/api/requests/${gift.requestId}/cancel`, {});
    assert.equal(res.status, 200, who);
    assert.equal(((await res.json()) as { message: string }).message, "Gift cancelled.", who);
    assert.equal((await db.select().from(itemRequests).where(eq(itemRequests.id, gift.requestId)))[0].status, "CANCELLED", who);
    assert.deepEqual((await penaltyRows(person.id, gift.requestId)).filter((r) => r.points < 0 || r.activityType === "grace_pass_warning"), [], who);
    assert.equal(await trust(person.id), before, who);
  }
});

test("once either person has confirmed the handoff, a swap or gift can no longer be cancelled by anyone", async () => {
  for (const type of ["SWAP", "GIFT"] as const) {
    for (const flag of ["ownerConfirmedHandoff", "borrowerConfirmedHandoff"] as const) {
      const exchange = await acceptedExchange(type, { [flag]: true });
      for (const person of [exchange.owner, exchange.requester]) {
        const res = await (await loggedIn(person.username)).post(`/api/requests/${exchange.requestId}/cancel`, {});
        assert.equal(res.status, 409, `${type} ${flag}`);
        assert.equal(((await res.json()) as { code: string }).code, "HANDOFF_ALREADY_CONFIRMED");
      }
      assert.equal((await db.select().from(itemRequests).where(eq(itemRequests.id, exchange.requestId)))[0].status, "ACCEPTED");
    }
  }
});

test("a pending request can still be withdrawn even though it has no handoff", async () => {
  const swap = await acceptedExchange("SWAP");
  await db.update(itemRequests).set({ status: "PENDING", acceptedAt: null }).where(eq(itemRequests.id, swap.requestId));
  const res = await (await loggedIn(swap.requester.username)).post(`/api/requests/${swap.requestId}/cancel`, {});
  assert.equal(res.status, 200);
  assert.equal((await db.select().from(itemRequests).where(eq(itemRequests.id, swap.requestId)))[0].status, "CANCELLED");
});

test("someone who is not part of the swap cannot cancel it", async () => {
  const { requestId } = await acceptedSwap(100);
  const stranger = await makeUser("stranger");
  const res = await (await loggedIn(stranger.username)).post(`/api/requests/${requestId}/cancel`, {});
  assert.equal(res.status, 403);
  assert.equal((await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)))[0].status, "ACCEPTED");
});

// ── No-show reports on an accepted swap ───────────────────────────────────────

const report = (client: Client, requestId: number, reportedUserId: number, description?: string) =>
  client.post(`/api/requests/${requestId}/report-no-show`, { reportedUserId, description });
const trust = async (userId: number) => Number((await db.select({ trustScore: users.trustScore }).from(users).where(eq(users.id, userId)))[0].trustScore ?? 0);

test("a no-show cannot be reported before the other person has been silent for 72 hours", async () => {
  const { owner, requester, requestId, acceptedAt } = await acceptedSwap(10);
  const res = await report(await loggedIn(owner.username), requestId, requester.id);
  assert.equal(res.status, 400);
  const body = (await res.json()) as { code: string; eligibleAt: string };
  assert.equal(body.code, "NO_SHOW_TOO_EARLY");
  assert.equal(new Date(body.eligibleAt).getTime(), acceptedAt!.getTime() + SWAP_PARTNER_SILENCE_MS);
  assert.equal((await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.requestId, requestId))).length, 0);
});

test("someone who answered recently is not a no-show, however long ago the swap was accepted", async () => {
  const { owner, requester, requestId } = await acceptedSwap(200);
  await db.insert(messages).values({ content: "running late", senderId: requester.id, receiverId: owner.id, requestId, messageType: "text", createdAt: new Date(Date.now() - 5 * H) });
  const res = await report(await loggedIn(owner.username), requestId, requester.id);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, "NO_SHOW_TOO_EARLY");
});

test("after 72 hours of silence the report is recorded once; a first no-show is a warning and the reporter is never penalised", async () => {
  const { owner, requester, requestId } = await acceptedSwap(100);
  const ownerClient = await loggedIn(owner.username);
  const ownerScore = await trust(owner.id);

  const res = await report(ownerClient, requestId, requester.id, "  Never replied or showed up  ");
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { message: string }).message, "No-show reported. This is their first one, so they get a warning.");
  const [event] = await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.requestId, requestId));
  assert.equal(event.eventType, "swap_no_show_reported");
  assert.equal(event.actorId, owner.id);
  assert.deepEqual(event.details, { reportedUserId: requester.id, description: "Never replied or showed up" });
  assert.equal((await penaltyRows(requester.id, requestId)).map((r) => r.activityType).join(), "grace_pass_warning");
  assert.deepEqual(await penaltyRows(owner.id, requestId), []);
  assert.equal(await trust(owner.id), ownerScore);
  assert.equal((await db.select().from(notifications).where(eq(notifications.requestId, requestId))).filter((n) => n.type === "swap_no_show_reported" && n.userId === requester.id).length, 1);

  const again = await report(ownerClient, requestId, requester.id);
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { code: string }).code, "NO_SHOW_ALREADY_REPORTED");
  assert.equal((await penaltyRows(requester.id, requestId)).length, 1, "reporting twice does not penalise twice");

  // The reporter can still cancel afterwards, as anyone can, without a penalty.
  await usedGracePass(owner.id);
  const cancel = await ownerClient.post(`/api/requests/${requestId}/cancel`, {});
  assert.equal(cancel.status, 200);
  assert.equal(((await cancel.json()) as { message: string }).message, "Swap cancelled.");
  assert.deepEqual((await penaltyRows(owner.id, requestId)).filter((r) => r.points < 0), []);
});

test("a repeat no-show costs trust points, and only the person who did not show pays", async () => {
  const { owner, requester, requestId } = await acceptedSwap(100);
  await db.insert(reputationActivities).values({ userId: requester.id, activityType: "no_show", points: -20, description: "earlier" });
  const before = await trust(requester.id);
  const res = await report(await loggedIn(owner.username), requestId, requester.id);
  assert.equal(res.status, 200);
  assert.match(((await res.json()) as { message: string }).message, /trust score penalty has been applied/);
  const rows = await penaltyRows(requester.id, requestId);
  assert.deepEqual(rows.map((r) => [r.activityType, r.points]), [["no_show", -20]]);
  assert.equal(await trust(requester.id), before - 20);
  assert.deepEqual(await penaltyRows(owner.id, requestId), []);
});

test("the requester can report a silent owner the same way; outsiders and self-reports are refused", async () => {
  const { owner, requester, requestId } = await acceptedSwap(100);
  const stranger = await makeUser("stranger2");
  assert.equal((await report(await loggedIn(stranger.username), requestId, owner.id)).status, 403);
  const requesterClient = await loggedIn(requester.username);
  assert.equal((await report(requesterClient, requestId, requester.id)).status, 400, "cannot report yourself");
  assert.equal((await report(requesterClient, requestId, owner.id)).status, 200);
  assert.equal((await penaltyRows(owner.id, requestId)).length, 1);
  assert.deepEqual(await penaltyRows(requester.id, requestId), []);
});

test("other request types keep today's behaviour: an accepted BORROW is refused, nothing is recorded", async () => {
  const { owner, requester, requestId } = await acceptedSwap(100);
  await db.update(itemRequests).set({ requestType: "BORROW" }).where(eq(itemRequests.id, requestId));
  const res = await report(await loggedIn(owner.username), requestId, requester.id);
  assert.equal(res.status, 400);
  assert.equal((await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.requestId, requestId))).length, 0);
});
