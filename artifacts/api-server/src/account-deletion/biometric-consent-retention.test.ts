import assert from "node:assert/strict";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { biometricConsents, db, pool, users } from "@workspace/db";
import { hashPassword } from "../auth.js";
import { BIOMETRIC_CONSENT_VERSION } from "../biometric-consent.js";
import { BIOMETRIC_CONSENT_RETAIN_ENV, biometricConsentSurvivesDeletion } from "./retention.js";
import { finalizeDeletion, type DeletionDeps } from "./service.js";

const UNIQUE = `biometric-retention-${Date.now()}`;
const userIds: number[] = [];
let counter = 0;
const baseDeps: DeletionDeps = { stripeCleanup: async () => {}, sendDeletedEmail: async () => {}, removeUpload: async () => {} };

async function consentedMember() {
  const n = ++counter;
  const [user] = await db.insert(users).values({
    username: `${UNIQUE}-${n}@example.com`, password: await hashPassword("Retain!42"), emailVerified: true, handle: `${UNIQUE}h${n}`, referralCode: `${UNIQUE}r${n}`,
    fullName: "Ada Lovelace", displayName: "Ada", accountStatus: "pending_deletion", deletionRequestedAt: new Date(Date.now() - 20 * 24 * 3_600_000),
  }).returning();
  userIds.push(user.id);
  const consentedAt = new Date("2026-11-09T12:00:00.000Z");
  await db.insert(biometricConsents).values({ userId: user.id, version: BIOMETRIC_CONSENT_VERSION, consentedAt });
  return { userId: user.id, consentedAt };
}
const consentRows = (userId: number) => db.select().from(biometricConsents).where(eq(biometricConsents.userId, userId));

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(biometricConsents).where(inArray(biometricConsents.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  } finally {
    await pool.end();
  }
});

test("the setting defaults to keeping the record; only an explicit false, 0, off or no deletes it", () => {
  assert.equal(biometricConsentSurvivesDeletion({}), true);
  assert.equal(biometricConsentSurvivesDeletion({ [BIOMETRIC_CONSENT_RETAIN_ENV]: "" }), true);
  assert.equal(biometricConsentSurvivesDeletion({ [BIOMETRIC_CONSENT_RETAIN_ENV]: "true" }), true);
  assert.equal(biometricConsentSurvivesDeletion({ [BIOMETRIC_CONSENT_RETAIN_ENV]: "yes" }), true, "anything unclear keeps it");
  for (const off of ["false", "FALSE", " off ", "0", "no"]) assert.equal(biometricConsentSurvivesDeletion({ [BIOMETRIC_CONSENT_RETAIN_ENV]: off }), false, off);
});

test("by default the minimal consent record (user id, time, version) survives the deletion, and the name does not", async () => {
  const { userId, consentedAt } = await consentedMember();
  await finalizeDeletion(userId, { ...baseDeps, env: {} });
  const rows = await consentRows(userId);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].userId, rows[0].version, rows[0].consentedAt.toISOString()], [userId, BIOMETRIC_CONSENT_VERSION, consentedAt.toISOString()]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["consentedAt", "id", "userId", "version"], "the record holds nothing else");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  assert.deepEqual([user.accountStatus, user.fullName, user.displayName], ["deleted", null, "Former member"], "the account it points at is anonymized");
});

test("with BIOMETRIC_CONSENT_RETAIN_AFTER_DELETION=false the record is deleted with the account", async () => {
  const { userId } = await consentedMember();
  await finalizeDeletion(userId, { ...baseDeps, env: { [BIOMETRIC_CONSENT_RETAIN_ENV]: "false" } });
  assert.equal((await consentRows(userId)).length, 0);
  assert.equal((await db.select().from(users).where(eq(users.id, userId)))[0].accountStatus, "deleted");
});

test("a deletion with no consent record works either way", async () => {
  const [user] = await db.insert(users).values({ username: `${UNIQUE}-none@example.com`, password: "x", emailVerified: true, handle: `${UNIQUE}hn`, referralCode: `${UNIQUE}rn`, accountStatus: "pending_deletion", deletionRequestedAt: new Date(Date.now() - 20 * 24 * 3_600_000) }).returning();
  userIds.push(user.id);
  assert.equal((await finalizeDeletion(user.id, { ...baseDeps, env: { [BIOMETRIC_CONSENT_RETAIN_ENV]: "false" } })).deleted, true);
});
