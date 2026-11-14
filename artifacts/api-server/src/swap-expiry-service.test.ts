import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, users } from "@workspace/db";
import { runRequestExpirySweep, type RequestExpiryDeps } from "./request-expiry-service.js";
import { dueSwapReminder, runSwapExpirySweep, swapExpiryDeadline } from "./swap-expiry-service.js";
import { swapExpiredChat, swapExpiredNotice, swapExpiryReminder } from "./request-expiry-copy.js";
import { compactNotificationCopy } from "./notification-copy.js";

const UNIQUE = `swap-expiry-${Date.now()}`;
const ACCEPTED_AT = new Date("2026-10-01T12:00:00.000Z");
// 7 days after Oct 1 12:00Z is Oct 8 5:00 AM in Vancouver; the swap lasts to the end of that day (11:59:59 PM PDT).
const DEADLINE = new Date("2026-10-09T06:59:59.999Z");
const H = 3_600_000;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let requesterId: number;

async function newSwap(overrides: Partial<typeof itemRequests.$inferInsert> = {}, itemOverrides: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "Swap expiry test item", conditionRating: 4, photos: [], isSwappable: true, isAvailable: true, shareCoinsReward: "0", ...itemOverrides })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({ itemId: item.id, requesterId, requestType: "SWAP", status: "ACCEPTED", acceptedAt: ACCEPTED_AT, handoffPin: "1234", ...overrides })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return { id: request.id, itemId: item.id };
}

const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const notesFor = (id: number) => db.select().from(notifications).where(eq(notifications.requestId, id));
const chatFor = (id: number) => db.select().from(messages).where(eq(messages.requestId, id));
const sweep = (now: Date, options: Parameters<typeof runSwapExpirySweep>[1] = {}, requestIdsOnly?: number[]) =>
  runSwapExpirySweep({}, { now, onlyRequestIds: requestIdsOnly, ...options });

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
  assert.equal(swapExpiryDeadline({ acceptedAt: ACCEPTED_AT })!.toISOString(), DEADLINE.toISOString());
  for (const acceptedAt of ["2026-10-01T07:00:00.000Z", "2026-10-02T06:59:00.000Z"]) {
    assert.equal(swapExpiryDeadline({ acceptedAt: new Date(acceptedAt) })!.toISOString(), DEADLINE.toISOString(), "any time on the same local day gives the same deadline");
  }
  assert.equal(swapExpiryDeadline({ acceptedAt: new Date("2026-10-02T07:00:00.000Z") })!.toISOString(), "2026-10-10T06:59:59.999Z", "the next local day gives the next");
  assert.equal(swapExpiryDeadline({ acceptedAt: new Date("2026-10-01T06:59:00.000Z") })!.toISOString(), "2026-10-08T06:59:59.999Z", "the day before gives the day before");
  assert.equal(swapExpiryDeadline({ acceptedAt: null }), null);
  assert.equal(dueSwapReminder(DEADLINE, new Date(DEADLINE.getTime() - 100 * H)), null);
  assert.equal(dueSwapReminder(DEADLINE, new Date(DEADLINE.getTime() - 72 * H)), 72);
  assert.equal(dueSwapReminder(DEADLINE, new Date(DEADLINE.getTime() - 30 * H)), 72);
  assert.equal(dueSwapReminder(DEADLINE, new Date(DEADLINE.getTime() - 24 * H)), 24);
  assert.equal(dueSwapReminder(DEADLINE, new Date(DEADLINE.getTime() - 1 * H)), 24);
  assert.equal(dueSwapReminder(DEADLINE, new Date(DEADLINE.getTime() + 1)), null);
});

test("an accepted swap expires after its deadline: EXPIRED, a system message and a notice for both people, nobody penalised", async () => {
  const { id } = await newSwap();
  const before = await sweep(new Date(DEADLINE.getTime() - 1_000), { reminders: false }, [id]);
  assert.deepEqual([before.expiredCount, before.candidates.length], [0, 0]);
  assert.equal((await load(id)).status, "ACCEPTED");

  const result = await sweep(new Date(DEADLINE.getTime() + 1_000), {}, [id]);
  assert.equal(result.expiredCount, 1);
  const request = await load(id);
  assert.equal(request.status, "EXPIRED");
  assert.equal(request.expiredReason, "swap_no_handoff");
  assert.equal(request.handoffPin, null, "the handoff code dies with the swap");
  assert.ok(request.expiredAt);
  assert.equal((await chatFor(id)).length, 1);
  const notes = (await notesFor(id)).filter((n) => n.type === "request_expired");
  assert.deepEqual(notes.map((n) => n.userId).sort(), [ownerId, requesterId].sort());
  assert.equal(notes[0].message, "Not confirmed in time.");
  assert.equal((await chatFor(id))[0].content, "⏰ Swap expired — the exchange was not confirmed");
  assert.equal(swapExpiredChat(DEADLINE), (await chatFor(id))[0].content);

  assert.equal((await sweep(new Date(DEADLINE.getTime() + 2_000), {}, [id])).expiredCount, 0, "a second sweep does nothing");
});

test("a dry run reports the swap and changes nothing", async () => {
  const { id } = await newSwap();
  const result = await sweep(new Date(DEADLINE.getTime() + 1_000), { expireDryRun: true, reminders: false }, [id]);
  assert.deepEqual(result.candidates.map((c) => [c.requestId, c.action]), [[id, "expire"]]);
  assert.equal(result.expiredCount, 0);
  assert.equal((await load(id)).status, "ACCEPTED");
  assert.equal((await chatFor(id)).length, 0);
});

test("only ACCEPTED swaps expire; a swap awaiting confirmation, a borrow and a swap without an acceptance time are left alone", async () => {
  const awaiting = await newSwap({ status: "AWAITING_HANDOFF_CONFIRM" });
  const borrow = await newSwap({ requestType: "BORROW" });
  const noTime = await newSwap({ acceptedAt: null });
  const late = new Date(DEADLINE.getTime() + 30 * 24 * H);
  const result = await sweep(late, {}, [awaiting.id, borrow.id, noTime.id]);
  assert.equal(result.expiredCount, 0);
  assert.equal((await load(awaiting.id)).status, "AWAITING_HANDOFF_CONFIRM");
  assert.equal((await load(borrow.id)).status, "ACCEPTED");
  assert.equal((await load(noTime.id)).status, "ACCEPTED");
});

test("the 72h and 24h reminders each go to both people once", async () => {
  const { id } = await newSwap();
  assert.equal((await sweep(new Date(DEADLINE.getTime() - 100 * H), {}, [id])).remindedCount, 0);

  const at72 = new Date(DEADLINE.getTime() - 71 * H);
  assert.equal((await sweep(at72, {}, [id])).remindedCount, 1);
  assert.equal((await sweep(new Date(at72.getTime() + H), {}, [id])).remindedCount, 0, "not sent twice");
  const first = (await notesFor(id)).filter((n) => n.type === "swap_expiry_reminder_72h");
  assert.deepEqual(first.map((n) => n.userId).sort(), [ownerId, requesterId].sort());
  assert.match(first[0].title, /3 days/);
  // Each person is told the other's name.
  const forOwner = first.find((n) => n.userId === ownerId)!;
  const forRequester = first.find((n) => n.userId === requesterId)!;
  assert.equal(forOwner.message, `Arrange meet up with ${UNIQUE}-requester`);
  assert.equal(forRequester.message, `Arrange meet up with ${UNIQUE}-owner`);

  const at24 = new Date(DEADLINE.getTime() - 23 * H);
  assert.equal((await sweep(at24, {}, [id])).remindedCount, 1);
  assert.equal((await sweep(new Date(at24.getTime() + H), {}, [id])).remindedCount, 0);
  const second = (await notesFor(id)).filter((n) => n.type === "swap_expiry_reminder_24h");
  assert.equal(second.length, 2);
  assert.match(second[0].title, /24 hours/);
  assert.equal((await load(id)).status, "ACCEPTED", "a reminder never expires anything");
});

test("two sweeps at once send one reminder each", async () => {
  const { id } = await newSwap();
  const now = new Date(DEADLINE.getTime() - 20 * H);
  await Promise.all([sweep(now, {}, [id]), sweep(now, {}, [id]), sweep(now, {}, [id])]);
  assert.equal((await notesFor(id)).filter((n) => n.type === "swap_expiry_reminder_24h").length, 2);
});

test("the shared expiry sweep also expires swaps, with the same dry-run and reminder switches", async () => {
  const deps = {} as RequestExpiryDeps;
  const { id } = await newSwap();
  const late = new Date(DEADLINE.getTime() + 1_000);
  const dry = await runRequestExpirySweep(deps, { now: late, expireDryRun: true, onlyRequestIds: [id] });
  assert.deepEqual(dry.candidates.map((c) => c.requestId), [id]);
  assert.equal((await load(id)).status, "ACCEPTED");
  const live = await runRequestExpirySweep(deps, { now: late, onlyRequestIds: [id] });
  assert.equal(live.expiredCount, 1);
  assert.equal((await load(id)).status, "EXPIRED");
});

test("swaps whose deadline passed longer ago than the sweep's age limit are left alone", async () => {
  const { id } = await newSwap();
  const long = new Date(DEADLINE.getTime() + 10 * 24 * H);
  const result = await sweep(long, { maxCutoffAgeMs: 24 * H, reminders: false }, [id]);
  assert.equal(result.expiredCount, 0);
  assert.equal((await load(id)).status, "ACCEPTED");
});

test("the notices survive the app's 54-character shortening", () => {
  const shown = (n: { title: string; message: string }, type: string) => compactNotificationCopy({ ...n, type });
  assert.equal(shown(swapExpiredNotice("Camping tent", DEADLINE), "request_expired").message, "Not confirmed in time.");
  for (const hours of [72, 24] as const) {
    const out = shown(swapExpiryReminder("Camping tent", hours, "Tina L."), `swap_expiry_reminder_${hours}h`);
    assert.equal(out.message, "Arrange meet up with Tina L.");
    assert.match(out.title, hours === 72 ? /^Swap expires in 3 days: Camping tent$/ : /^Swap expires in 24 hours: Camping tent$/);
  }
  assert.equal(swapExpiryReminder("Camping tent", 24).message, "Arrange meet up with your neighbour");
});
