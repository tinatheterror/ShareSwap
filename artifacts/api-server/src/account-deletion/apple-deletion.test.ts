import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { appleLinks, bannedAppleHashes, db, pool, users } from "@workspace/db";
import { encryptAppleToken } from "../apple-auth.js";
import { createAppleCleanup } from "./apple-cleanup.js";
import { hashBannedAppleSub, isBannedAppleSub } from "./banned-apple.js";
import { DeletionError, finalizeDeletion, type DeletionDeps } from "./service.js";

// Deleting an account signed in with Apple: Apple's grant is revoked first (Apple requires it), the deletion waits
// when Apple cannot be told, and a banned person's Apple ID is blocked afterwards by a keyed hash.

const UNIQUE = `appdel-${Date.now()}`;
const KEY = "apple-test-hash-key";
const ENC_KEY = Buffer.alloc(32, 5).toString("base64");
const BUNDLE_ID = "com.shareswap.mobile";
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const env = {
  BANNED_EMAIL_HASH_KEY: KEY,
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_KEY_ID: "KEY1234567",
  APPLE_PRIVATE_KEY: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  APPLE_SERVICES_ID: "app.shareswap.web.test",
  APPLE_TOKEN_ENCRYPTION_KEY: ENC_KEY,
} as NodeJS.ProcessEnv;
const userIds: number[] = [];
const subs: string[] = [];
let counter = 0;

after(async () => {
  try {
    if (userIds.length) {
      await db.delete(appleLinks).where(inArray(appleLinks.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    for (const sub of subs) await db.delete(bannedAppleHashes).where(eq(bannedAppleHashes.subHash, hashBannedAppleSub(sub, env)));
  } finally {
    await pool.end();
  }
});

async function makeAppleUser(label: string, opts: { token?: boolean; banned?: boolean } = { token: true }) {
  const n = ++counter;
  const sub = `${UNIQUE}.${label}`;
  subs.push(sub);
  const [row] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-${label}`,
      handle: `${UNIQUE}h${n}`,
      referralCode: `${UNIQUE}r${n}`,
      displayName: `Name ${label}`,
      email: `${UNIQUE}-${label}@example.com`,
      appleId: sub,
      authProvider: "apple",
      accountStatus: opts.banned ? "banned" : "pending_deletion",
      bannedAt: opts.banned ? new Date() : null,
      deletionRequestedAt: new Date(Date.now() - 20 * 24 * 3_600_000),
    })
    .returning();
  userIds.push(row.id);
  await db.insert(appleLinks).values({ userId: row.id, refreshTokenEnc: opts.token === false ? null : encryptAppleToken({ refreshToken: `refresh-${label}`, clientId: BUNDLE_ID }, env) });
  return { ...row, sub };
}

const baseDeps = (extra: Partial<DeletionDeps> = {}): DeletionDeps => ({
  env,
  sendRequestedEmail: async () => undefined,
  sendDeletedEmail: async () => undefined,
  stripeCleanup: async () => undefined,
  removeUpload: async () => undefined,
  ...extra,
});

const row = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];
const link = async (id: number) => (await db.select().from(appleLinks).where(eq(appleLinks.userId, id)))[0];

function fakeApple(status: number, body = "") {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, form: new URLSearchParams(init.body) });
    return { ok: status < 300, status, json: async () => ({}), text: async () => body };
  };
  return { fetch: fetch as any, calls };
}

test("deleting revokes the stored refresh token with the client id it was issued to, then removes the Apple ID and link", async () => {
  const user = await makeAppleUser("revoke");
  const apple = fakeApple(200);
  const result = await finalizeDeletion(user.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: apple.fetch }) }));
  assert.equal(result.deleted, true);
  assert.equal(apple.calls.length, 1);
  assert.equal(apple.calls[0].url, "https://appleid.apple.com/auth/revoke");
  assert.deepEqual([apple.calls[0].form.get("token"), apple.calls[0].form.get("client_id"), apple.calls[0].form.get("token_type_hint")], ["refresh-revoke", BUNDLE_ID, "refresh_token"]);
  const after = await row(user.id);
  assert.equal(after.accountStatus, "deleted");
  assert.equal(after.appleId, null);
  assert.equal(await link(user.id), undefined);
});

test("when Apple cannot be reached nothing is deleted and the retry finishes the job", async () => {
  const user = await makeAppleUser("retry");
  const down = fakeApple(503);
  await assert.rejects(finalizeDeletion(user.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: down.fetch }) })), (e: DeletionError) => e.code === "apple_revocation_pending" && e.status === 503);
  assert.equal((await row(user.id)).appleId, user.sub, "an account whose Apple revocation failed is untouched");
  assert.ok((await link(user.id))?.refreshTokenEnc);
  const up = fakeApple(200);
  await finalizeDeletion(user.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: up.fetch }) }));
  assert.equal((await row(user.id)).accountStatus, "deleted");
  assert.equal(up.calls.length, 1);
});

test("missing Apple settings also hold the deletion back, and an account signed in with Apple is not deleted with no cleanup configured", async () => {
  const user = await makeAppleUser("noconfig");
  const noSettings = createAppleCleanup({ env: { ...env, APPLE_TEAM_ID: "" }, fetch: fakeApple(200).fetch });
  await assert.rejects(finalizeDeletion(user.id, baseDeps({ appleCleanup: noSettings })), (e: DeletionError) => e.code === "apple_revocation_pending");
  await assert.rejects(finalizeDeletion(user.id, baseDeps({ appleCleanup: undefined })), (e: DeletionError) => e.code === "apple_cleanup_unavailable");
  assert.equal((await row(user.id)).accountStatus, "pending_deletion");
});

test("a token Apple calls invalid, or one we cannot read, is skipped: retrying could not change that", async () => {
  const refused = await makeAppleUser("refused");
  await finalizeDeletion(refused.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: fakeApple(401, '{"error":"invalid_client"}').fetch }) }));
  assert.equal((await row(refused.id)).accountStatus, "deleted");

  const already = await makeAppleUser("already");
  await finalizeDeletion(already.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: fakeApple(400, '{"error":"invalid_grant"}').fetch }) }));
  assert.equal((await row(already.id)).accountStatus, "deleted");

  const garbled = await makeAppleUser("garbled");
  await db.update(appleLinks).set({ refreshTokenEnc: "v1.bad.bad.bad" }).where(eq(appleLinks.userId, garbled.id));
  const apple = fakeApple(200);
  await finalizeDeletion(garbled.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: apple.fetch }) }));
  assert.equal(apple.calls.length, 0);
  assert.equal((await row(garbled.id)).accountStatus, "deleted");
});

test("an Apple account that never kept a refresh token deletes without calling Apple", async () => {
  const user = await makeAppleUser("notoken", { token: false });
  const apple = fakeApple(200);
  await finalizeDeletion(user.id, baseDeps({ appleCleanup: createAppleCleanup({ env, fetch: apple.fetch }) }));
  assert.equal(apple.calls.length, 0);
  assert.equal(await link(user.id), undefined);
});

test("deleting a banned account records a keyed hash of the Apple ID, never the ID, and fails closed without the key", async () => {
  const user = await makeAppleUser("banned", { token: false, banned: true });
  await assert.rejects(finalizeDeletion(user.id, baseDeps({ env: { ...env, BANNED_EMAIL_HASH_KEY: "" } })), /BANNED_EMAIL_HASH_KEY/);
  assert.equal((await row(user.id)).accountStatus, "banned");

  await finalizeDeletion(user.id, baseDeps());
  const expected = hashBannedAppleSub(user.sub, env);
  const stored = await db.select().from(bannedAppleHashes).where(eq(bannedAppleHashes.subHash, expected));
  assert.equal(stored.length, 1);
  assert.ok(!stored[0].subHash.includes(user.sub));
  assert.equal((await row(user.id)).appleId, null);

  // The block is keyed and separate from the email block: the same text hashed as an email is a different value.
  const previous = process.env.BANNED_EMAIL_HASH_KEY;
  process.env.BANNED_EMAIL_HASH_KEY = KEY;
  try {
    assert.equal(await isBannedAppleSub(user.sub), true);
    assert.equal(await isBannedAppleSub(`${user.sub}-other`), false);
  } finally {
    if (previous === undefined) delete process.env.BANNED_EMAIL_HASH_KEY;
    else process.env.BANNED_EMAIL_HASH_KEY = previous;
  }
});

test("an account that was not banned leaves no Apple hash behind", async () => {
  const user = await makeAppleUser("plain", { token: false });
  const before = (await db.select().from(bannedAppleHashes)).length;
  await finalizeDeletion(user.id, baseDeps());
  assert.equal((await db.select().from(bannedAppleHashes)).length, before);
});
