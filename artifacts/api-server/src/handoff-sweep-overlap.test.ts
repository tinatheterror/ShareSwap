import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  shareCoinsTransactions,
  users,
} from "@workspace/db";
import {
  processHandoffDeadlines,
  type AutoConfirmedSwapContext,
  type HandoffDeadlineDeps,
} from "./handoff-deadline-service.js";
import { withOverlapGuard } from "./overlap-guard";

// Overlapping handoff sweeps, including the case the stale-run timeout creates on purpose: the old
// run is abandoned while still going and a new run starts beside it. The sweep must still advance
// each request exactly once, charge once, notify once and run the swap rewards once.

const UNIQUE = `handoff-overlap-${Date.now()}`;
const HOUR = 3_600_000;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let borrowerId: number;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

async function newRequest(overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Handoff overlap test item",
      conditionRating: 4,
      photos: [],
      isLendable: true,
      isRentable: true,
      isSwappable: true,
      isGift: true,
      isAvailable: true,
      replacementValue: 100,
      securityDeposit: "10.00",
      lendingDuration: 7,
      shareCoinsReward: "0",
      shareCoinPrice: "7.00",
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id,
      requesterId: borrowerId,
      requestType: "BORROW",
      status: "AWAITING_HANDOFF_CONFIRM",
      startDate: new Date("2026-10-01T00:00:00.000Z"),
      endDate: new Date("2026-10-08T00:00:00.000Z"),
      ownerConfirmedHandoff: true,
      borrowerConfirmedHandoff: false,
      handoffConfirmDeadline: new Date(Date.now() - HOUR),
      ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

const coins = async (userId: number) => {
  const [row] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId));
  return Number(row.shareCoins);
};

async function outcome(requestId: number) {
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  const notes = await db.select({ type: notifications.type }).from(notifications).where(eq(notifications.requestId, requestId));
  const ledger = await db
    .select({ type: shareCoinsTransactions.transactionType, userId: shareCoinsTransactions.userId })
    .from(shareCoinsTransactions)
    .where(inArray(shareCoinsTransactions.userId, [ownerId, borrowerId]));
  return {
    status: request.status,
    notifications: notes.filter((n) => n.type === "handoff_auto_advanced").length,
    charges: ledger.filter((l) => l.type === "BORROW_CHARGE").length,
    rewards: ledger.filter((l) => l.type === "LEND_REWARD").length,
    borrowerCoins: await coins(borrowerId),
    ownerCoins: await coins(ownerId),
  };
}

const resetCoins = async () => {
  await db.update(users).set({ shareCoins: "50.00" }).where(eq(users.id, borrowerId));
  await db.update(users).set({ shareCoins: "0.00" }).where(eq(users.id, ownerId));
  await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, [ownerId, borrowerId]));
};

before(async () => {
  const [owner, borrower] = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-owner`, password: "x", emailVerified: true, shareCoins: "0.00" },
      { username: `${UNIQUE}-borrower`, password: "x", emailVerified: true, shareCoins: "50.00" },
    ])
    .returning({ id: users.id });
  ownerId = owner.id;
  borrowerId = borrower.id;
  userIds.push(owner.id, borrower.id);
});

after(async () => {
  if (requestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (userIds.length) await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

test("five simultaneous live sweeps advance a BORROW once: one charge, one reward, two notifications", async () => {
  await resetCoins();
  const id = await newRequest();
  const deps: HandoffDeadlineDeps = { onSwapAutoConfirmed: async () => {} };
  const results = await Promise.all(
    Array.from({ length: 5 }, () => processHandoffDeadlines(deps, { onlyRequestIds: [id] })),
  );
  assert.equal(results.reduce((sum, r) => sum + r.autoAdvancedCount, 0), 1);
  assert.deepEqual(await outcome(id), {
    status: "IN_PROGRESS",
    notifications: 2,
    charges: 1,
    rewards: 1,
    borrowerCoins: 43,
    ownerCoins: 7,
  });
});

test("stale-run overlap: an abandoned sweep still going and a new sweep beside it advance a SWAP once", async () => {
  await resetCoins();
  const id = await newRequest({ requestType: "SWAP" });
  const swapCalls: AutoConfirmedSwapContext[] = [];
  const release = deferred();
  const deps: HandoffDeadlineDeps = {
    // The first sweep commits the transition, then hangs in the reward callback (a slow or stuck step).
    onSwapAutoConfirmed: async (context) => {
      swapCalls.push(context);
      if (swapCalls.length === 1) await release.promise;
    },
  };

  const clock = { t: 0 };
  const errors: string[] = [];
  const results: number[] = [];
  const guarded = withOverlapGuard(
    "handoff-deadlines",
    async () => {
      const result = await processHandoffDeadlines(deps, { onlyRequestIds: [id] });
      results.push(result.autoAdvancedCount);
    },
    () => {},
    { staleAfterMs: 60_000, now: () => clock.t, logError: (line) => errors.push(line), registry: { isStopping: () => false, trackRun: (_n, p) => p } },
  );

  const first = guarded(); // advances the request, then hangs in the callback
  for (let i = 0; i < 200 && swapCalls.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(swapCalls.length, 1, "the first sweep reached the reward callback");
  assert.equal((await outcome(id)).status, "COMPLETED");

  clock.t += 30_000;
  assert.equal(await guarded(), undefined, "not stale yet: skipped");

  clock.t += 30_000; // 60s: stale
  await guarded(); // abandons the hung run and sweeps beside it
  assert.equal(guarded.abandonedCount(), 1);
  assert.equal(errors.length, 1);
  assert.equal(results.length, 1, "the new sweep finished while the old one is still hung");
  assert.equal(results[0], 0, "and found nothing left to advance");
  assert.equal(swapCalls.length, 1, "the swap rewards ran once, not twice");

  release.resolve();
  await first;
  assert.deepEqual(results, [0, 1], "the old sweep finally reports the one advance");
  const final = await outcome(id);
  assert.equal(final.status, "COMPLETED");
  assert.equal(final.notifications, 2);
  assert.equal(swapCalls.length, 1);
});

test("stale-run overlap on a BORROW: the abandoned and the new sweep together charge once", async () => {
  await resetCoins();
  const id = await newRequest();
  const gate = deferred();
  let entered = 0;
  // Hold the first sweep open by wrapping the sweep itself: it runs for real, then waits.
  const deps: HandoffDeadlineDeps = { onSwapAutoConfirmed: async () => {} };
  const clock = { t: 0 };
  const guarded = withOverlapGuard(
    "handoff-deadlines",
    async () => {
      entered++;
      const result = await processHandoffDeadlines(deps, { onlyRequestIds: [id] });
      if (entered === 1) await gate.promise;
      return result.autoAdvancedCount;
    },
    () => {},
    { staleAfterMs: 1_000, now: () => clock.t, logError: () => {}, registry: { isStopping: () => false, trackRun: (_n, p) => p } },
  );
  const first = guarded();
  for (let i = 0; i < 200 && (await outcome(id)).status !== "IN_PROGRESS"; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  clock.t = 1_000;
  const second = await guarded();
  assert.equal(second, 0);
  gate.resolve();
  assert.equal(await first, 1);
  assert.deepEqual(await outcome(id), {
    status: "IN_PROGRESS",
    notifications: 2,
    charges: 1,
    rewards: 1,
    borrowerCoins: 43,
    ownerCoins: 7,
  });
});
