import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, notifications, pool, users, verifications } from "@workspace/db";
import {
  applySandboxReset, describeResetPlan, findSandboxApprovedVerifications, RESET_NOTIFICATION_MESSAGE, RESET_NOTIFICATION_TYPE, RESET_REASON, RESET_STATUS,
} from "./persona-sandbox-reset.js";
import { parseArgs } from "./scripts/reset-sandbox-verifications.js";
import { getIdVerificationSummary } from "./verification.js";

const unique = `sandbox-reset-${Date.now()}`;
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const cutoff = daysAgo(1); // "the production key went live a day ago"
const KEYS = ["plain", "mixed", "pending", "rejected", "legacy", "double"] as const;
const ids = {} as Record<(typeof KEYS)[number], number>;
const allIds = () => Object.values(ids);

const approved = (userId: number, inquiry: string | null, createdAt: Date) =>
  ({ userId, status: "approved", personaStatus: inquiry ? "approved" : null, personaInquiryId: inquiry, idNumber: inquiry ? "PERSONA_VERIFIED" : "LEGACY-1234", fullName: "Ada Lovelace", createdAt });

before(async () => {
  for (const key of KEYS) {
    const verified = key !== "double" && key !== "pending" && key !== "rejected";
    const [u] = await db.insert(users).values({ username: `${unique}-${key}`, password: "x", emailVerified: true, isVerified: verified, verifiedAt: verified ? daysAgo(2) : null }).returning();
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
  ]);
});

after(async () => {
  try {
    await db.delete(notifications).where(inArray(notifications.userId, allIds()));
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
const notesOf = (userId: number) => db.select().from(notifications).where(eq(notifications.userId, userId));

test("the dry run lists Persona approvals before the cutoff, and only those", async () => {
  const found = await mine({ before: cutoff });
  assert.deepEqual(found.map((c) => c.userId).sort(), [ids.plain, ids.mixed, ids.double].sort(), "not pending, rejected or legacy (no inquiry id)");
  assert.equal(found.find((c) => c.userId === ids.mixed)!.verificationIds.length, 1, "the approval made after the cutoff is not listed");
  assert.equal(found.find((c) => c.userId === ids.double)!.verificationIds.length, 2);
  assert.equal((await mine()).find((c) => c.userId === ids.mixed)!.verificationIds.length, 2, "without a cutoff both are listed");

  const text = describeResetPlan(found, { before: cutoff });
  assert.match(text, /3 member\(s\)/);
  assert.match(text, new RegExp(`user ${ids.plain} `));
  assert.doesNotMatch(text, /--before=/, "the hint is only for a run without a cutoff");
  const noCutoff = describeResetPlan(await mine(), { now: new Date("2026-11-12T09:00:00Z") });
  assert.match(noCutoff, /--before=2026-11-12T09:00:00.000Z/);
  // The dry run changed nothing.
  assert.equal((await rowsOf(ids.plain))[0].status, "approved");
  assert.equal((await notesOf(ids.plain)).length, 0);
});

test("the options: --apply and a valid --before", () => {
  assert.deepEqual(parseArgs([]), { apply: false });
  assert.deepEqual(parseArgs(["--apply"]), { apply: true });
  assert.equal(parseArgs(["--apply", "--before=2026-11-12T09:00:00Z"]).before?.toISOString(), "2026-11-12T09:00:00.000Z");
  assert.match(parseArgs(["--before=yesterday"]).error ?? "", /ISO time/);
});

test("--apply resets the approvals, clears the badge, records the reason and notifies each member once", async () => {
  const result = await applySandboxReset(await mine({ before: cutoff }));
  assert.deepEqual(result, { members: 3, verificationsReset: 4, badgesCleared: 1, notified: 3, failed: [] });

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

  for (const key of ["plain", "mixed", "double"] as const) {
    const notes = await notesOf(ids[key]);
    assert.equal(notes.length, 1, `${key}: one notification, not one per verification`);
    assert.deepEqual([notes[0].type, notes[0].message, notes[0].isRead], [RESET_NOTIFICATION_TYPE, RESET_NOTIFICATION_MESSAGE, false]);
  }
  assert.doesNotMatch(RESET_NOTIFICATION_MESSAGE, /csrf|token/i);
  for (const key of ["legacy", "pending", "rejected"] as const) assert.equal((await notesOf(ids[key])).length, 0, `${key}: not notified`);
});

test("running it again finds nothing and notifies nobody twice", async () => {
  assert.deepEqual(await mine({ before: cutoff }), []);
  // Even the old candidate list, applied again, changes nothing: rows that are no longer "approved" are skipped.
  const stale = [{ userId: ids.plain, username: null, verificationIds: [(await rowsOf(ids.plain))[0].id], inquiryIds: [], firstCreatedAt: null, lastCreatedAt: null, isVerified: true }];
  assert.deepEqual(await applySandboxReset(stale), { members: 0, verificationsReset: 0, badgesCleared: 0, notified: 0, failed: [] });
  assert.equal((await notesOf(ids.plain)).length, 1);
});
