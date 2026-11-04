import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Sign in with Apple, the parts that talk to Apple or check what Apple sent: verifying identity tokens and server
 * notifications against Apple's published keys, building the ES256 client secret, exchanging an authorization code
 * for a refresh token, revoking it, and keeping that refresh token encrypted at rest. No database in here.
 */

export const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";
export const APPLE_AUTHORIZE_URL = "https://appleid.apple.com/auth/authorize";

export const DEFAULT_APPLE_BUNDLE_ID = "com.shareswap.mobile";

export type AppleConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  /** The Services ID: the audience and client id of the web flow. */
  servicesId: string;
  /** The app's bundle id: the audience and client id of the native flow. */
  bundleId: string;
};

const clean = (value: string | undefined) => value?.trim() || "";

/** The Apple settings, or null while any of the four that sign-in needs is missing (the feature is then off). */
export function appleConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AppleConfig | null {
  const teamId = clean(env.APPLE_TEAM_ID);
  const keyId = clean(env.APPLE_KEY_ID);
  // Secrets managers often store the .p8 on one line with literal "\n".
  const privateKey = clean(env.APPLE_PRIVATE_KEY).replace(/\\n/g, "\n");
  const servicesId = clean(env.APPLE_SERVICES_ID);
  if (!teamId || !keyId || !privateKey || !servicesId) return null;
  return { teamId, keyId, privateKey, servicesId, bundleId: clean(env.APPLE_BUNDLE_ID) || DEFAULT_APPLE_BUNDLE_ID };
}

export class AppleAuthError extends Error {
  constructor(message: string, readonly code: "invalid_token" | "bad_nonce" | "apple_unavailable" | "encryption_key") {
    super(message);
    this.name = "AppleAuthError";
  }
}

export type AppleIdentity = {
  /** Apple's stable id for the person, per team. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /** The address is an @privaterelay.appleid.com forwarding address. */
  isPrivateEmail: boolean;
};

/** Apple sends these booleans as the strings "true"/"false" in some tokens and as real booleans in others. */
const truthy = (value: unknown) => value === true || value === "true";

export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

let remoteKeys: JWTVerifyGetKey | null = null;
/** Apple's signing keys, fetched on demand and cached by jose (it refetches when a token names an unknown key). */
function appleKeys(): JWTVerifyGetKey {
  if (!remoteKeys) remoteKeys = createRemoteJWKSet(APPLE_JWKS_URL, { timeoutDuration: 5000 });
  return remoteKeys;
}

type VerifyOptions = {
  /** Accepted `aud` values: the Services ID and/or the bundle id. */
  audience: string[];
  /** Tests inject their own key set; production uses Apple's. */
  keys?: JWTVerifyGetKey;
  now?: Date;
};

async function verifyAppleJwt(token: string, options: VerifyOptions): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(token, options.keys ?? appleKeys(), {
      issuer: APPLE_ISSUER,
      audience: options.audience,
      algorithms: ["RS256"],
      ...(options.now ? { currentDate: options.now } : {}),
    });
    return payload;
  } catch (error) {
    // A network failure fetching the keys is Apple being unreachable, not a bad token.
    const code = (error as { code?: string }).code ?? "";
    if (code === "ERR_JWKS_TIMEOUT" || code === "ERR_JOSE_GENERIC" || (error as Error).name === "TypeError" || /fetch|network|ECONN|ENOTFOUND/i.test((error as Error).message)) {
      throw new AppleAuthError("Apple's keys could not be fetched", "apple_unavailable");
    }
    throw new AppleAuthError("The Apple token is not valid", "invalid_token");
  }
}

/**
 * Checks an identity token: Apple's signature, issuer, audience, expiry, and (when `expectedNonce` is given) that the
 * token's `nonce` claim is exactly that value. Native sign-in passes sha256Hex(rawNonce); the web flow passes the
 * nonce it put in the authorize request.
 */
export async function verifyAppleIdentityToken(token: string, options: VerifyOptions & { expectedNonce?: string }): Promise<AppleIdentity> {
  const payload = await verifyAppleJwt(token, options);
  if (options.expectedNonce !== undefined && payload.nonce !== options.expectedNonce) {
    throw new AppleAuthError("The Apple token does not carry the expected nonce", "bad_nonce");
  }
  if (typeof payload.sub !== "string" || !payload.sub) throw new AppleAuthError("The Apple token has no subject", "invalid_token");
  const email = typeof payload.email === "string" && payload.email.trim() ? payload.email.trim() : null;
  return { sub: payload.sub, email, emailVerified: !!email && truthy(payload.email_verified), isPrivateEmail: truthy(payload.is_private_email) };
}

export type AppleNotification = {
  type: "consent-revoked" | "account-delete" | "email-disabled" | "email-enabled";
  sub: string;
  eventTime: Date | null;
};

const NOTIFICATION_TYPES = new Set(["consent-revoked", "account-delete", "email-disabled", "email-enabled"]);

/** Checks the signed payload Apple posts to the server-to-server endpoint and returns the event it carries. */
export async function verifyAppleNotification(signedPayload: string, options: VerifyOptions): Promise<AppleNotification> {
  const payload = await verifyAppleJwt(signedPayload, options);
  // `events` is a JSON string inside the JWT.
  let events: unknown = payload.events;
  if (typeof events === "string") {
    try {
      events = JSON.parse(events);
    } catch {
      throw new AppleAuthError("The Apple notification is not readable", "invalid_token");
    }
  }
  const event = events as { type?: unknown; sub?: unknown; event_time?: unknown } | null;
  if (!event || typeof event.type !== "string" || !NOTIFICATION_TYPES.has(event.type) || typeof event.sub !== "string" || !event.sub) {
    throw new AppleAuthError("The Apple notification has no usable event", "invalid_token");
  }
  const millis = typeof event.event_time === "number" ? event.event_time : NaN;
  return { type: event.type as AppleNotification["type"], sub: event.sub, eventTime: Number.isFinite(millis) ? new Date(millis) : null };
}

/** The client secret Apple asks for on /auth/token and /auth/revoke: an ES256 JWT signed with our key, valid ten minutes. */
export async function createAppleClientSecret(config: AppleConfig, clientId: string, now: Date = new Date()): Promise<string> {
  const key = await importPKCS8(config.privateKey, "ES256");
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setSubject(clientId)
    .setAudience(APPLE_ISSUER)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 600)
    .sign(key);
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
export type AppleClientDeps = { fetch?: FetchLike; now?: Date };

async function postForm(url: string, form: Record<string, string>, deps: AppleClientDeps) {
  const doFetch = deps.fetch ?? ((u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(8000) }));
  try {
    return await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new AppleAuthError("Apple could not be reached", "apple_unavailable");
  }
}

/**
 * Trades the one-time authorization code from sign-in for a refresh token, which is what revocation needs later.
 * `clientId` is the audience the code was issued for (bundle id for native, Services ID for web); `redirectUri` is
 * required for the web flow only.
 */
export async function exchangeAppleAuthorizationCode(
  config: AppleConfig,
  input: { code: string; clientId: string; redirectUri?: string },
  deps: AppleClientDeps = {},
): Promise<{ refreshToken: string }> {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    client_secret: await createAppleClientSecret(config, input.clientId, deps.now),
  };
  if (input.redirectUri) form.redirect_uri = input.redirectUri;
  const response = await postForm(APPLE_TOKEN_URL, form, deps);
  if (response.status >= 500) throw new AppleAuthError("Apple could not exchange the code", "apple_unavailable");
  const body = (await response.json().catch(() => null)) as { refresh_token?: unknown } | null;
  if (!response.ok || typeof body?.refresh_token !== "string" || !body.refresh_token) {
    throw new AppleAuthError("Apple refused the authorization code", "invalid_token");
  }
  return { refreshToken: body.refresh_token };
}

/**
 * Revokes a refresh token with Apple, ending the person's grant to ShareSwap. Resolves when Apple confirms it (an
 * already-revoked token counts: Apple answers 400 invalid_grant); throws apple_unavailable on a network or 5xx
 * failure so the caller can try again.
 */
export async function revokeAppleToken(config: AppleConfig, input: { refreshToken: string; clientId: string }, deps: AppleClientDeps = {}): Promise<void> {
  const response = await postForm(
    APPLE_REVOKE_URL,
    {
      client_id: input.clientId,
      client_secret: await createAppleClientSecret(config, input.clientId, deps.now),
      token: input.refreshToken,
      token_type_hint: "refresh_token",
    },
    deps,
  );
  if (response.ok) return;
  if (response.status >= 500 || response.status === 429) throw new AppleAuthError("Apple could not revoke the token", "apple_unavailable");
  const text = await response.text().catch(() => "");
  if (response.status === 400 && /invalid_grant/.test(text)) return;
  throw new AppleAuthError(`Apple refused to revoke the token (${response.status})`, "invalid_token");
}

// --- the refresh token at rest -------------------------------------------------------------------------------------

export const APPLE_TOKEN_KEY_ENV = "APPLE_TOKEN_ENCRYPTION_KEY";

function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const raw = clean(env[APPLE_TOKEN_KEY_ENV]);
  const key = Buffer.from(raw, "base64");
  if (!raw || key.length !== 32) {
    throw new AppleAuthError(`${APPLE_TOKEN_KEY_ENV} must be 32 random bytes, base64-encoded`, "encryption_key");
  }
  return key;
}

export type StoredAppleToken = { refreshToken: string; clientId: string };

/** AES-256-GCM. The client id travels inside the ciphertext because revoking must use the one the token was issued to. */
export function encryptAppleToken(token: StoredAppleToken, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(token), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptAppleToken(stored: string, env: NodeJS.ProcessEnv = process.env): StoredAppleToken {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new AppleAuthError("The stored Apple token is not readable", "invalid_token");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(env), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8"));
    if (typeof parsed?.refreshToken !== "string" || typeof parsed?.clientId !== "string") throw new Error("shape");
    return parsed;
  } catch (error) {
    if (error instanceof AppleAuthError) throw error;
    throw new AppleAuthError("The stored Apple token is not readable", "invalid_token");
  }
}
