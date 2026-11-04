import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from "jose";
import {
  AppleAuthError,
  appleConfigFromEnv,
  createAppleClientSecret,
  decryptAppleToken,
  encryptAppleToken,
  exchangeAppleAuthorizationCode,
  revokeAppleToken,
  sha256Hex,
  verifyAppleIdentityToken,
  verifyAppleNotification,
  type AppleConfig,
} from "./apple-auth";

const SERVICES_ID = "app.shareswap.web";
const BUNDLE_ID = "com.shareswap.mobile";
const now = new Date("2026-11-04T12:00:00Z");
const nowSec = Math.floor(now.getTime() / 1000);

async function appleKeys() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "apple-key-1", alg: "RS256", use: "sig" };
  return { privateKey, keys: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(privateKey: CryptoKey | Uint8Array | object, claims: Record<string, unknown>, over: { iss?: string; aud?: string; exp?: number } = {}) {
  return new SignJWT(claims as any)
    .setProtectedHeader({ alg: "RS256", kid: "apple-key-1" })
    .setIssuer(over.iss ?? "https://appleid.apple.com")
    .setAudience(over.aud ?? BUNDLE_ID)
    .setIssuedAt(nowSec - 10)
    .setExpirationTime(over.exp ?? nowSec + 300)
    .sign(privateKey as any);
}

const opts = (keys: any) => ({ audience: [SERVICES_ID, BUNDLE_ID], keys, now });

test("a good identity token yields the person's id and email facts", async () => {
  const { privateKey, keys } = await appleKeys();
  const token = await sign(privateKey, { sub: "001.abc", email: "x@privaterelay.appleid.com", email_verified: "true", is_private_email: "true", nonce: "n1" });
  const identity = await verifyAppleIdentityToken(token, { ...opts(keys), expectedNonce: "n1" });
  assert.deepEqual(identity, { sub: "001.abc", email: "x@privaterelay.appleid.com", emailVerified: true, isPrivateEmail: true });
});

test("email_verified as a real boolean, and a token with no email", async () => {
  const { privateKey, keys } = await appleKeys();
  const a = await verifyAppleIdentityToken(await sign(privateKey, { sub: "s", email: "a@b.com", email_verified: true }), opts(keys));
  assert.equal(a.emailVerified, true);
  assert.equal(a.isPrivateEmail, false);
  const b = await verifyAppleIdentityToken(await sign(privateKey, { sub: "s", email_verified: "true" }), opts(keys));
  assert.deepEqual([b.email, b.emailVerified], [null, false]);
  const c = await verifyAppleIdentityToken(await sign(privateKey, { sub: "s", email: "a@b.com", email_verified: "false" }), opts(keys));
  assert.equal(c.emailVerified, false);
});

test("the web Services ID is accepted as an audience too", async () => {
  const { privateKey, keys } = await appleKeys();
  const token = await sign(privateKey, { sub: "s" }, { aud: SERVICES_ID });
  assert.equal((await verifyAppleIdentityToken(token, opts(keys))).sub, "s");
});

test("wrong audience, wrong issuer, expired, unsigned-by-Apple and malformed tokens are refused", async () => {
  const { privateKey, keys } = await appleKeys();
  const other = await generateKeyPair("RS256");
  const bad = [
    await sign(privateKey, { sub: "s" }, { aud: "com.someone.else" }),
    await sign(privateKey, { sub: "s" }, { iss: "https://evil.example" }),
    await sign(privateKey, { sub: "s" }, { exp: nowSec - 100 }),
    await sign(other.privateKey, { sub: "s" }),
    await sign(privateKey, { email: "a@b.com" }),
    "not-a-jwt",
  ];
  for (const token of bad) {
    await assert.rejects(verifyAppleIdentityToken(token, opts(keys)), (e: unknown) => e instanceof AppleAuthError && e.code === "invalid_token");
  }
});

test("a token signed with a non-RS256 algorithm is refused", async () => {
  const { keys } = await appleKeys();
  const forged = await new SignJWT({ sub: "s" }).setProtectedHeader({ alg: "HS256", kid: "apple-key-1" }).setIssuer("https://appleid.apple.com").setAudience(BUNDLE_ID).setExpirationTime(nowSec + 300).sign(new TextEncoder().encode("secret"));
  await assert.rejects(verifyAppleIdentityToken(forged, opts(keys)), AppleAuthError);
});

test("the nonce must match when one is expected, and a missing nonce fails too", async () => {
  const { privateKey, keys } = await appleKeys();
  const raw = "raw-nonce";
  const good = await sign(privateKey, { sub: "s", nonce: sha256Hex(raw) });
  assert.equal((await verifyAppleIdentityToken(good, { ...opts(keys), expectedNonce: sha256Hex(raw) })).sub, "s");
  for (const token of [good, await sign(privateKey, { sub: "s" })]) {
    await assert.rejects(verifyAppleIdentityToken(token, { ...opts(keys), expectedNonce: sha256Hex("other") }), (e: unknown) => (e as AppleAuthError).code === "bad_nonce");
  }
});

test("a server notification is verified and its JSON events string is read", async () => {
  const { privateKey, keys } = await appleKeys();
  const events = JSON.stringify({ type: "consent-revoked", sub: "001.abc", event_time: 1_762_257_600_000 });
  const n = await verifyAppleNotification(await sign(privateKey, { events }), opts(keys));
  assert.deepEqual([n.type, n.sub, n.eventTime?.toISOString()], ["consent-revoked", "001.abc", new Date(1_762_257_600_000).toISOString()]);
  await assert.rejects(verifyAppleNotification(await sign(privateKey, { events: JSON.stringify({ type: "something-else", sub: "s" }) }), opts(keys)), AppleAuthError);
  await assert.rejects(verifyAppleNotification(await sign(privateKey, { events: "{not json" }), opts(keys)), AppleAuthError);
  await assert.rejects(verifyAppleNotification(await sign(privateKey, { events }, { aud: "other" }), opts(keys)), AppleAuthError);
});

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const config: AppleConfig = {
  teamId: "TEAM123456",
  keyId: "KEY1234567",
  privateKey: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  servicesId: SERVICES_ID,
  bundleId: BUNDLE_ID,
};

test("the client secret is an ES256 JWT for the right team, key, client and audience", async () => {
  const secret = await createAppleClientSecret(config, BUNDLE_ID, now);
  const { payload, protectedHeader } = await jwtVerify(secret, ec.publicKey as any, { issuer: "TEAM123456", audience: "https://appleid.apple.com", subject: BUNDLE_ID, currentDate: now });
  assert.equal(protectedHeader.alg, "ES256");
  assert.equal(protectedHeader.kid, "KEY1234567");
  assert.equal((payload.exp as number) - (payload.iat as number), 600);
});

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const fn = async (url: string, init: { body: string }) => {
    calls.push({ url, form: new URLSearchParams(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
  };
  return { fn, calls };
}

test("exchanging a code sends the client secret and returns the refresh token", async () => {
  const f = fakeFetch(200, { refresh_token: "r-1", id_token: "ignored" });
  const out = await exchangeAppleAuthorizationCode(config, { code: "c1", clientId: SERVICES_ID, redirectUri: "https://shareswap.app/api/auth/apple/callback" }, { fetch: f.fn, now });
  assert.equal(out.refreshToken, "r-1");
  const form = f.calls[0].form;
  assert.equal(f.calls[0].url, "https://appleid.apple.com/auth/token");
  assert.deepEqual([form.get("grant_type"), form.get("code"), form.get("client_id"), form.get("redirect_uri")], ["authorization_code", "c1", SERVICES_ID, "https://shareswap.app/api/auth/apple/callback"]);
  assert.ok(form.get("client_secret"));
});

test("a refused or unreachable exchange raises the right error", async () => {
  await assert.rejects(exchangeAppleAuthorizationCode(config, { code: "c", clientId: BUNDLE_ID }, { fetch: fakeFetch(400, { error: "invalid_grant" }).fn, now }), (e: unknown) => (e as AppleAuthError).code === "invalid_token");
  await assert.rejects(exchangeAppleAuthorizationCode(config, { code: "c", clientId: BUNDLE_ID }, { fetch: fakeFetch(503, {}).fn, now }), (e: unknown) => (e as AppleAuthError).code === "apple_unavailable");
  const down = async () => { throw new Error("ECONNRESET"); };
  await assert.rejects(exchangeAppleAuthorizationCode(config, { code: "c", clientId: BUNDLE_ID }, { fetch: down as any, now }), (e: unknown) => (e as AppleAuthError).code === "apple_unavailable");
});

test("revoking sends the refresh token with its own client id; already-revoked counts as done", async () => {
  const f = fakeFetch(200, "");
  await revokeAppleToken(config, { refreshToken: "r-1", clientId: BUNDLE_ID }, { fetch: f.fn, now });
  assert.equal(f.calls[0].url, "https://appleid.apple.com/auth/revoke");
  assert.deepEqual([f.calls[0].form.get("token"), f.calls[0].form.get("token_type_hint"), f.calls[0].form.get("client_id")], ["r-1", "refresh_token", BUNDLE_ID]);
  await revokeAppleToken(config, { refreshToken: "r-1", clientId: BUNDLE_ID }, { fetch: fakeFetch(400, { error: "invalid_grant" }).fn, now });
  await assert.rejects(revokeAppleToken(config, { refreshToken: "r", clientId: BUNDLE_ID }, { fetch: fakeFetch(500, "").fn, now }), (e: unknown) => (e as AppleAuthError).code === "apple_unavailable");
  await assert.rejects(revokeAppleToken(config, { refreshToken: "r", clientId: BUNDLE_ID }, { fetch: fakeFetch(401, { error: "invalid_client" }).fn, now }), (e: unknown) => (e as AppleAuthError).code === "invalid_token");
});

test("the stored refresh token round-trips, is different each time, and needs the right key", () => {
  const env = { APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") };
  const a = encryptAppleToken({ refreshToken: "r-secret", clientId: BUNDLE_ID }, env);
  const b = encryptAppleToken({ refreshToken: "r-secret", clientId: BUNDLE_ID }, env);
  assert.notEqual(a, b);
  assert.ok(!a.includes("r-secret"));
  assert.deepEqual(decryptAppleToken(a, env), { refreshToken: "r-secret", clientId: BUNDLE_ID });
  assert.throws(() => decryptAppleToken(a, { APPLE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") }), AppleAuthError);
  assert.throws(() => decryptAppleToken(a.slice(0, -3) + "AAA", env), AppleAuthError);
  assert.throws(() => encryptAppleToken({ refreshToken: "r", clientId: "c" }, {}), (e: unknown) => (e as AppleAuthError).code === "encryption_key");
  assert.throws(() => encryptAppleToken({ refreshToken: "r", clientId: "c" }, { APPLE_TOKEN_ENCRYPTION_KEY: "c2hvcnQ=" }), AppleAuthError);
});

test("Apple is configured only when all four settings are present; the .p8 may carry escaped newlines", () => {
  assert.equal(appleConfigFromEnv({}), null);
  assert.equal(appleConfigFromEnv({ APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K", APPLE_SERVICES_ID: "S" }), null);
  const c = appleConfigFromEnv({ APPLE_TEAM_ID: "T", APPLE_KEY_ID: "K", APPLE_SERVICES_ID: "S", APPLE_PRIVATE_KEY: "-----BEGIN-----\\nabc\\n-----END-----" });
  assert.equal(c?.privateKey, "-----BEGIN-----\nabc\n-----END-----");
  assert.equal(c?.bundleId, "com.shareswap.mobile");
});
