import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import type { JWTVerifyGetKey } from "jose";
import {
  APPLE_AUTHORIZE_URL,
  APPLE_TOKEN_KEY_ENV,
  AppleAuthError,
  appleConfigFromEnv,
  exchangeAppleAuthorizationCode,
  verifyAppleIdentityToken,
  verifyAppleNotification,
  sha256Hex,
  type AppleClientDeps,
  type AppleConfig,
} from "./apple-auth";
import { APPLE_NOTIFICATIONS_PATH, handleAppleNotification } from "./apple-notifications";
import { appleFullName, resolveAppleUser, storeAppleRefreshToken, type AppleSignInDeps } from "./apple-signin";

const CALLBACK_PATH = "/api/auth/apple/callback";

/** Everything the routes take from the rest of auth.ts, passed in so this file does not import it back. */
export type AppleRouteDeps = AppleSignInDeps & {
  authLimiter: (req: Request, res: Response, next: NextFunction) => void;
  login(req: Request, user: unknown): Promise<void>;
  storeNativeToken(userId: number, prefix?: string): Promise<string>;
  reactivationPrefix: string;
  sessionSecret: string;
};

/** Tests replace these; production leaves them alone (Apple's real keys, real fetch, process.env). */
export const appleRuntime: { keys?: JWTVerifyGetKey; fetch?: AppleClientDeps["fetch"]; env: NodeJS.ProcessEnv } = { env: process.env };

/** Sign in with Apple is on only when the four Apple settings and the token-encryption key are all present. */
export function appleSignInConfig(env: NodeJS.ProcessEnv = appleRuntime.env): AppleConfig | null {
  const config = appleConfigFromEnv(env);
  if (!config || !env[APPLE_TOKEN_KEY_ENV]?.trim()) return null;
  return config;
}

/** The web return URL, from trusted configuration (never the Host header), and it must be the one registered with Apple. */
export function resolveAppleRedirectUri(env: NodeJS.ProcessEnv = appleRuntime.env): string {
  const configured = env.APPLE_REDIRECT_URL?.trim();
  const candidate = configured || (env.CUSTOM_DOMAIN ? `https://${env.CUSTOM_DOMAIN}${CALLBACK_PATH}` : `https://shareswap.app${CALLBACK_PATH}`);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("The Apple return URL must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.pathname !== CALLBACK_PATH || url.search || url.hash || url.username || url.password) {
    throw new Error(`The Apple return URL must be an HTTPS URL ending in ${CALLBACK_PATH}`);
  }
  return url.href;
}

const sign = (secret: string, value: string) => createHmac("sha256", secret).update(`apple-state:${value}`).digest("base64url");

/** `state` is `<nonce>.<expiry>.<signature>`; the nonce is also kept in the session, which is what ties the callback to this browser. */
function makeState(secret: string, nonce: string, now = Date.now()) {
  const body = `${nonce}.${now + 10 * 60 * 1000}`;
  return `${body}.${sign(secret, body)}`;
}

function readState(secret: string, state: unknown, now = Date.now()): string | null {
  if (typeof state !== "string") return null;
  const [nonce, expiry, signature] = state.split(".");
  if (!nonce || !expiry || !signature) return null;
  const expected = Buffer.from(sign(secret, `${nonce}.${expiry}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return Number(expiry) > now ? nonce : null;
}

export const reactivationRedirectFor = (token: string) => `/auth?reactivate=apple&token=${token}`;

export function registerAppleRoutes(app: Express, deps: AppleRouteDeps) {
  const unavailable = (res: Response) => res.status(503).json({ message: "Sign in with Apple is not available right now." });

  async function exchangeAndStore(config: AppleConfig, userId: number, code: unknown, clientId: string, redirectUri?: string) {
    if (typeof code !== "string" || !code) return;
    try {
      const { refreshToken } = await exchangeAppleAuthorizationCode(config, { code, clientId, redirectUri }, { fetch: appleRuntime.fetch });
      await storeAppleRefreshToken(userId, { refreshToken, clientId }, appleRuntime.env);
    } catch (error) {
      // The sign-in stands: the person proved who they are. Without the token deletion cannot revoke the grant, so say so.
      console.error(`[apple] could not keep a refresh token for user ${userId}:`, error instanceof AppleAuthError ? error.message : error);
    }
  }

  const refusal = (reason: "banned" | "blocked") =>
    reason === "banned" ? "This account cannot be used on ShareSwap." : "This account is not available.";

  // Apple's server-to-server notifications (consent revoked, Apple ID deleted, relay email forwarding off/on). Apple posts
  // JSON {"payload": "<signed JWT>"}. There is no session, cookie or CSRF token: the signature is the authentication.
  app.post(APPLE_NOTIFICATIONS_PATH, async (req, res, next) => {
    try {
      const config = appleSignInConfig();
      if (!config) return unavailable(res);
      const payload = req.body?.payload;
      if (typeof payload !== "string" || !payload) return res.status(400).json({ message: "Missing payload" });
      let event;
      try {
        event = await verifyAppleNotification(payload, { audience: [config.servicesId, config.bundleId], keys: appleRuntime.keys });
      } catch (error) {
        // Apple's keys unreachable is ours to retry (5xx); a payload that does not verify is not (4xx).
        if (error instanceof AppleAuthError && error.code === "apple_unavailable") return res.status(503).json({ message: "Try again" });
        return res.status(400).json({ message: "The notification could not be verified" });
      }
      const result = await handleAppleNotification(event);
      console.log(`[apple] notification ${event.type}: ${result}`);
      return res.status(200).json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  // Native iOS: the app sends what expo-apple-authentication returned, plus the raw nonce it hashed for Apple.
  app.post("/api/auth/apple/native", deps.authLimiter, async (req, res, next) => {
    try {
      const config = appleSignInConfig();
      if (!config) return unavailable(res);
      const { identityToken, authorizationCode, nonce, fullName, ref } = req.body ?? {};
      if (typeof identityToken !== "string" || typeof nonce !== "string" || nonce.length < 16) {
        return res.status(400).json({ message: "Apple sign-in details are missing." });
      }
      let identity;
      try {
        identity = await verifyAppleIdentityToken(identityToken, { audience: [config.bundleId], expectedNonce: sha256Hex(nonce), keys: appleRuntime.keys });
      } catch (error) {
        if (error instanceof AppleAuthError && error.code === "apple_unavailable") return res.status(503).json({ message: "Apple could not be reached. Try again." });
        return res.status(401).json({ message: "Apple sign-in could not be verified." });
      }
      const outcome = await resolveAppleUser(identity, { fullName: appleFullName(fullName), referralCode: typeof ref === "string" ? ref : null }, deps);
      if (outcome.kind === "refused") return res.status(403).json({ message: refusal(outcome.reason) });
      if (outcome.kind === "reactivate") {
        const token = await deps.storeNativeToken(outcome.userId, deps.reactivationPrefix);
        return res.json({ reactivate: true, token });
      }
      await exchangeAndStore(config, outcome.user.id, authorizationCode, config.bundleId);
      await deps.login(req, outcome.user);
      return res.json(outcome.user);
    } catch (error) {
      return next(error);
    }
  });

  // Web: send the browser to Apple. The nonce lives in the session and inside the signed state.
  app.get("/api/auth/apple/start", deps.authLimiter, (req, res, next) => {
    const config = appleSignInConfig();
    if (!config) {
      res.redirect("/auth?apple=unavailable");
      return;
    }
    const nonce = randomBytes(24).toString("base64url");
    const session = req.session as any;
    session.appleAuth = { nonce };
    if (typeof req.query.ref === "string" && req.query.ref) session.pendingReferralCode = req.query.ref;
    const params = new URLSearchParams({
      response_type: "code id_token",
      response_mode: "form_post",
      client_id: config.servicesId,
      redirect_uri: resolveAppleRedirectUri(),
      scope: "name email",
      state: makeState(deps.sessionSecret, nonce),
      nonce,
    });
    session.save((err: unknown) => (err ? next(err) : res.redirect(`${APPLE_AUTHORIZE_URL}?${params}`)));
  });

  // Web: Apple posts the result back here (form_post).
  app.post(CALLBACK_PATH, deps.authLimiter, async (req, res, next) => {
    try {
      const config = appleSignInConfig();
      if (!config) return res.redirect("/auth?apple=unavailable");
      if (req.body?.error) return res.redirect("/auth"); // the person cancelled
      const session = req.session as any;
      const stateNonce = readState(deps.sessionSecret, req.body?.state);
      const sessionNonce: string | undefined = session?.appleAuth?.nonce;
      if (!stateNonce || !sessionNonce || stateNonce !== sessionNonce || typeof req.body?.id_token !== "string") {
        return res.redirect("/auth?apple=failed");
      }
      delete session.appleAuth; // one try per start
      let identity;
      try {
        identity = await verifyAppleIdentityToken(req.body.id_token, { audience: [config.servicesId], expectedNonce: sessionNonce, keys: appleRuntime.keys });
      } catch {
        return res.redirect("/auth?apple=failed");
      }
      // `user` is a JSON string, present on the first authorization only.
      let fullName: string | null = null;
      if (typeof req.body.user === "string") {
        try {
          fullName = appleFullName(JSON.parse(req.body.user)?.name);
        } catch {
          fullName = null;
        }
      }
      const referralCode = typeof session.pendingReferralCode === "string" ? session.pendingReferralCode : null;
      delete session.pendingReferralCode;
      const outcome = await resolveAppleUser(identity, { fullName, referralCode }, deps);
      if (outcome.kind === "refused") return res.redirect("/auth?apple=refused");
      if (outcome.kind === "reactivate") return res.redirect(reactivationRedirectFor(await deps.storeNativeToken(outcome.userId, deps.reactivationPrefix)));
      await exchangeAndStore(config, outcome.user.id, req.body.code, config.servicesId, resolveAppleRedirectUri());
      await deps.login(req, outcome.user);
      return res.redirect("/");
    } catch (error) {
      return next(error);
    }
  });
}
