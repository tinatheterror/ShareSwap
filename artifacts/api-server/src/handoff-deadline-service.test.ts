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
  HANDOFF_SWEEP_MAX_DEADLINE_AGE_MS,
  processHandoffDeadlines,
  resetHandoffSweepReportState,
  resolveHandoffSweepMode,
  runHandoffDeadlineSweep,
  type AutoConfirmedSwapContext,
  type HandoffDeadlineDeps,
} from "./handoff-deadline-service.js";

const UNIQUE = `handoff-deadlines-${Date.now()}`;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let ownerId: number;
let borrowerId: number;

const swapCalls: AutoConfirmedSwapContext[] = [];
const deps: HandoffDeadlineDeps = {
  onSwapAutoConfirmed: async (context) => {
    swapCalls.push(context);
  },
};

// Every call is scoped to the fixtures it created, so the suite never touches
// other rows in the shared development database.
const run = (ids: number[], options: Parameters<typeof processHandoffDeadlines>[1] = {}) =>
  processHandoffDeadlines(deps, { ...options, onlyRequestIds: ids });

async function newItem(overrides: Partial<typeof items.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId,
      name: `${UNIQUE}-item-${itemIds.length}`,
      description: "Handoff deadline test item",
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
      ...overrides,
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  return item.id;
}

async function newRequest(overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const itemId = overrides.itemId ?? (await newItem());
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId,
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
    .returning({ id: itemRequests.id, itemId: itemRequests.itemId });
  requestIds.push(request.id);
  return { id: request.id, itemId: request.itemId! };
}

async function setCoins(userId: number, amount: string) {
  await db.update(users).set({ shareCoins: amount }).where(eq(users.id, userId));
}

async function coins(userId: number) {
  const [row] = await db.select({ shareCoins: users.shareCoins }).from(users).where(eq(users.id, userId));
  return Number(row.shareCoins);
}

async function snapshot(requestId: number, itemId: number) {
  const [request] = await db.select().from(itemRequests).where(eq(itemRequests.id, requestId));
  const [item] = await db.select({ isAvailable: items.isAvailable }).from(items).where(eq(items.id, itemId));
  const msgs = await db.select({ id: messages.id }).from(messages).where(eq(messages.requestId, requestId));
  const notifs = await db.select({ id: notifications.id, type: notifications.type }).from(notifications).where(eq(notifications.requestId, requestId));
  return {
    status: request.status,
    handoffAutoAdvanced: request.handoffAutoAdvanced,
    depositStatus: request.depositStatus,
    itemAvailable: item.isAvailable,
    messageCount: msgs.length,
    notificationTypes: notifs.map((n) => n.type).sort(),
    borrowerCoins: await coins(borrowerId),
    ownerCoins: await coins(ownerId),
  };
}

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

// ── auto-confirm ───────────────────────────────────────────────────────────────

test("auto-confirm produces the same outcome as the endpoint always did, once", async () => {
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const { id, itemId } = await newRequest();

  const first = await run([id]);
  assert.equal(first.autoAdvancedCount, 1);
  assert.equal(first.flaggedCount, 0);

  const after = await snapshot(id, itemId);
  assert.equal(after.status, "IN_PROGRESS");
  assert.equal(after.handoffAutoAdvanced, true);
  assert.equal(after.depositStatus, "held");
  assert.equal(after.itemAvailable, false);
  assert.equal(after.borrowerCoins, 43); // 7 SC/week item, 7-day period
  assert.equal(after.ownerCoins, 7);
  assert.deepEqual(after.notificationTypes, ["handoff_auto_advanced", "handoff_auto_advanced"]);

  const second = await run([id]);
  assert.equal(second.autoAdvancedCount, 0);
  const again = await snapshot(id, itemId);
  assert.equal(again.borrowerCoins, 43);
  assert.equal(again.ownerCoins, 7);
  assert.equal(again.notificationTypes.length, 2);
});

test("overlapping runs claim a request exactly once (no double charge)", async () => {
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const { id, itemId } = await newRequest();

  const results = await Promise.all([run([id]), run([id]), run([id])]);
  assert.equal(results.reduce((sum, r) => sum + r.autoAdvancedCount, 0), 1);

  const after = await snapshot(id, itemId);
  assert.equal(after.status, "IN_PROGRESS");
  assert.equal(after.borrowerCoins, 43);
  assert.equal(after.ownerCoins, 7);
  assert.equal(after.notificationTypes.length, 2);
});

test("a borrower who cannot afford the period still advances without coins moving", async () => {
  await setCoins(borrowerId, "2.00");
  await setCoins(ownerId, "0.00");
  const { id, itemId } = await newRequest();

  const result = await run([id]);
  assert.equal(result.autoAdvancedCount, 1);
  const after = await snapshot(id, itemId);
  assert.equal(after.status, "IN_PROGRESS");
  assert.equal(after.borrowerCoins, 2);
  assert.equal(after.ownerCoins, 0);
});

test("an auto-confirmed SWAP completes and hands its rewards to the injected callback once", async () => {
  swapCalls.length = 0;
  const { id } = await newRequest({ requestType: "SWAP" });

  const results = await Promise.all([run([id]), run([id])]);
  assert.equal(results.reduce((sum, r) => sum + r.autoAdvancedCount, 0), 1);

  const [row] = await db.select({ status: itemRequests.status }).from(itemRequests).where(eq(itemRequests.id, id));
  assert.equal(row.status, "COMPLETED");
  assert.equal(swapCalls.length, 1);
  assert.equal(swapCalls[0].requestId, id);
  assert.equal(swapCalls[0].ownerId, ownerId);
  assert.equal(swapCalls[0].borrowerId, borrowerId);
});

test("deadlines that have not passed, and both-silent requests, are left alone", async () => {
  const future = await newRequest({ handoffConfirmDeadline: new Date(Date.now() + HOUR) });
  const bothSilent = await newRequest({ ownerConfirmedHandoff: false, borrowerConfirmedHandoff: false });
  const before = [await snapshot(future.id, future.itemId), await snapshot(bothSilent.id, bothSilent.itemId)];

  const result = await run([future.id, bothSilent.id]);
  assert.equal(result.autoAdvancedCount + result.flaggedCount + result.depositExpiredCount, 0);
  assert.deepEqual(
    [await snapshot(future.id, future.itemId), await snapshot(bothSilent.id, bothSilent.itemId)],
    before,
  );
});

// ── flag ───────────────────────────────────────────────────────────────────────

test("one side denied and the other silent is flagged once, never auto-confirmed", async () => {
  await setCoins(borrowerId, "50.00");
  const { id, itemId } = await newRequest({
    ownerConfirmedHandoff: false,
    borrowerConfirmedHandoff: false,
    borrowerDeniedHandoff: true,
  });

  const results = await Promise.all([run([id]), run([id])]);
  assert.equal(results.reduce((sum, r) => sum + r.flaggedCount, 0), 1);
  assert.equal(results.reduce((sum, r) => sum + r.autoAdvancedCount, 0), 0);

  const after = await snapshot(id, itemId);
  assert.equal(after.status, "HANDOFF_FLAGGED");
  assert.equal(after.messageCount, 1);
  assert.deepEqual(after.notificationTypes, ["handoff_flagged", "handoff_flagged"]);
  assert.equal(after.borrowerCoins, 50);
});

// ── 48h deposit-payment timeout ────────────────────────────────────────────────

test("an ACCEPTED in-app request unpaid after 48h is cancelled once and the item freed", async () => {
  const itemId = await newItem({ isAvailable: false });
  const { id } = await newRequest({
    itemId,
    status: "ACCEPTED",
    depositMethod: "in_app",
    acceptedAt: new Date(Date.now() - 49 * HOUR),
    ownerConfirmedHandoff: false,
    handoffConfirmDeadline: null,
  });

  const results = await Promise.all([run([id]), run([id])]);
  assert.equal(results.reduce((sum, r) => sum + r.depositExpiredCount, 0), 1);

  const after = await snapshot(id, itemId);
  assert.equal(after.status, "CANCELLED");
  assert.equal(after.itemAvailable, true);
  assert.equal(after.messageCount, 1);
  assert.deepEqual(after.notificationTypes, ["request_expired", "request_expired"]);
});

test("the deposit timeout only covers in-app RENT/BORROW requests older than 48h", async () => {
  const base = {
    status: "ACCEPTED",
    ownerConfirmedHandoff: false,
    handoffConfirmDeadline: null,
  } as const;
  const young = await newRequest({ ...base, depositMethod: "in_app", acceptedAt: new Date(Date.now() - 47 * HOUR) });
  const inPerson = await newRequest({ ...base, depositMethod: "in_person", acceptedAt: new Date(Date.now() - 60 * HOUR) });
  const gift = await newRequest({ ...base, requestType: "GIFT", depositMethod: "in_app", acceptedAt: new Date(Date.now() - 60 * HOUR) });
  const all = [young, inPerson, gift];
  const before = await Promise.all(all.map((r) => snapshot(r.id, r.itemId)));

  const result = await run(all.map((r) => r.id));
  assert.equal(result.depositExpiredCount, 0);
  assert.deepEqual(await Promise.all(all.map((r) => snapshot(r.id, r.itemId))), before);
});

// ── dry run ────────────────────────────────────────────────────────────────────

test("dry run reports every transition and changes nothing", async () => {
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const confirm = await newRequest();
  const flag = await newRequest({ ownerConfirmedHandoff: false, ownerDeniedHandoff: true });
  const deposit = await newRequest({
    status: "ACCEPTED",
    depositMethod: "in_app",
    acceptedAt: new Date(Date.now() - 49 * HOUR),
    ownerConfirmedHandoff: false,
    handoffConfirmDeadline: null,
  });
  const all = [confirm, flag, deposit];
  const before = await Promise.all(all.map((r) => snapshot(r.id, r.itemId)));

  const result = await run(all.map((r) => r.id), { dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.autoAdvancedCount, 1);
  assert.equal(result.flaggedCount, 1);
  assert.equal(result.depositExpiredCount, 1);

  const byTransition = new Map(result.candidates.map((c) => [c.transition, c]));
  assert.equal(byTransition.get("auto_confirm")?.requestId, confirm.id);
  assert.match(byTransition.get("auto_confirm")!.detail, /would move 7 ShareCoins/);
  assert.equal(byTransition.get("flag")?.requestId, flag.id);
  assert.equal(byTransition.get("deposit_timeout")?.requestId, deposit.id);

  assert.deepEqual(await Promise.all(all.map((r) => snapshot(r.id, r.itemId))), before);
  assert.equal(await coins(borrowerId), 50);
  assert.equal(await coins(ownerId), 0);
});

// ── age cutoff ─────────────────────────────────────────────────────────────────

test("the age cutoff skips deadlines older than 3 days and still acts on newer ones", async () => {
  await setCoins(borrowerId, "50.00");
  await setCoins(ownerId, "0.00");
  const old = await newRequest({ handoffConfirmDeadline: new Date(Date.now() - 4 * DAY) });
  const recent = await newRequest({ handoffConfirmDeadline: new Date(Date.now() - 2 * DAY) });
  const oldDeposit = await newRequest({
    status: "ACCEPTED", depositMethod: "in_app", ownerConfirmedHandoff: false, handoffConfirmDeadline: null,
    acceptedAt: new Date(Date.now() - 48 * HOUR - 4 * DAY),
  });
  const recentDeposit = await newRequest({
    status: "ACCEPTED", depositMethod: "in_app", ownerConfirmedHandoff: false, handoffConfirmDeadline: null,
    acceptedAt: new Date(Date.now() - 48 * HOUR - 2 * DAY),
  });
  const ids = [old.id, recent.id, oldDeposit.id, recentDeposit.id];
  // Compare each old request's own state; balances legitimately change when the recent one confirms.
  const ownState = async (r: { id: number; itemId: number }) => {
    const { borrowerCoins, ownerCoins, ...own } = await snapshot(r.id, r.itemId);
    return own;
  };
  const beforeOld = [await ownState(old), await ownState(oldDeposit)];

  const dry = await run(ids, { dryRun: true, maxDeadlineAgeMs: HANDOFF_SWEEP_MAX_DEADLINE_AGE_MS });
  assert.deepEqual(
    dry.candidates.map((c) => c.requestId).sort((a, b) => a - b),
    [recent.id, recentDeposit.id].sort((a, b) => a - b),
  );

  const live = await run(ids, { maxDeadlineAgeMs: HANDOFF_SWEEP_MAX_DEADLINE_AGE_MS });
  assert.equal(live.autoAdvancedCount, 1);
  assert.equal(live.depositExpiredCount, 1);
  assert.deepEqual([await ownState(old), await ownState(oldDeposit)], beforeOld);
  assert.equal((await snapshot(recent.id, recent.itemId)).status, "IN_PROGRESS");
  assert.equal((await snapshot(recentDeposit.id, recentDeposit.itemId)).status, "CANCELLED");
});

test("without a cutoff (the endpoint) old deadlines are still processed", async () => {
  const old = await newRequest({ handoffConfirmDeadline: new Date(Date.now() - 10 * DAY) });
  const result = await run([old.id]);
  assert.equal(result.autoAdvancedCount, 1);
  assert.equal((await snapshot(old.id, old.itemId)).status, "IN_PROGRESS");
});

// ── interval wrapper and mode ──────────────────────────────────────────────────

test("sweep mode defaults to dry-run and only an explicit 'live' applies changes", () => {
  assert.equal(resolveHandoffSweepMode(undefined), "dry-run");
  assert.equal(resolveHandoffSweepMode(""), "dry-run");
  assert.equal(resolveHandoffSweepMode("true"), "dry-run");
  assert.equal(resolveHandoffSweepMode("LIVE"), "live");
  assert.equal(resolveHandoffSweepMode(" live "), "live");
  assert.equal(resolveHandoffSweepMode("off"), "off");
});

test("the dry-run sweep logs each candidate once and changes nothing", async () => {
  resetHandoffSweepReportState();
  const { id, itemId } = await newRequest();
  const before = await snapshot(id, itemId);
  const lines: string[] = [];

  await runHandoffDeadlineSweep(deps, "dry-run", (line) => lines.push(line), { onlyRequestIds: [id] });
  await runHandoffDeadlineSweep(deps, "dry-run", (line) => lines.push(line), { onlyRequestIds: [id] });

  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`DRY-RUN would change request ${id} `));
  assert.match(lines[0], /auto_confirm/);
  assert.deepEqual(await snapshot(id, itemId), before);
});

test("the live sweep applies the transition and logs a summary", async () => {
  await setCoins(borrowerId, "50.00");
  const { id, itemId } = await newRequest();
  const lines: string[] = [];

  const result = await runHandoffDeadlineSweep(deps, "live", (line) => lines.push(line), { onlyRequestIds: [id] });
  assert.equal(result.autoAdvancedCount, 1);
  assert.equal((await snapshot(id, itemId)).status, "IN_PROGRESS");
  assert.equal(lines.length, 1);
  assert.match(lines[0], /autoConfirmed=1/);
});
