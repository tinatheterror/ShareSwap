import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { eq, inArray, like } from "drizzle-orm";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { appleLinks, bannedAppleHashes, db, pool, users } from "@workspace/db";
import { hashBannedAppleSub } from "./account-deletion/banned-apple.js";
import { appleRuntime } from "./apple-routes.js";
import { decryptAppleToken, sha256Hex } from "./apple-auth.js";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";

const UNIQUE = `apple-${Date.now()}`;
const SERVICES_ID = "app.shareswap.web.test";
const BUNDLE_ID = "com.shareswap.mobile";
const ENC_KEY = Buffer.alloc(32, 9).toString("base64");
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const subs: string[] = [];
const extraUserIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let signingKey: CryptoKey;
const exchangeCalls: URLSearchParams[] = [];
const previousKey = process.env.BANNED_EMAIL_HASH_KEY;

const clearLimiter = () => pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
const newSub = (label: string) => {
  const sub = `${UNIQUE}.${label}`;
  subs.push(sub);
  return sub;
};

before(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  appleRuntime.keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" }] });
  appleRuntime.env = {
    ...process.env,
    APPLE_TEAM_ID: "TEAM123456",
    APPLE_KEY_ID: "KEY1234567",
    APPLE_PRIVATE_KEY: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    APPLE_SERVICES_ID: SERVICES_ID,
    APPLE_TOKEN_ENCRYPTION_KEY: ENC_KEY,
    CUSTOM_DOMAIN: "shareswap.test",
  };
  appleRuntime.fetch = async (_url, init) => {
    exchangeCalls.push(new URLSearchParams(init.body));
    return { ok: true, status: 200, json: async () => ({ refresh_token: "refresh-from-apple" }), text: async () => "" };
  };
  ({ baseUrl, close: closeServer } = await startApp());
  await clearLimiter();
});

after(async () => {
  try {
    const rows = await db.select({ id: users.id }).from(users).where(like(users.appleId, `${UNIQUE}.%`));
    const ids = [...rows.map((r) => r.id), ...extraUserIds];
    if (ids.length) {
      await pool.query("DELETE FROM native_oauth_tokens WHERE user_id = ANY($1)", [ids]).catch(() => undefined); // the table exists once a reactivation token was issued
      await db.delete(appleLinks).where(inArray(appleLinks.userId, ids));
      await db.delete(users).where(inArray(users.id, ids));
    }
    process.env.BANNED_EMAIL_HASH_KEY = "cleanup-key";
    for (const sub of subs) await db.delete(bannedAppleHashes).where(eq(bannedAppleHashes.subHash, hashBannedAppleSub(sub)));
    await clearLimiter();
  } finally {
    if (previousKey === undefined) delete process.env.BANNED_EMAIL_HASH_KEY;
    else process.env.BANNED_EMAIL_HASH_KEY = previousKey;
    appleRuntime.keys = undefined;
    appleRuntime.fetch = undefined;
    appleRuntime.env = process.env;
    await closeServer?.();
    await pool.end();
  }
});

// The login limiter counts refused sign-ins per IP (5 per 15 minutes), and several tests refuse on purpose.
beforeEach(clearLimiter);

async function token(claims: Record<string, unknown>, over: { aud?: string; key?: CryptoKey } = {}) {
  return new SignJWT(claims as any)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer("https://appleid.apple.com")
    .setAudience(over.aud ?? BUNDLE_ID)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(over.key ?? signingKey);
}

const RAW_NONCE = "a-long-random-raw-nonce-123456";
async function nativeBody(sub: string, claims: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { identityToken: await token({ sub, nonce: sha256Hex(RAW_NONCE), ...claims }), nonce: RAW_NONCE, authorizationCode: "code-1", ...extra };
}

async function userRow(sub: string) {
  const [row] = await db.select().from(users).where(eq(users.appleId, sub)).limit(1);
  return row;
}

test("a first native sign-in makes an account, uses the name Apple sent, keeps the encrypted refresh token and signs the person in", async () => {
  const sub = newSub("first");
  const client = new Client(baseUrl);
  const res = await client.post("/api/auth/apple/native", await nativeBody(sub, { email: `${UNIQUE}.first@example.com`, email_verified: "true" }, { fullName: { givenName: "Maria", familyName: "Lopez" } }));
  assert.equal(res.status, 200);
  const created = await userRow(sub);
  assert.equal(created.authProvider, "apple");
  assert.equal(created.displayName, "Maria L.");
  assert.equal(created.emailVerified, true);
  assert.equal(created.username, `${UNIQUE}.first`);
  const [link] = await db.select().from(appleLinks).where(eq(appleLinks.userId, created.id));
  assert.ok(link.refreshTokenEnc && !link.refreshTokenEnc.includes("refresh-from-apple"));
  assert.deepEqual(decryptAppleToken(link.refreshTokenEnc!, appleRuntime.env), { refreshToken: "refresh-from-apple", clientId: BUNDLE_ID });
  assert.equal(exchangeCalls.at(-1)?.get("client_id"), BUNDLE_ID);
  const me = await client.get("/api/user");
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { id: number }).id, created.id);
});

test("signing in again finds the same account even though Apple sends no name or email the second time", async () => {
  const sub = newSub("again");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub, { email: `${UNIQUE}.again@example.com`, email_verified: true }, { fullName: { givenName: "Ana", familyName: "Ruiz" } }));
  const first = await userRow(sub);
  const res = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { id: number }).id, first.id);
  assert.equal((await userRow(sub)).displayName, "Ana R.");
});

test("a private-relay address becomes the email but never the username or display name", async () => {
  const sub = newSub("relay");
  const res = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub, { email: "q7f3k2x9@privaterelay.appleid.com", email_verified: "true", is_private_email: "true" }));
  assert.equal(res.status, 200);
  const row = await userRow(sub);
  assert.equal(row.email, "q7f3k2x9@privaterelay.appleid.com");
  assert.match(row.username, /^apple_[0-9a-f]{10}$/);
  assert.equal(row.displayName, "Member");
  assert.ok(!row.username.includes(sub));
});

test("an existing account with the same verified email is linked, not duplicated", async () => {
  const email = `${UNIQUE}.link@example.com`;
  const [existing] = await db.insert(users).values({ username: `${UNIQUE}-link`, password: await hashPassword("Pw!123456"), email, emailVerified: true }).returning();
  extraUserIds.push(existing.id);
  const sub = newSub("link");
  const res = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub, { email: email.toUpperCase(), email_verified: "true" }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { id: number }).id, existing.id);
  assert.equal((await userRow(sub)).id, existing.id);
});

test("an unverified email on either side never links", async () => {
  const email = `${UNIQUE}.nolink@example.com`;
  const [unverified] = await db.insert(users).values({ username: `${UNIQUE}-nolink`, password: await hashPassword("Pw!123456"), email, emailVerified: false }).returning();
  extraUserIds.push(unverified.id);
  const a = newSub("nolink-a");
  const resA = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(a, { email, email_verified: "true" }));
  assert.equal(resA.status, 200);
  assert.notEqual(((await resA.json()) as { id: number }).id, unverified.id);

  const verifiedEmail = `${UNIQUE}.nolink2@example.com`;
  const [verified] = await db.insert(users).values({ username: `${UNIQUE}-nolink2`, password: await hashPassword("Pw!123456"), email: verifiedEmail, emailVerified: true }).returning();
  extraUserIds.push(verified.id);
  const b = newSub("nolink-b");
  const resB = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(b, { email: verifiedEmail, email_verified: "false" }));
  assert.notEqual(((await resB.json()) as { id: number }).id, verified.id);
  assert.equal((await db.select().from(users).where(eq(users.id, verified.id)))[0].appleId, null);
});

test("an account that already has a different Apple ID is not taken over by a second one", async () => {
  const email = `${UNIQUE}.two@example.com`;
  const first = newSub("two-a");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(first, { email, email_verified: true }));
  const second = newSub("two-b");
  const res = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(second, { email, email_verified: true }));
  assert.equal(res.status, 200);
  assert.notEqual((await userRow(second)).id, (await userRow(first)).id);
});

test("a bad nonce, a wrong audience, a forged signature and a missing token are all refused", async () => {
  const sub = newSub("bad");
  const other = await generateKeyPair("RS256");
  const attempts = [
    { ...(await nativeBody(sub)), nonce: "a-different-raw-nonce-123456" },
    { ...(await nativeBody(sub)), identityToken: await token({ sub, nonce: sha256Hex(RAW_NONCE) }, { aud: SERVICES_ID }) },
    { ...(await nativeBody(sub)), identityToken: await token({ sub, nonce: sha256Hex(RAW_NONCE) }, { key: other.privateKey }) },
    { nonce: RAW_NONCE },
  ];
  for (const body of attempts) {
    const res = await new Client(baseUrl).post("/api/auth/apple/native", body);
    assert.ok([400, 401].includes(res.status), `status ${res.status}`);
  }
  assert.equal(await userRow(sub), undefined);
});

test("a banned account and a banned Apple ID are refused", async () => {
  const sub = newSub("banned");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  await db.update(users).set({ accountStatus: "banned", bannedAt: new Date() }).where(eq(users.appleId, sub));
  assert.equal((await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub))).status, 403);

  // After the banned account is deleted the Apple ID is gone from users, and only the keyed hash is left.
  process.env.BANNED_EMAIL_HASH_KEY = "test-hash-key";
  const gone = newSub("banned-gone");
  await db.insert(bannedAppleHashes).values({ subHash: hashBannedAppleSub(gone) });
  const res = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(gone));
  assert.equal(res.status, 403);
  assert.equal(await userRow(gone), undefined);
});

test("a deactivated account is offered reactivation with a token that cannot sign in, and the token brings it back", async () => {
  const sub = newSub("deact");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  await db.update(users).set({ accountStatus: "deactivated", deactivatedAt: new Date() }).where(eq(users.appleId, sub));
  const res = await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  const body = (await res.json()) as { reactivate?: boolean; token?: string };
  assert.equal(res.status, 200);
  assert.equal(body.reactivate, true);
  assert.ok(body.token?.startsWith("reactivate-"));
  assert.equal((await new Client(baseUrl).post("/api/auth/exchange-token", { token: body.token })).status, 401);
  const client = new Client(baseUrl);
  const back = await client.post("/api/auth/oauth-reactivate", { token: body.token });
  assert.equal(back.status, 200);
  assert.equal((await userRow(sub)).accountStatus, "active");
  assert.equal((await client.get("/api/user")).status, 200);
});

test("Sign in with Apple answers 503 until it is configured", async () => {
  const saved = appleRuntime.env;
  appleRuntime.env = { ...saved, APPLE_TEAM_ID: "" };
  try {
    assert.equal((await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(newSub("off")))).status, 503);
    const start = await new Client(baseUrl).get("/api/auth/apple/start");
    assert.equal(start.headers.get("location"), "/auth?apple=unavailable");
  } finally {
    appleRuntime.env = saved;
  }
});

// --- web redirect flow ---------------------------------------------------------------------------------------------

async function startWeb(client: Client) {
  const res = await client.get("/api/auth/apple/start?ref=");
  assert.equal(res.status, 302);
  const url = new URL(res.headers.get("location")!);
  return url;
}

function formPost(client: Client, fields: Record<string, string>) {
  // The Client helper sends JSON; the Apple callback is form-encoded, so send it with the same cookies.
  return (client as any).send("/api/auth/apple/callback", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  }) as Promise<Response>;
}

test("the web start sends the browser to Apple with the Services ID, the registered return URL and a nonce", async () => {
  const url = await startWeb(new Client(baseUrl));
  assert.equal(url.origin + url.pathname, "https://appleid.apple.com/auth/authorize");
  assert.equal(url.searchParams.get("client_id"), SERVICES_ID);
  assert.equal(url.searchParams.get("redirect_uri"), "https://shareswap.test/api/auth/apple/callback");
  assert.equal(url.searchParams.get("response_mode"), "form_post");
  assert.equal(url.searchParams.get("response_type"), "code id_token");
  assert.ok(url.searchParams.get("nonce") && url.searchParams.get("state"));
});

test("the web callback signs the person in, reads the name from the first-time user field and keeps the refresh token for the Services ID", async () => {
  const client = new Client(baseUrl);
  const url = await startWeb(client);
  const sub = newSub("web");
  const idToken = await token({ sub, nonce: url.searchParams.get("nonce"), email: `${UNIQUE}.web@example.com`, email_verified: "true" }, { aud: SERVICES_ID });
  const res = await formPost(client, { state: url.searchParams.get("state")!, id_token: idToken, code: "web-code", user: JSON.stringify({ name: { firstName: "Wen", lastName: "Chen" } }) });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/");
  const row = await userRow(sub);
  assert.equal(row.displayName, "Wen C.");
  assert.equal((await client.get("/api/user")).status, 200);
  assert.equal(exchangeCalls.at(-1)?.get("client_id"), SERVICES_ID);
  assert.equal(exchangeCalls.at(-1)?.get("redirect_uri"), "https://shareswap.test/api/auth/apple/callback");
  const [link] = await db.select().from(appleLinks).where(eq(appleLinks.userId, row.id));
  assert.equal(decryptAppleToken(link.refreshTokenEnc!, appleRuntime.env).clientId, SERVICES_ID);
});

test("the web callback refuses a state from another browser, a tampered or reused state, and a token for the wrong nonce", async () => {
  const sub = newSub("web-bad");
  // The state came from one browser, the callback arrives from another with no session.
  const victim = new Client(baseUrl);
  const url = await startWeb(victim);
  const good = await token({ sub, nonce: url.searchParams.get("nonce") }, { aud: SERVICES_ID });
  const stranger = new Client(baseUrl);
  assert.equal((await formPost(stranger, { state: url.searchParams.get("state")!, id_token: good })).headers.get("location"), "/auth?apple=failed");
  // A tampered state.
  assert.equal((await formPost(victim, { state: `${url.searchParams.get("state")}x`, id_token: good })).headers.get("location"), "/auth?apple=failed");
  // A token minted for a different nonce.
  const wrong = await token({ sub, nonce: "not-the-nonce" }, { aud: SERVICES_ID });
  assert.equal((await formPost(victim, { state: url.searchParams.get("state")!, id_token: wrong })).headers.get("location"), "/auth?apple=failed");
  // One try per start: the failed attempt above used it up.
  assert.equal((await formPost(victim, { state: url.searchParams.get("state")!, id_token: good })).headers.get("location"), "/auth?apple=failed");
  assert.equal(await userRow(sub), undefined);
});

test("a person who cancels at Apple lands back on the sign-in page; a deactivated account is sent to reactivate with apple as the provider", async () => {
  const client = new Client(baseUrl);
  await startWeb(client);
  assert.equal((await formPost(client, { error: "user_cancelled_authorize" })).headers.get("location"), "/auth");

  const sub = newSub("web-deact");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  await db.update(users).set({ accountStatus: "deactivated", deactivatedAt: new Date() }).where(eq(users.appleId, sub));
  const c2 = new Client(baseUrl);
  const url = await startWeb(c2);
  const res = await formPost(c2, { state: url.searchParams.get("state")!, id_token: await token({ sub, nonce: url.searchParams.get("nonce") }, { aud: SERVICES_ID }) });
  assert.match(res.headers.get("location")!, /^\/auth\?reactivate=apple&token=reactivate-/);
});

// --- server-to-server notifications --------------------------------------------------------------------------------

async function notify(type: string, sub: string, over: { aud?: string; key?: CryptoKey; client?: Client; raw?: unknown } = {}) {
  const payload = await token({ events: JSON.stringify({ type, sub, event_time: Date.now() }) }, { aud: over.aud ?? SERVICES_ID, key: over.key });
  return (over.client ?? new Client(baseUrl)).post("/api/auth/apple/notifications", over.raw ?? { payload });
}

test("a notification needs no session or CSRF token, but must carry Apple's signature for this app", async () => {
  const other = await generateKeyPair("RS256");
  const sub = newSub("n-sig");
  for (const bad of [await notify("consent-revoked", sub, { key: other.privateKey }), await notify("consent-revoked", sub, { aud: "someone.else" }), await notify("consent-revoked", sub, { raw: {} }), await notify("consent-revoked", sub, { raw: { payload: "x.y.z" } })]) {
    assert.equal(bad.status, 400);
  }
  assert.equal((await notify("consent-revoked", sub)).status, 200); // an unknown Apple ID is accepted and ignored
});

test("consent-revoked signs the person out everywhere and drops the dead refresh token", async () => {
  const sub = newSub("n-revoked");
  const device1 = new Client(baseUrl);
  const device2 = new Client(baseUrl);
  await device1.post("/api/auth/apple/native", await nativeBody(sub));
  await device2.post("/api/auth/apple/native", await nativeBody(sub));
  assert.equal((await device1.get("/api/user")).status, 200);
  const row = await userRow(sub);
  assert.ok((await db.select().from(appleLinks).where(eq(appleLinks.userId, row.id)))[0].refreshTokenEnc);

  assert.equal((await notify("consent-revoked", sub)).status, 200);
  assert.equal((await device1.get("/api/user")).status, 401);
  assert.equal((await device2.get("/api/user")).status, 401);
  assert.equal((await db.select().from(appleLinks).where(eq(appleLinks.userId, row.id)))[0].refreshTokenEnc, null);
  assert.equal((await userRow(sub)).accountStatus, "active", "revoking consent does not delete the account");
  // Signing in with Apple again still works (the person can grant ShareSwap access again).
  assert.equal((await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub))).status, 200);
});

test("account-delete starts the ordinary deletion request, and a repeat does nothing more", async () => {
  const sub = newSub("n-delete");
  const client = new Client(baseUrl);
  await client.post("/api/auth/apple/native", await nativeBody(sub));
  assert.equal((await notify("account-delete", sub)).status, 200);
  const after = await userRow(sub);
  assert.equal(after.accountStatus, "pending_deletion");
  assert.ok(after.deletionRequestedAt);
  const first = after.deletionRequestedAt!.getTime();
  assert.equal((await notify("account-delete", sub)).status, 200);
  assert.equal((await userRow(sub)).deletionRequestedAt!.getTime(), first);
});

test("account-delete for an account that cannot start deleting yet changes nothing and still answers 200", async () => {
  const sub = newSub("n-delete-blocked");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  await db.update(users).set({ accountStatus: "deactivated" }).where(eq(users.appleId, sub));
  assert.equal((await notify("account-delete", sub)).status, 200);
  assert.equal((await userRow(sub)).accountStatus, "deactivated");
});

test("email-disabled and email-enabled record whether Apple forwards to the relay address", async () => {
  const sub = newSub("n-email");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub, { email: "r1@privaterelay.appleid.com", is_private_email: "true", email_verified: "true" }));
  const id = (await userRow(sub)).id;
  const forwarding = async () => (await db.select().from(appleLinks).where(eq(appleLinks.userId, id)))[0].emailForwardingEnabled;
  assert.equal(await forwarding(), true);
  await notify("email-disabled", sub);
  assert.equal(await forwarding(), false);
  await notify("email-enabled", sub);
  assert.equal(await forwarding(), true);
});

test("notifications answer 503 while Sign in with Apple is not configured", async () => {
  const saved = appleRuntime.env;
  appleRuntime.env = { ...saved, APPLE_KEY_ID: "" };
  try {
    assert.equal((await notify("consent-revoked", newSub("n-off"))).status, 503);
  } finally {
    appleRuntime.env = saved;
  }
});

// --- Android: the web redirect flow in the system browser, back into the app -----------------------------------------

const APP = "shareswap://";

async function startApp_(client: Client, redirect = APP) {
  const res = await client.get(`/api/auth/apple/start?platform=native&redirect_uri=${encodeURIComponent(redirect)}`);
  assert.equal(res.status, 302);
  return new URL(res.headers.get("location")!);
}

test("the app's redirect is allowed only for the app's own scheme", async () => {
  const { allowedAppRedirect } = await import("./apple-routes.js");
  const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
  assert.equal(allowedAppRedirect("shareswap://", prod), "shareswap://");
  assert.equal(allowedAppRedirect("shareswap://login?x=1", prod), "shareswap://login?x=1");
  for (const bad of ["https://evil.example/", "http://shareswap.app/", "javascript:alert(1)", "shareswap://user:pw@host/", "exp://192.168.0.2:8081", "", "not a url", undefined, 5]) {
    assert.equal(allowedAppRedirect(bad as any, prod), null, String(bad));
  }
  assert.equal(allowedAppRedirect("exp://192.168.0.2:8081", {} as NodeJS.ProcessEnv), "exp://192.168.0.2:8081", "Expo Go links work outside production");
});

test("Android: a successful sign-in returns to the app with a one-time token the app redeems for a session", async () => {
  const browser = new Client(baseUrl);
  const url = await startApp_(browser);
  const sub = newSub("android");
  const idToken = await token({ sub, nonce: url.searchParams.get("nonce"), email: `${UNIQUE}.android@example.com`, email_verified: "true" }, { aud: SERVICES_ID });
  const res = await formPost(browser, { state: url.searchParams.get("state")!, id_token: idToken, code: "android-code", user: JSON.stringify({ name: { firstName: "Dee", lastName: "Park" } }) });
  assert.equal(res.status, 302);
  const location = res.headers.get("location")!;
  assert.match(location, /^shareswap:\/\/\?token=[0-9a-f]{64}$/);
  assert.equal((await userRow(sub)).displayName, "Dee P.");
  assert.equal((await browser.get("/api/user")).status, 401, "the system browser itself is not signed in");
  assert.equal(exchangeCalls.at(-1)?.get("client_id"), SERVICES_ID);

  const app = new Client(baseUrl);
  const redeemed = await app.post("/api/auth/exchange-token", { token: new URL(location).searchParams.get("token") });
  assert.equal(redeemed.status, 200);
  assert.equal(((await redeemed.json()) as { id: number }).id, (await userRow(sub)).id);
  assert.equal((await app.get("/api/user")).status, 200);
  assert.equal((await new Client(baseUrl).post("/api/auth/exchange-token", { token: new URL(location).searchParams.get("token") })).status, 401, "a token works once");
});

test("Android: refusals, failures and cancelling come back to the app as ?apple=..., never to a web page", async () => {
  const sub = newSub("android-bad");
  const c1 = new Client(baseUrl);
  const u1 = await startApp_(c1);
  const r1 = await formPost(c1, { state: u1.searchParams.get("state")!, id_token: await token({ sub, nonce: "wrong" }, { aud: SERVICES_ID }) });
  assert.equal(r1.headers.get("location"), "shareswap://?apple=failed");

  const c2 = new Client(baseUrl);
  await startApp_(c2);
  assert.equal((await formPost(c2, { error: "user_cancelled_authorize", state: (await startApp_(c2)).searchParams.get("state")! })).headers.get("location"), "shareswap://?apple=cancelled");

  const banned = newSub("android-banned");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(banned));
  await db.update(users).set({ accountStatus: "banned", bannedAt: new Date() }).where(eq(users.appleId, banned));
  const c3 = new Client(baseUrl);
  const u3 = await startApp_(c3);
  const r3 = await formPost(c3, { state: u3.searchParams.get("state")!, id_token: await token({ sub: banned, nonce: u3.searchParams.get("nonce") }, { aud: SERVICES_ID }) });
  assert.equal(r3.headers.get("location"), "shareswap://?apple=refused");
});

test("Android: a deactivated account comes back with a reactivation token, and a foreign redirect is ignored", async () => {
  const sub = newSub("android-deact");
  await new Client(baseUrl).post("/api/auth/apple/native", await nativeBody(sub));
  await db.update(users).set({ accountStatus: "deactivated", deactivatedAt: new Date() }).where(eq(users.appleId, sub));
  const c = new Client(baseUrl);
  const u = await startApp_(c);
  const res = await formPost(c, { state: u.searchParams.get("state")!, id_token: await token({ sub, nonce: u.searchParams.get("nonce") }, { aud: SERVICES_ID }) });
  assert.match(res.headers.get("location")!, /^shareswap:\/\/\?reactivate=1&token=reactivate-[0-9a-f]{64}$/);

  // A redirect to another site is dropped at the start, so the flow behaves as the plain web one and the token never leaves.
  const evil = new Client(baseUrl);
  const ue = await startApp_(evil, "https://evil.example/steal");
  const ok = await token({ sub: newSub("android-evil"), nonce: ue.searchParams.get("nonce") }, { aud: SERVICES_ID });
  const out = await formPost(evil, { state: ue.searchParams.get("state")!, id_token: ok });
  assert.equal(out.headers.get("location"), "/");
});
