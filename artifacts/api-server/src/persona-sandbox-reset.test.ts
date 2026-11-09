import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db, notifications, pool, reputationActivities, shareCoinsTransactions, users, verifications } from "@workspace/db";
import {
  applySandboxReset, APPROVAL_ACTIVITY_TYPE, APPROVAL_COINS_DESCRIPTION, describeResetPlan, findSandboxApprovedVerifications, plannedReversal, RESET_NOTIFICATION_MESSAGE,
  RESET_NOTIFICATION_TYPE, RESET_REASON, RESET_STATUS, REVERSAL_TYPE,
} from "./persona-sandbox-reset.js";
import { parseArgs } from "./scripts/reset-sandbox-verifications.js";
import { getIdVerificationSummary } from "./verification.js";

const unique = `sandbox-reset-${Date.now()}`;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const cutoff = daysAgo(1); // "the production key went live a day ago"
const KEYS = ["plain", "mixed", "pending", "rejected", "legacy", "double", "prior"] as const;
// Score and ShareCoins before the reset. double has less than the grants (the score 80 < 100, coins already spent: 3 < 10); prior was reversed before.
const START: Record<(typeof KEYS)[number], { score: number; coins: string }> = {
  plain: { score: 60, coins: "7.00" }, mixed: { score: 120, coins: "12.00" }, pending: { score: 33, coins: "1.00" }, rejected: { score: 44, coins: "2.00" },
  legacy: { score: 70, coins: "9.00" }, double: { score: 80, coins: "3.00" }, prior: { score: 10, coins: "4.00" },
};
const ids = {} as Record<(typeof KEYS)[number], number>;
const allIds = () => Object.values(ids);

const approved = (userId: number, inquiry: string | null, createdAt: Date) =>
  ({ userId, status: "approved", personaStatus: inquiry ? "approved" : null, personaInquiryId: inquiry, idNumber: inquiry ? "PERSONA_VERIFIED" : "LEGACY-1234", fullName: "Ada Lovelace", createdAt });

before(async () => {
  for (const key of KEYS) {
    const verified = key !== "double" && key !== "pending" && key !== "rejected" && key !== "prior";
    const [u] = await db.insert(users).values({ username: `${unique}-${key}`, password: "x", emailVerified: true, isVerified: verified, verifiedAt: verified ? daysAgo(2) : null, trustScore: START[key].score, reputationLevel: "Newcomer", shareCoins: START[key].coins }).returning();
    ids[key] = u.id;
  }
  await db.insert(verifications).values([
    approved(ids.plain, `inq_${unique}_plain`, daysAgo(3)),
    approved(ids.mixed, `inq_${unique}_mixed_old`, daysAgo(3)),
    approved(ids.mixed, `inq_${unique}_mixed_real`, new Date()), // created after the cutoff: a real one
    { userId: ids.pending, status: "pending", personaStatus: "pending", personaInquiryId: `inq_${unique}_pending`, createdAt: daysAgo(3) },
    { userId: ids.rejected, status: "rejected", personaStatus: "declined", personaInquiryId: `inq_${unique}_rejected`, createdAt: daysAgo(3) },
    approved(ids.legacy, null, daysAgo(30)), // not from Persona
    approved(ids.double, `inq_${unique}_double_1`, daysAgo(4)),
    approved(ids.double, `inq_${unique}_double_2`, daysAgo(3)),
    approved(ids.prior, `inq_${unique}_prior`, daysAgo(3)),
  ]);
  // What each approval granted (routes.ts, inquiry-complete): +50 trust and 5 ShareCoins. mixed's second one is the real approval after the cutoff.
  const grant = (key: (typeof KEYS)[number], when: Date) => Promise.all([
    db.insert(reputationActivities).values({ userId: ids[key], activityType: APPROVAL_ACTIVITY_TYPE, points: 50, description: "Identity verified via Persona (ID + selfie match)", createdAt: when }),
    db.insert(shareCoinsTransactions).values({ userId: ids[key], amount: "5", description: APPROVAL_COINS_DESCRIPTION, transactionType: "EARNED", createdAt: when }),
  ]);
  await grant("plain", daysAgo(3)); await grant("mixed", daysAgo(3)); await grant("mixed", new Date()); await grant("double", daysAgo(4)); await grant("double", daysAgo(3));
  await grant("legacy", daysAgo(30)); await grant("prior", daysAgo(3));
  // prior was already reversed once (by hand): that reversal is counted off, so it is not reversed a second time.
  await db.insert(reputationActivities).values({ userId: ids.prior, activityType: REVERSAL_TYPE, points: -50, description: "earlier reversal" });
  await db.insert(shareCoinsTransactions).values({ userId: ids.prior, amount: "-5", description: "earlier reversal", transactionType: REVERSAL_TYPE });
});

after(async () => {
  try {
    await db.delete(notifications).where(inArray(notifications.userId, allIds()));
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, allIds()));
    await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, allIds()));
    await db.delete(verifications).where(inArray(verifications.userId, allIds()));
    await db.delete(users).where(inArray(users.id, allIds()));
  } finally {
    await pool.end();
  }
});

// Other suites run at the same time and have approved Persona rows of their own: only ever look at and reset this file's members.
const mine = async (opts: { before?: Date } = {}) => (await findSandboxApprovedVerifications(opts)).filter((c) => allIds().includes(c.userId));
const rowsOf = (userId: number) => db.select().from(verifications).where(eq(verifications.userId, userId)).orderBy(verifications.id);
const userOf = async (userId: number) => (await db.select({ isVerified: users.isVerified, verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, userId)))[0];
const walletOf = async (userId: number) => (await db.select({ score: users.trustScore, level: users.reputationLevel, coins: users.shareCoins }).from(users).where(eq(users.id, userId)))[0];
const reversalsOf = async (userId: number) => ({
  trust: await db.select().from(reputationActivities).where(and(eq(reputationActivities.userId, userId), eq(reputationActivities.activityType, REVERSAL_TYPE))).orderBy(reputationActivities.id),
  coins: await db.select().from(shareCoinsTransactions).where(and(eq(shareCoinsTransactions.userId, userId), eq(shareCoinsTransactions.transactionType, REVERSAL_TYPE))).orderBy(shareCoinsTransactions.id),
});
const notesOf = (userId: number) => db.select().from(notifications).where(eq(notifications.userId, userId));

test("the dry run lists Persona approvals before the cutoff, and only those", async () => {
  const found = await mine({ before: cutoff });
  assert.deepEqual(found.map((c) => c.userId).sort(), [ids.plain, ids.mixed, ids.double, ids.prior].sort(), "not pending, rejected or legacy (no inquiry id)");
  assert.equal(found.find((c) => c.userId === ids.mixed)!.verificationIds.length, 1, "the approval made after the cutoff is not listed");
  assert.equal(found.find((c) => c.userId === ids.double)!.verificationIds.length, 2);
  assert.equal((await mine()).find((c) => c.userId === ids.mixed)!.verificationIds.length, 2, "without a cutoff both are listed");

  const text = describeResetPlan(found, { before: cutoff });
  assert.match(text, /4 member\(s\)/);
  assert.match(text, new RegExp(`user ${ids.plain} .*takes back 50 trust points and 5 ShareCoins`));
  assert.match(text, new RegExp(`user ${ids.double} .*takes back 100 trust points and 10 ShareCoins`));
  assert.match(text, new RegExp(`user ${ids.mixed} .*takes back 50 trust points and 5 ShareCoins`), "mixed's real grant after the cutoff is not planned");
  assert.match(text, new RegExp(`user ${ids.prior} .*takes back 0 trust points and 0 ShareCoins`), "already reversed once");
  assert.match(text, /Total to take back: \d+ trust points and \d+ ShareCoins/);
  const plans = Object.fromEntries(found.map((c) => [c.userId, plannedReversal(c)]));
  assert.deepEqual([plans[ids.plain], plans[ids.mixed], plans[ids.double], plans[ids.prior]], [{ trust: 50, coins: 5 }, { trust: 50, coins: 5 }, { trust: 100, coins: 10 }, { trust: 0, coins: 0 }]);
  assert.doesNotMatch(text, /--before=/, "the hint is only for a run without a cutoff");
  const noCutoff = describeResetPlan(await mine(), { now: new Date("2026-11-12T09:00:00Z") });
  assert.match(noCutoff, /--before=2026-11-12T09:00:00.000Z/);
  // The dry run changed nothing.
  assert.equal((await rowsOf(ids.plain))[0].status, "approved");
  assert.equal((await notesOf(ids.plain)).length, 0);
  assert.deepEqual(await walletOf(ids.plain), { score: 60, level: "Newcomer", coins: "7.00" });
});

test("the options: --apply and a valid --before", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  assert.equal(parseArgs(["--apply", "--before=2026-11-12T09:00:00Z"]).before?.toISOString(), "2026-11-12T09:00:00.000Z");
  assert.match(parseArgs(["--before=yesterday"]).error ?? "", /ISO time/);
});

test("--apply resets the approvals, clears the badge, records the reason and notifies each member once", async () => {
  const result = await applySandboxReset(await mine({ before: cutoff }));
  assert.deepEqual(result, {
    members: 4, verificationsReset: 5, badgesCleared: 1, notified: 4, trustPointsTakenBack: 50 + 50 + 80 + 0, shareCoinsTakenBack: 5 + 5 + 3 + 0,
    shortfalls: [{ userId: ids.double, trust: 20, coins: 7 }], failed: [],
  });

  const [plain] = await rowsOf(ids.plain);
  assert.deepEqual([plain.status, plain.idNumber], [RESET_STATUS, RESET_REASON]);
  assert.equal(plain.personaStatus, "approved", "what Persona said is kept as it was");
  assert.deepEqual(await userOf(ids.plain), { isVerified: false, verifiedAt: null });
  assert.equal((await getIdVerificationSummary(ids.plain)).status, "unverified", "the member can start again");

  const [mixedOld, mixedReal] = await rowsOf(ids.mixed);
  assert.equal(mixedOld.status, RESET_STATUS);
  assert.deepEqual([mixedReal.status, mixedReal.idNumber], ["approved", "PERSONA_VERIFIED"], "a real approval after the cutoff is untouched");
  assert.equal((await userOf(ids.mixed)).isVerified, true, "and keeps the badge");
  assert.equal((await getIdVerificationSummary(ids.mixed)).status, "verified");

  assert.deepEqual((await rowsOf(ids.double)).map((r) => r.status), [RESET_STATUS, RESET_STATUS]);
  assert.equal((await userOf(ids.double)).isVerified, false);

  assert.equal((await rowsOf(ids.legacy))[0].status, "approved", "a legacy approval (no Persona inquiry) is left alone");
  assert.equal((await userOf(ids.legacy)).isVerified, true);
  assert.equal((await rowsOf(ids.pending))[0].status, "pending");
  assert.equal((await rowsOf(ids.rejected))[0].status, "rejected");

  // Trust score and ShareCoins: what the approvals granted is taken back, with a negative ledger row for each, and never below 0.
  assert.deepEqual(await walletOf(ids.plain), { score: 10, level: "Newcomer", coins: "2.00" });
  assert.deepEqual(await walletOf(ids.mixed), { score: 70, level: "Neighbour", coins: "7.00" }, "only the sandbox grant, not the real one made after the cutoff");
  assert.deepEqual(await walletOf(ids.double), { score: 0, level: "Newcomer", coins: "0.00" }, "stops at 0");
  assert.deepEqual(await walletOf(ids.prior), { score: 10, level: "Newcomer", coins: "4.00" }, "already reversed once: nothing more is taken");
  assert.deepEqual(await walletOf(ids.legacy), { score: 70, level: "Newcomer", coins: "9.00" });
  assert.deepEqual(await walletOf(ids.pending), { score: 33, level: "Newcomer", coins: "1.00" });
  const plainLedger = await reversalsOf(ids.plain);
  assert.deepEqual(plainLedger.trust.map((r) => r.points), [-50]);
  assert.deepEqual(plainLedger.coins.map((r) => Number(r.amount)), [-5]);
  assert.match(plainLedger.trust[0].description, /simulated/);
  const double = await reversalsOf(ids.double);
  assert.deepEqual(double.trust.map((r) => r.points), [-50, -30], "one row per grant, the second only what was left");
  assert.deepEqual(double.coins.map((r) => Number(r.amount)), [-3, 0]);
  assert.match(double.trust[1].description, /took 30 of 50/);
  assert.match(double.coins[0].description, /took 3 of 5/);
  assert.equal((await reversalsOf(ids.prior)).trust.length, 1, "prior keeps only its earlier reversal");
  assert.equal((await reversalsOf(ids.legacy)).trust.length, 0);

  for (const key of ["plain", "mixed", "double"] as const) {
    const notes = await notesOf(ids[key]);
    assert.equal(notes.length, 1, `${key}: one notification, not one per verification`);
    assert.deepEqual([notes[0].type, notes[0].message, notes[0].isRead], [RESET_NOTIFICATION_TYPE, RESET_NOTIFICATION_MESSAGE, false]);
  }
  assert.doesNotMatch(RESET_NOTIFICATION_MESSAGE, /csrf|token/i);
  for (const key of ["legacy", "pending", "rejected"] as const) assert.equal((await notesOf(ids[key])).length, 0, `${key}: not notified`);
  assert.equal((await notesOf(ids.prior)).length, 1);
});

test("running it again finds nothing and notifies nobody twice", async () => {
  assert.deepEqual(await mine({ before: cutoff }), []);
  // Even the old candidate list, applied again, changes nothing: rows that are no longer "approved" are skipped.
  const stale = [{ userId: ids.plain, username: null, verificationIds: [(await rowsOf(ids.plain))[0].id], inquiryIds: [], firstCreatedAt: null, lastCreatedAt: null, isVerified: true, trustGrants: [{ id: 1, amount: 50 }], coinGrants: [{ id: 1, amount: 5 }] }];
  assert.deepEqual(await applySandboxReset(stale), { members: 0, verificationsReset: 0, badgesCleared: 0, notified: 0, trustPointsTakenBack: 0, shareCoinsTakenBack: 0, shortfalls: [], failed: [] });
  assert.equal((await notesOf(ids.plain)).length, 1);
  assert.deepEqual(await walletOf(ids.plain), { score: 10, level: "Newcomer", coins: "2.00" }, "a second run takes nothing more");
});
