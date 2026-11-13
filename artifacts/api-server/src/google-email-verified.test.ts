import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import passport from "passport";
import { db, pool, users } from "@workspace/db";
import { startApp } from "./auth-test-client.js";

const UNIQUE = `google-email-verified-${Date.now()}`;
const userIds: number[] = [];
let closeServer: () => Promise<void>;
let counter = 0;
const previousGoogle = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  ({ close: closeServer } = await startApp());
});

after(async () => {
  try {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    for (const [name, value] of [["GOOGLE_CLIENT_ID", previousGoogle.id], ["GOOGLE_CLIENT_SECRET", previousGoogle.secret]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeServer?.();
    await pool.end();
  }
});

/** A Google-linked account that has not verified its email, holding `email` (or none). */
async function googleAccount(email: string | null) {
  const googleId = `${UNIQUE}-gid-${counter++}`;
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${counter}`, email, googleId, authProvider: "google", password: null, emailVerified: false })
    .returning({ id: users.id, googleId: users.googleId });
  userIds.push(row.id);
  return row;
}

/** Signs the account in again through the real Google strategy with a profile carrying `email`. */
const signInAgain = (googleId: string, email: string, verified: boolean) =>
  new Promise<void>((resolve, reject) => {
    const profile = { id: googleId, emails: [{ value: email, verified }], _json: { email_verified: verified } };
    (passport as any)._strategy("google")._verify({ session: {} }, "a", "r", profile, (error: unknown, user: unknown) => (user ? resolve() : reject(error ?? new Error("refused"))));
  });

const stored = async (id: number) => (await db.select({ email: users.email, emailVerified: users.emailVerified }).from(users).where(eq(users.id, id)))[0];

test("signing in again marks the stored email verified when Google's verified email is the same address (any case)", async () => {
  const account = await googleAccount(`${UNIQUE}.Same@Example.com`);
  await signInAgain(account.googleId!, `${UNIQUE}.same@example.com`, true);
  assert.deepEqual(await stored(account.id), { email: `${UNIQUE}.Same@Example.com`, emailVerified: true });
});

test("signing in again never marks a different stored email verified, even if Google's email is verified", async () => {
  const email = `${UNIQUE}.kept@example.com`;
  const account = await googleAccount(email);
  await signInAgain(account.googleId!, `${UNIQUE}.other@example.com`, true);
  assert.deepEqual(await stored(account.id), { email, emailVerified: false });
});

test("an account with no stored email takes Google's email and is marked verified when Google verified it, but not when it did not", async () => {
  const verified = await googleAccount(null);
  await signInAgain(verified.googleId!, `${UNIQUE}.empty@example.com`, true);
  assert.deepEqual(await stored(verified.id), { email: `${UNIQUE}.empty@example.com`, emailVerified: true });

  const unverified = await googleAccount(null);
  await signInAgain(unverified.googleId!, `${UNIQUE}.empty2@example.com`, false);
  assert.deepEqual(await stored(unverified.id), { email: `${UNIQUE}.empty2@example.com`, emailVerified: false });
});
