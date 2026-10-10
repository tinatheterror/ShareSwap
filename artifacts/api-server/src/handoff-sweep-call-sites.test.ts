import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express from "express";
import { inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, shareCoinsTransactions, users } from "@workspace/db";
import { registerRoutes, type ScheduledJobRunners } from "./routes/routes.js";

// The scheduled-jobs script reaches the handoff sweep through registerRoutes' onScheduledJobs
// runners. That runner must pass requestTypes BORROW/RENT, so a SWAP is never selected. Dry run only:
// it reads and reports, so it is safe on any test database. (The in-process timer's call site is
// covered in timer-switch-wiring.test.ts.)

const UNIQUE = `handoff-call-sites-${Date.now()}`;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];
let runners: ScheduledJobRunners;
let swapId: number;
let borrowId: number;

before(async () => {
  const [owner, borrower] = await db
    .insert(users)
    .values([
      { username: `${UNIQUE}-owner`, password: "x", emailVerified: true, shareCoins: "0.00" },
      { username: `${UNIQUE}-borrower`, password: "x", emailVerified: true, shareCoins: "50.00" },
    ])
    .returning({ id: users.id });
  userIds.push(owner.id, borrower.id);
  const mk = async (requestType: string) => {
    const [item] = await db
      .insert(items)
      .values({
        ownerId: owner.id, name: `${UNIQUE}-${requestType}`, description: "x", conditionRating: 4, photos: [],
        isLendable: true, isRentable: true, isSwappable: true, isGift: true, isAvailable: true,
        replacementValue: 100, securityDeposit: "10.00", lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
      })
      .returning({ id: items.id });
    itemIds.push(item.id);
    const [request] = await db
      .insert(itemRequests)
      .values({
        itemId: item.id, requesterId: borrower.id, requestType, status: "AWAITING_HANDOFF_CONFIRM",
        startDate: new Date("2026-10-01T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"),
        ownerConfirmedHandoff: true, borrowerConfirmedHandoff: false,
        handoffConfirmDeadline: new Date(Date.now() - 3_600_000),
      })
      .returning({ id: itemRequests.id });
    requestIds.push(request.id);
    return request.id;
  };
  swapId = await mk("SWAP");
  borrowId = await mk("BORROW");
  registerRoutes(express(), { startBackgroundJobs: false, onScheduledJobs: (r) => (runners = r) });
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

test("the scheduled-jobs handoff runner selects the BORROW and never the SWAP", async () => {
  assert.ok(runners, "registerRoutes handed out the runners");
  const lines: string[] = [];
  const result = await runners.runHandoffSweep("dry-run", (line) => lines.push(line));
  const ids = result.candidates.map((c) => c.requestId);
  assert.ok(ids.includes(borrowId), "the BORROW past its deadline is a candidate");
  assert.ok(!ids.includes(swapId), "the SWAP past its deadline is not");
  assert.ok(!lines.some((l) => l.includes(`request ${swapId} `)));
});
