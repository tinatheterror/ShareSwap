import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, users } from "@workspace/db";
import { runRequestExpirySweep, type RequestExpiryDeps } from "./request-expiry-service.js";
import { dueExchangeReminder, exchangeExpiryDeadline, runExchangeExpirySweep } from "./exchange-expiry-service.js";
import { exchangeExpiredChat, exchangeExpiredNotice, exchangeExpiryReminder } from "./request-expiry-copy.js";
import { compactNotificationCopy } from "./notification-copy.js";
import { expiredExchangeCountsFor, expiredExchangeCountsForAll } from "./expired-exchange-counts.js";
import { findReservationConflict, heldItemIdSet } from "./swap-reservation.js";

const UNIQUE = `exchange-expiry-${Date.now()}`;
const ACCEPTED_AT = new Date("2026-10-01T12:00:00.000Z");
// 7 days after Oct 1 12:00Z is Oct 8 5:00 AM in Vancouver; the request lasts to the end of that day (11:59:59 PM PDT).
const DEADLINE = new Date("2026-10-09T06:59:59.999Z");
const H = 3_600_000;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let requesterId: number;

type Type = "SWAP" | "GIFT";

async function newExchange(requestType: Type, overrides: Partial<typeof itemRequests.$inferInsert> = {}, itemOverrides: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "Exchange expiry test item", conditionRating: 4, photos: [], isSwappable: true, isGift: true, isAvailable: true, shareCoinsReward: "0", ...itemOverrides })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId: item.id, requesterId, requestType, status: "ACCEPTED", acceptedAt: ACCEPTED_AT, handoffPin: "1234", ...overrides })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId: item.id };
}

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const notesFor = (id: number) => db.select().from(notifications).where(eq(notifications.requestId, id));
const chatFor = (id: number) => db.select().from(messages).where(eq(messages.requestId, id));
const sweep = (now: Date, options: Parameters<typeof runExchangeExpirySweep>[1] = {}, only?: number[]) =>
  runExchangeExpirySweep({}, { now, onlyRequestIds: only, ...options });

before(async () => {
  const [owner, requester] = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-owner`, password: "x", emailVerified: true },
      { username: `${UNIQUE}-requester`, password: "x", emailVerified: true },
    ])
    .returning({ id: users.id });
  ownerId = owner.id;
  requesterId = requester.id;
  userIds.push(owner.id, requester.id);
});

after(async () => {
  if (requestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

test("the deadline is the end of the 7th day after acceptance, and the reminder due is 72h then 24h before it", () => {
  assert.equal(exchangeExpiryDeadline({ acceptedAt: ACCEPTED_AT })!.toISOString(), DEADLINE.toISOString());
  for (const acceptedAt of ["2026-10-01T07:00:00.000Z", "2026-10-02T06:59:00.000Z"]) {
    assert.equal(exchangeExpiryDeadline({ acceptedAt: new Date(acceptedAt) })!.toISOString(), DEADLINE.toISOString(), "any time on the same local day gives the same deadline");
  }
  assert.equal(exchangeExpiryDeadline({ acceptedAt: new Date("2026-10-02T07:00:00.000Z") })!.toISOString(), "2026-10-10T06:59:59.999Z", "the next local day gives the next");
  assert.equal(exchangeExpiryDeadline({ acceptedAt: new Date("2026-10-01T06:59:00.000Z") })!.toISOString(), "2026-10-08T06:59:59.999Z", "the day before gives the day before");
  assert.equal(exchangeExpiryDeadline({ acceptedAt: null }), null);
  assert.equal(dueExchangeReminder(DEADLINE, new Date(DEADLINE.getTime() - 100 * H)), null);
  assert.equal(dueExchangeReminder(DEADLINE, new Date(DEADLINE.getTime() - 72 * H)), 72);
  assert.equal(dueExchangeReminder(DEADLINE, new Date(DEADLINE.getTime() - 30 * H)), 72);
  assert.equal(dueExchangeReminder(DEADLINE, new Date(DEADLINE.getTime() - 24 * H)), 24);
  assert.equal(dueExchangeReminder(DEADLINE, new Date(DEADLINE.getTime() - 1 * H)), 24);
  assert.equal(dueExchangeReminder(DEADLINE, new Date(DEADLINE.getTime() + 1)), null);
});

for (const type of ["SWAP", "GIFT"] as const) {
  const word = type === "SWAP" ? "swap" : "gift";

  test(`an accepted ${word} expires after its deadline: EXPIRED, a chat line and a notice for both people, nobody penalised`, async () => {
    const { id } = await newExchange(type);
    const early = await sweep(new Date(DEADLINE.getTime() - 1_000), { reminders: false }, [id]);
    assert.deepEqual([early.expiredCount, early.candidates.length], [0, 0]);
    assert.equal((await load(id)).status, "ACCEPTED");

    const result = await sweep(new Date(DEADLINE.getTime() + 1_000), {}, [id]);
    assert.equal(result.expiredCount, 1);
    const request = await load(id);
    assert.equal(request.status, "EXPIRED");
    assert.equal(request.expiredReason, `${word}_no_handoff`);
    assert.equal(request.handoffPin, null, "the handoff code dies with it");
    assert.ok(request.expiredAt);
    assert.deepEqual((await chatFor(id)).map((m) => m.content), [exchangeExpiredChat(type)]);
    const notes = (await notesFor(id)).filter((n) => n.type === "request_expired");
    assert.deepEqual(notes.map((n) => n.userId).sort(), [ownerId, requesterId].sort());
    assert.equal(notes[0].message, "Not confirmed in time.");
    assert.match(notes[0].title, type === "SWAP" ? /^Swap expired: / : /^Gift expired: /);
    assert.equal((await sweep(new Date(DEADLINE.getTime() + 2_000), {}, [id])).expiredCount, 0, "a second sweep does nothing");
  });

  test(`a ${word} that only one person has confirmed does not expire: the handoff sweep settles it within 24 hours`, async () => {
    // The first confirmation moves it to AWAITING_HANDOFF_CONFIRM and starts the other person's 24 hours.
    const { id } = await newExchange(type, { status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true, handoffConfirmDeadline: new Date(DEADLINE.getTime() + 24 * H) });
    for (const at of [DEADLINE.getTime() - 40 * H, DEADLINE.getTime() - 10 * H, DEADLINE.getTime() + 1_000]) {
      const result = await sweep(new Date(at), {}, [id]);
      assert.equal(result.expiredCount, 0);
      assert.equal(result.remindedCount, 0, "no expiry reminder either");
      assert.deepEqual(result.candidates, []);
    }
    assert.equal((await load(id)).status, "AWAITING_HANDOFF_CONFIRM");
  });

  test(`the 72h and 24h reminders for a ${word} each go to both people once, naming the other person`, async () => {
    const { id } = await newExchange(type);
    assert.equal((await sweep(new Date(DEADLINE.getTime() - 100 * H), {}, [id])).remindedCount, 0);

    const at72 = new Date(DEADLINE.getTime() - 71 * H);
    assert.equal((await sweep(at72, {}, [id])).remindedCount, 1);
    assert.equal((await sweep(new Date(at72.getTime() + H), {}, [id])).remindedCount, 0, "not sent twice");
    const first = (await notesFor(id)).filter((n) => n.type === `${word}_expiry_reminder_72h`);
    assert.deepEqual(first.map((n) => n.userId).sort(), [ownerId, requesterId].sort());
    assert.match(first[0].title, type === "SWAP" ? /^Swap expires in 3 days: / : /^Gift expires in 3 days: /);
    assert.equal(first.find((n) => n.userId === ownerId)!.message, `Arrange meet up with ${UNIQUE}-requester`);
    assert.equal(first.find((n) => n.userId === requesterId)!.message, `Arrange meet up with ${UNIQUE}-owner`);

    const at24 = new Date(DEADLINE.getTime() - 23 * H);
    assert.equal((await sweep(at24, {}, [id])).remindedCount, 1);
    assert.equal((await sweep(new Date(at24.getTime() + H), {}, [id])).remindedCount, 0);
    const second = (await notesFor(id)).filter((n) => n.type === `${word}_expiry_reminder_24h`);
    assert.equal(second.length, 2);
    assert.match(second[0].title, /24 hours/);
    assert.equal((await load(id)).status, "ACCEPTED", "a reminder never expires anything");
  });

  test(`items an accepted ${word} holds are released when it expires`, async () => {
    const { id, itemId } = await newExchange(type);
    const held = async () => (await heldItemIdSet()).has(itemId);
    assert.equal(await held(), true);
    const other = await db.insert(itemRequests).values({ itemId, requesterId, requestType: "SWAP", status: "PENDING" }).returning({ id: itemRequests.id });
    requestIds.push(other[0].id);
    const asked = { id: other[0].id, itemId, requestType: "SWAP", swapOfferedItemIds: [], swapRequestedItemIds: [], counterSwapOwnerItemIds: [], counterSwapRequesterItemIds: [] };
    assert.equal((await findReservationConflict(asked))?.requestId, id, "while accepted, it blocks another swap for the item");
    await sweep(new Date(DEADLINE.getTime() + 1_000), {}, [id]);
    assert.equal(await held(), false);
    assert.equal(await findReservationConflict(asked), null, "once expired, the item is free again");
  });
}

test("a dry run reports the request and changes nothing", async () => {
  const { id } = await newExchange("GIFT");
  const result = await sweep(new Date(DEADLINE.getTime() + 1_000), { expireDryRun: true, reminders: false }, [id]);
  assert.deepEqual(result.candidates.map((c) => [c.requestId, c.action]), [[id, "expire"]]);
  assert.equal(result.expiredCount, 0);
  assert.equal((await load(id)).status, "ACCEPTED");
  assert.equal((await chatFor(id)).length, 0);
});

test("other request types, other statuses and requests without an acceptance time are left alone", async () => {
  const borrow = await newExchange("SWAP", { requestType: "BORROW" });
  const pending = await newExchange("GIFT", { status: "PENDING" });
  const noTime = await newExchange("SWAP", { acceptedAt: null });
  const late = new Date(DEADLINE.getTime() + 30 * 24 * H);
  const result = await sweep(late, {}, [borrow.id, pending.id, noTime.id]);
  assert.equal(result.expiredCount, 0);
  assert.equal((await load(borrow.id)).status, "ACCEPTED");
  assert.equal((await load(pending.id)).status, "PENDING");
  assert.equal((await load(noTime.id)).status, "ACCEPTED");
});

test("two sweeps at once send one reminder each", async () => {
  const { id } = await newExchange("GIFT");
  const now = new Date(DEADLINE.getTime() - 20 * H);
  await Promise.all([sweep(now, {}, [id]), sweep(now, {}, [id]), sweep(now, {}, [id])]);
  assert.equal((await notesFor(id)).filter((n) => n.type === "gift_expiry_reminder_24h").length, 2);
});

test("the shared expiry sweep also expires swaps and gifts, with the same dry-run and reminder switches", async () => {
  const deps = {} as RequestExpiryDeps;
  const swap = await newExchange("SWAP");
  const gift = await newExchange("GIFT");
  const late = new Date(DEADLINE.getTime() + 1_000);
  const dry = await runRequestExpirySweep(deps, { now: late, expireDryRun: true, onlyRequestIds: [swap.id, gift.id] });
  assert.deepEqual(dry.candidates.map((c) => c.requestId).sort(), [swap.id, gift.id].sort());
  assert.equal((await load(swap.id)).status, "ACCEPTED");
  const live = await runRequestExpirySweep(deps, { now: late, onlyRequestIds: [swap.id, gift.id] });
  assert.equal(live.expiredCount, 2);
  assert.deepEqual([(await load(swap.id)).status, (await load(gift.id)).status], ["EXPIRED", "EXPIRED"]);
});

test("requests whose deadline passed longer ago than the sweep's age limit are left alone", async () => {
  const { id } = await newExchange("SWAP");
  const long = new Date(DEADLINE.getTime() + 10 * 24 * H);
  const result = await sweep(long, { maxCutoffAgeMs: 24 * H, reminders: false }, [id]);
  assert.equal(result.expiredCount, 0);
  assert.equal((await load(id)).status, "ACCEPTED");
});

test("the notices survive the app's 54-character shortening", () => {
  const shown = (n: { title: string; message: string }, type: string) => compactNotificationCopy({ ...n, type });
  for (const type of ["SWAP", "GIFT"] as const) {
    const label = type === "SWAP" ? "Swap" : "Gift";
    assert.equal(shown(exchangeExpiredNotice(type, "Camping tent"), "request_expired").message, "Not confirmed in time.");
    for (const hours of [72, 24] as const) {
      const out = shown(exchangeExpiryReminder(type, "Camping tent", hours, "Tina L."), `${label.toLowerCase()}_expiry_reminder_${hours}h`);
      assert.equal(out.message, "Arrange meet up with Tina L.");
      assert.equal(out.title, `${label} expires in ${hours === 72 ? "3 days" : "24 hours"}: Camping tent`);
    }
  }
  assert.equal(exchangeExpiryReminder("SWAP", "Camping tent", 24).message, "Arrange meet up with your neighbour");
  assert.equal(exchangeExpiredChat("SWAP"), "⏰ Swap expired — the exchange was not confirmed");
  assert.equal(exchangeExpiredChat("GIFT"), "⏰ Gift expired — the handoff was not confirmed");
});

test("expired swaps and gifts are counted for both people, with no penalty", async () => {
  const [a, b, c, none] = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-count-a`, password: "x", emailVerified: true, trustScore: 80 },
      { username: `${UNIQUE}-count-b`, password: "x", emailVerified: true, trustScore: 80 },
      { username: `${UNIQUE}-count-c`, password: "x", emailVerified: true, trustScore: 80 },
      { username: `${UNIQUE}-count-none`, password: "x", emailVerified: true, trustScore: 80 },
    ])
    .returning({ id: users.id });
  userIds.push(a.id, b.id, c.id, none.id);
  const make = async (type: Type, owner: number, requester: number, status: string) => {
    const [item] = await db.insert(items).values({ ownerId: owner, name: `${UNIQUE}-count-${itemIds.length}`, description: "x", conditionRating: 4, photos: [], isSwappable: true, isGift: true, isAvailable: true, shareCoinsReward: "0" }).returning({ id: items.id });
    itemIds.push(item.id);
    const [request] = await db.insert(itemRequests).values({ itemId: item.id, requesterId: requester, requestType: type, status, acceptedAt: ACCEPTED_AT }).returning({ id: itemRequests.id });
    requestIds.push(request.id);
    return request.id;
  };
  const ids = [await make("SWAP", a.id, b.id, "ACCEPTED"), await make("SWAP", b.id, a.id, "ACCEPTED"), await make("GIFT", a.id, c.id, "ACCEPTED")];
  await make("SWAP", a.id, c.id, "ACCEPTED"); // not expired: not counted
  await sweep(new Date(DEADLINE.getTime() + 1_000), {}, ids);

  assert.deepEqual(await expiredExchangeCountsFor(a.id), { userId: a.id, expiredSwaps: 2, expiredGifts: 1 });
  assert.deepEqual(await expiredExchangeCountsFor(b.id), { userId: b.id, expiredSwaps: 2, expiredGifts: 0 });
  assert.deepEqual(await expiredExchangeCountsFor(c.id), { userId: c.id, expiredSwaps: 0, expiredGifts: 1 });
  assert.deepEqual(await expiredExchangeCountsFor(none.id), { userId: none.id, expiredSwaps: 0, expiredGifts: 0 }, "zeros for someone with none");
  const all = await expiredExchangeCountsForAll();
  assert.deepEqual(all.find((row) => row.userId === a.id), { userId: a.id, expiredSwaps: 2, expiredGifts: 1 });
  const scores = await db.select({ id: users.id, trustScore: users.trustScore }).from(users).where(inArray(users.id, [a.id, b.id, c.id]));
  assert.deepEqual(scores.map((s) => s.trustScore), [80, 80, 80], "nobody's score changed");
});
