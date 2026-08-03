import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit, { ipKeyGenerator, type Store, type Options, type ClientRateLimitInfo } from "express-rate-limit";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import {
  users,
  items,
  referrals,
  verifications,
  insertUserSchema,
  type SelectUser,
} from "@workspace/db";
import { db, pool } from "@workspace/db";
import { eq, or, and, ilike, ne } from "drizzle-orm";
import { fromZodError } from "zod-validation-error";
import { sendVerificationEmail, sendPasswordResetEmail } from "./sendgrid";
import { computeActiveStatus, computeResponseTime } from "./user-stats";

// ---------------------------------------------------------------------------
// Postgres-backed rate-limit store
//
// Keyed by an arbitrary string (usually "<prefix>:<ip>" or a composite key).
// Uses a single shared table "rate_limit_store" with a prefix column so
// multiple limiters can coexist without interference.
//
// Benefits over the default MemoryStore:
//   • Survives server restarts — attackers can't clear their counter by
//     forcing a restart.
//   • Works correctly across horizontal scale-out (multiple server pods share
//     the same Postgres instance).
//   • Expired rows are pruned lazily on every increment, so the table stays
//     small without a separate cron job.
// ---------------------------------------------------------------------------

// Module-level singleton promise so the CREATE TABLE runs exactly once
// regardless of how many store instances call init() concurrently.
let _rateLimitTableReady: Promise<void> | null = null;

function ensureRateLimitTable(): Promise<void> {
  if (!_rateLimitTableReady) {
    _rateLimitTableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS rate_limit_store (
          key        TEXT        NOT NULL,
          hits       INTEGER     NOT NULL DEFAULT 0,
          reset_time TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (key)
        )
      `)
      .then(() => undefined)
      .catch((err: NodeJS.ErrnoException & { code?: string }) => {
        // 42P07 = duplicate_table: a concurrent CREATE TABLE already won the race — fine.
        if (err.code !== "42P07") {
          _rateLimitTableReady = null; // allow retry on next request
          throw err;
        }
      });
  }
  return _rateLimitTableReady;
}

// ---------------------------------------------------------------------------
// Periodic cleanup of expired rate-limit rows
//
// Rows for keys that never reappear are never touched by the lazy-expiry
// upsert logic, so they accumulate indefinitely.  This job deletes any row
// whose reset_time is in the past, keeping the table small and index scans
// fast.  It runs every 10 minutes and logs the number of rows removed so
// ops can monitor table health.
// ---------------------------------------------------------------------------
export function startRateLimitCleanup(): void {
  const INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  const runCleanup = async () => {
    try {
      const result = await pool.query<{ count: string }>(
        `DELETE FROM rate_limit_store
          WHERE reset_time < NOW()
          RETURNING 1`,
      );
      const deleted = result.rowCount ?? 0;
      console.log(
        `[rate-limit-cleanup] Removed ${deleted} expired row(s) from rate_limit_store`,
      );
    } catch (err) {
      console.error("[rate-limit-cleanup] Cleanup failed:", err);
    }
  };

  // Run once shortly after startup, then on the regular cadence.
  setTimeout(() => {
    runCleanup();
    setInterval(runCleanup, INTERVAL_MS);
  }, 60 * 1000); // first run 1 minute after boot
}

export class PostgresRateLimitStore implements Store {
  // localKeys = false tells express-rate-limit that this is a shared store
  // (multiple instances share state), so it skips the double-count warning.
  localKeys = false;

  private windowMs: number;
  private _prefix: string;

  constructor(windowMs: number, storePrefix: string) {
    this.windowMs = windowMs;
    this._prefix = storePrefix;
  }

  // Called by express-rate-limit when the middleware is set up.
  async init(_options: Options): Promise<void> {
    await ensureRateLimitTable();
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    await ensureRateLimitTable();
    const fullKey = `${this._prefix}:${key}`;
    const resetTime = new Date(Date.now() + this.windowMs);

    // Atomic upsert:
    //   • On insert, start the window from now.
    //   • On conflict, check whether the existing window has expired:
    //       – expired  → reset hits to 1 and start a fresh window
    //       – active   → increment hits and keep the original window end time
    // This guarantees the window slides correctly without a separate cleanup pass.
    const result = await pool.query<{ hits: number; reset_time: Date }>(
      `INSERT INTO rate_limit_store (key, hits, reset_time)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE
         SET hits       = CASE
                            WHEN rate_limit_store.reset_time <= NOW() THEN 1
                            ELSE rate_limit_store.hits + 1
                          END,
             reset_time = CASE
                            WHEN rate_limit_store.reset_time <= NOW() THEN $2
                            ELSE rate_limit_store.reset_time
                          END
       RETURNING hits, reset_time`,
      [fullKey, resetTime],
    );

    return {
      totalHits: result.rows[0].hits,
      resetTime: result.rows[0].reset_time,
    };
  }

  async decrement(key: string): Promise<void> {
    await ensureRateLimitTable();
    const fullKey = `${this._prefix}:${key}`;
    await pool.query(
      `UPDATE rate_limit_store
          SET hits = GREATEST(0, hits - 1)
        WHERE key = $1`,
      [fullKey],
    );
  }

  async resetKey(key: string): Promise<void> {
    await ensureRateLimitTable();
    const fullKey = `${this._prefix}:${key}`;
    await pool.query(`DELETE FROM rate_limit_store WHERE key = $1`, [fullKey]);
  }

  async resetAll(): Promise<void> {
    await ensureRateLimitTable();
    await pool.query(
      `DELETE FROM rate_limit_store WHERE key LIKE $1`,
      [`${this._prefix}:%`],
    );
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    await ensureRateLimitTable();
    const fullKey = `${this._prefix}:${key}`;
    const result = await pool.query<{ hits: number; reset_time: Date }>(
      `SELECT hits, reset_time FROM rate_limit_store WHERE key = $1`,
      [fullKey],
    );
    if (!result.rows[0]) return undefined;
    return {
      totalHits: result.rows[0].hits,
      resetTime: result.rows[0].reset_time,
    };
  }
}

// ---------------------------------------------------------------------------
// Composite-key helper
//
// Keying on IP alone lets an attacker bypass limits by rotating IPs (exit
// nodes, VPNs, botnets).  Keying on IP + User-Agent raises the cost: the
// attacker must rotate *both* simultaneously.  We truncate the UA to 200
// characters to avoid unbounded key sizes while still capturing enough signal
// to distinguish automation tools from real browsers.
//
// NOTE: This is a probabilistic defence, not a guarantee.  Sophisticated
// attackers rotate UAs too.  The persistent Postgres store (above) is the
// primary protection; the composite key reduces false-positives for innocent
// users behind shared NAT / CGNAT.
// ---------------------------------------------------------------------------
function compositeKey(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  // ipKeyGenerator normalises IPv6 to /48 subnets so the key stays stable
  // across addresses in the same prefix (required by express-rate-limit v8).
  const ip = ipKeyGenerator(req.ip ?? "unknown");
  const rawUa = req.headers["user-agent"];
  const ua = (Array.isArray(rawUa) ? rawUa[0] : rawUa ?? "").slice(0, 200);
  return `${ip}::${ua}`;
}

// Security: Rate limiter for authentication endpoints (login, register, reactivate).
// Backed by Postgres so limits survive restarts and work across multiple pods.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP per window
  message: "Too many authentication attempts, please try again later.",
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PostgresRateLimitStore(15 * 60 * 1000, "auth"),
});

// Security: Dedicated rate limiter for the reset-password-redirect endpoint.
// This endpoint checks token validity against the DB, so an attacker could
// probe for valid tokens via timing or response differences.
//
// Uses a composite IP + User-Agent key so that innocent users on shared NAT
// are less likely to be blocked by another user's attempts, while an attacker
// rotating IPs must also rotate the User-Agent header — raising the cost of
// evasion. Backed by Postgres so limits persist across restarts.
const resetRedirectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 token-probe attempts per composite key per window
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: compositeKey,
  store: new PostgresRateLimitStore(15 * 60 * 1000, "reset"),
  handler: (req, res) => {
    console.warn(
      `[SECURITY] Rate limit exceeded on reset-password-redirect — possible token probe from IP ${req.ip}`,
    );
    res.status(429).send("Too many requests, please try again later.");
  },
});

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

// ---------------------------------------------------------------------------
// Native OAuth token store — Postgres-backed
//
// After a successful Google OAuth flow initiated from the native mobile app,
// the server redirects to the Expo deep-link with a short-lived one-time
// token.  The app then POSTs that token to /api/auth/exchange-token, which
// logs the user in via a regular fetch request (so the session cookie is set
// in the native cookie jar, not the in-app browser's isolated jar).
//
// Tokens are stored in Postgres so they survive restarts and work across
// both the dev server and the production server (which share the same DB).
// Tokens expire after 5 minutes and are deleted on first use.
// ---------------------------------------------------------------------------

let _nativeTokenTableReady: Promise<void> | null = null;

function ensureNativeTokenTable(): Promise<void> {
  if (!_nativeTokenTableReady) {
    _nativeTokenTableReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS native_oauth_tokens (
          token      TEXT        PRIMARY KEY,
          user_id    INTEGER     NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL
        )
      `)
      .then(() => undefined)
      .catch((err: NodeJS.ErrnoException & { code?: string }) => {
        if (err.code !== "42P07") {
          _nativeTokenTableReady = null;
          throw err;
        }
      });
  }
  return _nativeTokenTableReady;
}

async function storeNativeToken(userId: number): Promise<string> {
  await ensureNativeTokenTable();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  await pool.query(
    `INSERT INTO native_oauth_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expiresAt],
  );
  // Prune expired tokens lazily
  pool.query(`DELETE FROM native_oauth_tokens WHERE expires_at < NOW()`).catch(() => {});
  return token;
}

async function consumeNativeToken(token: string): Promise<number | null> {
  await ensureNativeTokenTable();
  const result = await pool.query<{ user_id: number }>(
    `DELETE FROM native_oauth_tokens
      WHERE token = $1 AND expires_at > NOW()
      RETURNING user_id`,
    [token],
  );
  return result.rows[0]?.user_id ?? null;
}

const scryptAsync = promisify(scrypt);
const PostgresStore = connectPgSimple(session);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

function generateEmailVerificationToken(): string {
  return randomBytes(32).toString("hex");
}

// Generate a unique 6-char user code: L N L N L N (e.g. T3B7C2)
// Used as both handle (userCode) and referralCode — they are always the same value.
async function generateUserCode(firstLetter?: string): Promise<string> {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O (confusing)
  const digits = "23456789"; // no 0/1 (confusing)
  const rL = () => letters[Math.floor(Math.random() * letters.length)];
  const rD = () => digits[Math.floor(Math.random() * digits.length)];

  const generate = () => {
    const l1 =
      firstLetter && /^[a-zA-Z]$/.test(firstLetter)
        ? firstLetter.toUpperCase()
        : rL();
    return `${l1}${rD()}${rL()}${rD()}${rL()}${rD()}`;
  };

  let attempts = 0;
  while (attempts < 100) {
    const code = generate();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, code))
      .limit(1);
    if (!existing) return code;
    attempts++;
  }
  // Extremely unlikely fallback
  return generate();
}

// Generate display name from Google profile or email
function generateDisplayName(email?: string, googleName?: string): string {
  if (googleName) {
    // Use Google profile name, optionally abbreviate last name
    const parts = googleName.trim().split(" ");
    if (parts.length > 1) {
      return `${parts[0]} ${parts[parts.length - 1][0]}.`;
    }
    return parts[0];
  }

  if (email) {
    const [rawPrefix, rawDomain] = email.split("@");
    const prefix = (rawPrefix || "").replace(/[^a-zA-Z]/g, "");
    const domainName = (rawDomain || "").split(".")[0]; // e.g. "live" from "live.ca"
    const firstName =
      prefix.charAt(0).toUpperCase() + prefix.slice(1).toLowerCase();
    if (domainName && domainName.length > 0) {
      const lastInitial = domainName.charAt(0).toUpperCase();
      return `${firstName} ${lastInitial}.`;
    }
    return firstName;
  }

  return "User";
}

export async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

async function getUserByUsername(username: string) {
  return db.select().from(users).where(eq(users.username, username)).limit(1);
}

// Use a strong session secret from environment, fallback to REPL_ID only in development
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  process.env.REPL_ID ||
  randomBytes(32).toString("hex");

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
  console.warn(
    "WARNING: SESSION_SECRET not set in production! Using fallback which is insecure.",
  );
}

export const sessionSettings: session.SessionOptions = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    // Must be secure=true when sameSite="none" — Replit proxy is always HTTPS
    // so this is safe in both dev and prod.
    secure: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    // "none" is required so the cookie is sent on cross-site credentialed requests
    // (the Expo web app lives on *.expo.spock.replit.dev; the API is on *.replit.dev).
    // CSRF is still protected by the x-csrf-token header required on all mutations.
    sameSite: "none",
    httpOnly: true,
    path: "/",
  },
  name: "shareswap.sid",
};

export const store = new PostgresStore({
  pool,
  createTableIfMissing: true,
  tableName: "session",
  pruneSessionInterval: 60,
});

export function setupAuth(app: Express) {
  // Enable trust proxy for secure cookies behind reverse proxy
  app.set("trust proxy", 1);

  app.use(
    session({
      ...sessionSettings,
      store,
    }),
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await getUserByUsername(username);
        if (
          !user ||
          !user.password ||
          !(await comparePasswords(password, user.password))
        ) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, user);
      } catch (error) {
        console.error("Authentication error:", error);
        return done(error);
      }
    }),
  );

  // Google OAuth Strategy - use custom domain if available, fallback to Replit URL
  const googleCallbackURL = process.env.CUSTOM_DOMAIN
    ? `https://${process.env.CUSTOM_DOMAIN}/api/auth/google/callback`
    : "https://share-swap-mvp.replit.app/api/auth/google/callback";

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    console.log(
      "[Google OAuth] Strategy configured with callback URL:",
      googleCallbackURL,
    );
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: googleCallbackURL,
          passReqToCallback: true,
        } as any,
        async (
          req: any,
          accessToken: any,
          refreshToken: any,
          profile: any,
          done: any,
        ) => {
          try {
            // Check if user exists with this Google ID
            const [existingUser] = await db
              .select()
              .from(users)
              .where(eq(users.googleId, profile.id))
              .limit(1);

            if (existingUser) {
              // Clear pending referral code for existing users
              if (req.session) {
                delete req.session.pendingReferralCode;
              }
              // Update email if not stored yet
              const googleEmail = profile.emails?.[0]?.value;
              if (googleEmail && !existingUser.email) {
                const [updated] = await db
                  .update(users)
                  .set({ email: googleEmail })
                  .where(eq(users.id, existingUser.id))
                  .returning();
                return done(null, updated || existingUser);
              }
              return done(null, existingUser);
            }

            // Get referral code from session
            const referralCode = req.session?.pendingReferralCode as
              | string
              | undefined;
            let referrerId: number | null = null;
            let referrerDeviceFingerprint: string | null = null;

            if (referralCode) {
              const [referrer] = await db
                .select()
                .from(users)
                .where(eq(users.referralCode, referralCode))
                .limit(1);

              if (referrer) {
                referrerId = referrer.id;
                referrerDeviceFingerprint = referrer.deviceFingerprint || null;
                console.log(
                  `[Google OAuth] Valid referral code ${referralCode} from user ${referrerId}`,
                );
              }
            }

            // Create new user from Google profile
            const email = profile.emails?.[0]?.value;
            let baseUsername =
              email?.split("@")[0] || `google_${profile.id.slice(0, 10)}`;
            let username = baseUsername;
            let suffix = 1;

            // Ensure username is unique by checking and appending suffix if needed
            while (true) {
              const [existingUsername] = await db
                .select()
                .from(users)
                .where(eq(users.username, username))
                .limit(1);

              if (!existingUsername) break;
              username = `${baseUsername}${suffix}`;
              suffix++;
            }

            // Generate unique userCode (handle = referralCode = same 6-char code)
            const googleName = profile.displayName || profile.name?.givenName;
            const displayName = generateDisplayName(email, googleName);
            const firstLetter = email
              ?.split("@")[0]
              ?.replace(/[^a-zA-Z]/g, "")
              .charAt(0);
            const userCode = await generateUserCode(firstLetter);

            const [newUser] = await db
              .insert(users)
              .values({
                username,
                handle: userCode,
                displayName,
                email: email || null,
                googleId: profile.id,
                authProvider: "google",
                isVerified: false,
                password: null,
                referredBy: referrerId,
                referralCode: userCode,
              })
              .returning();

            // Create referral record if user was referred
            if (referrerId && referralCode) {
              await db.insert(referrals).values({
                referrerId: referrerId,
                referredUserId: newUser.id,
                referralCode: referralCode,
                rewardAmount: "10.00",
                isRewardClaimed: false,
                completedFirstTransaction: false,
                referrerDeviceFingerprint: referrerDeviceFingerprint,
                referredDeviceFingerprint: null,
              });
              console.log(
                `📣 [Google OAuth] Referral created: User ${newUser.id} was referred by user ${referrerId}`,
              );
              // Store referral applied flag in session for callback redirect
              if (req.session) {
                (req.session as any).referralApplied = true;
              }
            }

            // Clear pending referral code
            if (req.session) {
              delete req.session.pendingReferralCode;
            }

            return done(null, newUser);
          } catch (error) {
            console.error("Google authentication error:", error);
            return done(error as Error);
          }
        },
      ),
    );
  }

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) return done(null, false);
      done(null, user);
    } catch (error) {
      console.error("Deserialization error:", error);
      done(error);
    }
  });

  // Security: Apply rate limiting to login endpoint
  app.post("/api/login", authLimiter, (req, res, next) => {
    passport.authenticate(
      "local",
      async (err: any, user: SelectUser | false, info: any) => {
        if (err) return next(err);
        if (!user) {
          return res
            .status(401)
            .json({ message: info?.message || "Authentication failed" });
        }
        // Check if account is deactivated
        if ((user as any).accountStatus === "deactivated") {
          return res.status(403).json({
            message: "Account deactivated",
            accountStatus: "deactivated",
            deactivatedAt: (user as any).deactivatedAt,
            userId: user.id,
          });
        }

        // Update device fingerprint on login for referral fraud detection
        const { deviceFingerprint } = req.body;
        if (deviceFingerprint) {
          try {
            await db
              .update(users)
              .set({ deviceFingerprint: deviceFingerprint })
              .where(eq(users.id, user.id));
          } catch (e) {
            console.error("Failed to update device fingerprint:", e);
          }
        }

        req.login(user, (err) => {
          if (err) return next(err);
          res.json(user);
        });
      },
    )(req, res, next);
  });

  // Reactivate a deactivated account
  app.post("/api/reactivate-account", authLimiter, async (req, res, next) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password required" });
    }
    try {
      const [user] = await getUserByUsername(username);
      if (
        !user ||
        !user.password ||
        !(await comparePasswords(password, user.password))
      ) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if ((user as any).accountStatus !== "deactivated") {
        return res.status(400).json({ message: "Account is not deactivated" });
      }
      // Reactivate the account
      await db
        .update(users)
        .set({
          accountStatus: "active",
          deactivatedAt: null,
        } as any)
        .where(eq(users.id, user.id));

      // Restore user's items (make them available again)
      await db
        .update(items)
        .set({ isAvailable: true })
        .where(eq(items.ownerId, user.id));

      // Login the user
      req.login(
        { ...user, accountStatus: "active", deactivatedAt: null } as any,
        (err) => {
          if (err) return next(err);
          res.json({
            message: "Account reactivated successfully",
            user: { ...user, accountStatus: "active" },
          });
        },
      );
    } catch (error) {
      console.error("Reactivation error:", error);
      next(error);
    }
  });

  // Security: Apply rate limiting to register endpoint
  app.post("/api/register", authLimiter, async (req, res, next) => {
    try {
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        const error = fromZodError(result.error);
        return res.status(400).json({ message: error.toString() });
      }

      const [existingUser] = await getUserByUsername(result.data.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Check if a referral code was provided
      const { referralCode, deviceFingerprint } = req.body;
      let referrerId: number | null = null;
      let referrerDeviceFingerprint: string | null = null;

      if (referralCode) {
        // Find the user who owns this referral code
        const [referrer] = await db
          .select()
          .from(users)
          .where(eq(users.referralCode, referralCode))
          .limit(1);

        if (referrer) {
          referrerId = referrer.id;
          referrerDeviceFingerprint =
            (referrer as any).deviceFingerprint || null;
        }
      }

      // Generate unique userCode (handle = referralCode = same 6-char code)
      const emailUsername = result.data.username; // username is email in our system
      const submittedName = (req.body.fullName || "").trim();
      const displayName = submittedName
        ? generateDisplayName(undefined, submittedName) // treat submitted name like a Google display name
        : generateDisplayName(emailUsername);
      const firstLetter = submittedName
        ? submittedName.replace(/[^a-zA-Z]/g, "").charAt(0)
        : emailUsername
            .split("@")[0]
            ?.replace(/[^a-zA-Z]/g, "")
            .charAt(0);
      const userCode = await generateUserCode(firstLetter);

      // Generate email verification token
      const emailVerificationToken = generateEmailVerificationToken();
      const emailVerificationExpires = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ); // 24 hours

      const [user] = await db
        .insert(users)
        .values({
          username: result.data.username, // Email is stored as username for login
          handle: userCode,
          displayName,
          fullName: submittedName || null,
          password: result.data.password
            ? await hashPassword(result.data.password)
            : null,
          referredBy: referrerId,
          deviceFingerprint: deviceFingerprint || null,
          referralCode: userCode,
          emailVerified: false,
          emailVerificationToken,
          emailVerificationExpires,
          authProvider: "local",
        })
        .returning();

      // Send verification email (don't block registration on email failure)
      sendVerificationEmail(
        emailUsername,
        emailVerificationToken,
        displayName,
      ).catch((err) => {
        console.error("[Auth] Failed to send verification email:", err);
      });

      // Create referral record if user was referred
      if (referrerId && referralCode) {
        await db.insert(referrals).values({
          referrerId: referrerId,
          referredUserId: user.id,
          referralCode: referralCode,
          rewardAmount: "10.00",
          isRewardClaimed: false,
          completedFirstTransaction: false,
          referrerDeviceFingerprint: referrerDeviceFingerprint,
          referredDeviceFingerprint: deviceFingerprint || null,
        });
        console.log(
          `📣 Referral created: User ${user.id} was referred by user ${referrerId}`,
        );
      }

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json({ ...user, referralApplied: !!referrerId });
      });
    } catch (error) {
      next(error);
    }
  });

  // Google OAuth routes
  app.get("/api/auth/google", authLimiter, (req, res, next) => {
    console.log("[Google OAuth] /api/auth/google hit");
    console.log(
      "[Google OAuth] Client ID exists:",
      !!process.env.GOOGLE_CLIENT_ID,
    );
    console.log(
      "[Google OAuth] Client Secret exists:",
      !!process.env.GOOGLE_CLIENT_SECRET,
    );
    // Store referral code in session for use after OAuth callback
    const refCode = req.query.ref as string;
    if (refCode) {
      (req.session as any).pendingReferralCode = refCode;
      console.log("[Google OAuth] Referral code stored in session:", refCode);
    }
    // Flag native app requests so the callback knows to deep-link back.
    // We encode the redirect_uri in the OAuth `state` parameter rather than
    // the session because passport regenerates the session after login
    // (session-fixation protection), which would destroy any session values
    // written here before the callback fires.
    if (req.query.platform === "native" && req.query.redirect_uri) {
      const statePayload = Buffer.from(
        JSON.stringify({ nativeRedirectUri: req.query.redirect_uri as string }),
      ).toString("base64url");
      console.log("[Google OAuth] Native redirect URI encoded into state");
      return passport.authenticate("google", {
        scope: ["profile", "email"],
        state: statePayload,
      } as any)(req, res, next);
    }
    passport.authenticate("google", {
      scope: ["profile", "email"],
    })(req, res, next);
  });

  app.get("/api/auth/google/callback", authLimiter, (req, res, next) => {
    passport.authenticate("google", {
      failureRedirect: "/auth",
      // keepSessionInfo prevents passport 0.6+ from calling
      // req.session.regenerate(), which would destroy nativeRedirectUri
      // stored before the OAuth redirect started.
      keepSessionInfo: true,
    } as any)(req, res, async (err: any) => {
      if (err) return next(err);
      // Resolve native redirect URI — prefer state param (session-independent)
      // then fall back to session (legacy / web-initiated flows).
      let nativeRedirectUri: string | undefined;
      const rawState = req.query.state as string | undefined;
      if (rawState) {
        try {
          const decoded = JSON.parse(
            Buffer.from(rawState, "base64url").toString(),
          );
          if (decoded?.nativeRedirectUri) {
            nativeRedirectUri = decoded.nativeRedirectUri;
          }
        } catch {
          // not our encoded state — ignore
        }
      }
      if (!nativeRedirectUri && (req.session as any)?.nativeRedirectUri) {
        nativeRedirectUri = (req.session as any).nativeRedirectUri;
        delete (req.session as any).nativeRedirectUri;
      }
      if (nativeRedirectUri) {
        // Issue a short-lived one-time token so the native app can exchange
        // it for a session cookie via a regular fetch call.  We cannot rely
        // on the OAuth session cookie because the in-app browser runs with
        // its own isolated cookie jar — it never reaches the native app's
        // fetch credential store.
        try {
          const token = await storeNativeToken((req.user as any).id);
          const separator = nativeRedirectUri.includes("?") ? "&" : "?";
          return res.redirect(`${nativeRedirectUri}${separator}token=${token}`);
        } catch (tokenErr) {
          console.error("[Google OAuth] Failed to store native token:", tokenErr);
          return next(tokenErr);
        }
      }
      // Check if referral was applied during this OAuth flow
      const referralApplied = (req.session as any)?.referralApplied;
      if (referralApplied) {
        delete (req.session as any).referralApplied;
        res.redirect("/?referral=applied");
      } else {
        res.redirect("/");
      }
    });
  });

  // Native OAuth token exchange
  // The mobile app calls this after openAuthSessionAsync succeeds, passing
  // the one-time token from the deep-link URL.  We validate the token, log
  // the user in (which sets the session cookie on *this* response — a regular
  // fetch request from the native cookie jar), and return the user object.
  app.post("/api/auth/exchange-token", async (req, res, next) => {
    const token = (req.body?.token as string) || (req.query.token as string);
    if (!token) {
      return res.status(400).json({ message: "Token required" });
    }
    const userId = await consumeNativeToken(token);
    if (!userId) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(user);
      });
    } catch (err) {
      next(err);
    }
  });

  // Email verification endpoint
  app.get("/api/auth/verify-email", async (req, res) => {
    try {
      const token = req.query.token as string;

      if (!token) {
        return res.redirect("/auth?error=missing_token");
      }

      // Find user with this token
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.emailVerificationToken, token))
        .limit(1);

      if (!user) {
        return res.redirect("/auth?error=invalid_token");
      }

      // Check if token has expired
      if (
        user.emailVerificationExpires &&
        new Date() > user.emailVerificationExpires
      ) {
        return res.redirect("/auth?error=token_expired");
      }

      // Determine whether this is a first-time verification or an email-change confirmation
      const applyPendingEmail = !!user.pendingEmail;
      const pendingEmail = user.pendingEmail;

      let updatedUser: typeof user;

      if (applyPendingEmail && pendingEmail) {
        // --- Email-change confirmation path ---
        // Re-check uniqueness at confirmation time to close the race window where
        // two users could both request the same address and both click their links.
        // We check both `username` (canonical login field for local accounts) and
        // `email`, excluding the current user's own row.
        const [conflictByUsername] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(ilike(users.username, pendingEmail), ne(users.id, user.id)))
          .limit(1);

        const [conflictByEmail] = !conflictByUsername
          ? await db
              .select({ id: users.id })
              .from(users)
              .where(and(ilike(users.email, pendingEmail), ne(users.id, user.id)))
              .limit(1)
          : [conflictByUsername];

        if (conflictByUsername || conflictByEmail) {
          // Address was claimed by another account after this request was submitted.
          // Clear the pending state so the user can try a different address.
          await db
            .update(users)
            .set({ pendingEmail: null, emailVerificationToken: null, emailVerificationExpires: null })
            .where(eq(users.id, user.id));
          console.warn(
            `[Auth] Email-change conflict for user ${user.id}: ${pendingEmail} already taken`,
          );
          return res.redirect("/auth?error=email_already_taken");
        }

        // Apply the change atomically; catch any last-moment unique-constraint race.
        try {
          const rows = await db
            .update(users)
            .set({
              email: pendingEmail,
              username: pendingEmail,
              emailVerified: true,
              emailVerificationToken: null,
              emailVerificationExpires: null,
              pendingEmail: null,
            })
            .where(eq(users.id, user.id))
            .returning();
          updatedUser = rows[0];
        } catch (dbErr: any) {
          if (dbErr?.code === "23505") {
            // Another confirmation raced and won — clean up and surface the conflict.
            await db
              .update(users)
              .set({ pendingEmail: null, emailVerificationToken: null, emailVerificationExpires: null })
              .where(eq(users.id, user.id));
            console.warn(
              `[Auth] Unique-constraint race on email-change for user ${user.id}: ${pendingEmail}`,
            );
            return res.redirect("/auth?error=email_already_taken");
          }
          throw dbErr;
        }
        console.log(
          `[Auth] Email change confirmed for user ${user.id}: ${user.username} → ${pendingEmail}`,
        );
      } else {
        // --- First-time email verification path ---
        const rows = await db
          .update(users)
          .set({
            emailVerified: true,
            emailVerificationToken: null,
            emailVerificationExpires: null,
            pendingEmail: null,
          })
          .where(eq(users.id, user.id))
          .returning();
        updatedUser = rows[0];
        console.log(
          `[Auth] Email verified for user ${user.id} (${user.username})`,
        );
      }

      // Refresh the session so the user object reflects the verified state
      if (req.isAuthenticated()) {
        req.login(updatedUser, (loginErr) => {
          if (loginErr) {
            console.error(
              "[Auth] Session refresh after verification failed:",
              loginErr,
            );
          }
          return res.redirect("/?verified=true");
        });
      } else {
        return res.redirect("/?verified=true");
      }
    } catch (error) {
      console.error("[Auth] Email verification error:", error);
      return res.redirect("/auth?error=verification_failed");
    }
  });

  // Resend verification email endpoint
  app.post("/api/auth/resend-verification", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    try {
      const user = req.user;

      if (user.emailVerified) {
        return res.status(400).json({ message: "Email already verified" });
      }

      // Generate new token
      const emailVerificationToken = generateEmailVerificationToken();
      const emailVerificationExpires = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      );

      await db
        .update(users)
        .set({
          emailVerificationToken,
          emailVerificationExpires,
        })
        .where(eq(users.id, user.id));

      // Send verification email
      const sent = await sendVerificationEmail(
        user.username,
        emailVerificationToken,
        user.displayName || undefined,
      );

      if (sent) {
        res.json({ message: "Verification email sent" });
      } else {
        res.status(500).json({ message: "Failed to send verification email" });
      }
    } catch (error) {
      console.error("[Auth] Resend verification error:", error);
      res.status(500).json({ message: "Failed to resend verification email" });
    }
  });

  // ── Forgot password ────────────────────────────────────────────────────────
  // POST /api/auth/forgot-password
  // Body: { email }
  // Generates a 1-hour reset token and emails it. Always returns 200 so
  // callers cannot enumerate registered addresses.
  app.post("/api/auth/forgot-password", authLimiter, async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required" });
    }

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, email.trim().toLowerCase()))
        .limit(1);

      // Always respond 200 — do not reveal whether the email exists
      if (!user || !user.password) {
        return res.status(200).json({ message: "If that email is registered you will receive a reset link shortly." });
      }

      const token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db
        .update(users)
        .set({ passwordResetToken: token, passwordResetExpires: expires } as any)
        .where(eq(users.id, user.id));

      sendPasswordResetEmail(user.username, token, user.displayName || undefined).catch((err) => {
        console.error("[Auth] Failed to send password reset email:", err);
      });

      return res.status(200).json({ message: "If that email is registered you will receive a reset link shortly." });
    } catch (error) {
      console.error("[Auth] Forgot-password error:", error);
      return res.status(500).json({ message: "An error occurred. Please try again." });
    }
  });

  // ── Reset password ──────────────────────────────────────────────────────────
  // POST /api/auth/reset-password
  // Body: { token, newPassword }
  app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Reset token is required" });
    }
    if (!newPassword || typeof newPassword !== "string") {
      return res.status(400).json({ message: "New password is required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq((users as any).passwordResetToken, token.trim()))
        .limit(1);

      if (!user) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }

      const expires = (user as any).passwordResetExpires as Date | null;
      if (!expires || new Date() > expires) {
        return res.status(400).json({ message: "Reset token has expired. Please request a new one." });
      }

      const hashed = await hashPassword(newPassword);

      await db
        .update(users)
        .set({
          password: hashed,
          passwordResetToken: null,
          passwordResetExpires: null,
        } as any)
        .where(eq(users.id, user.id));

      console.log(`[Auth] Password reset for user ${user.id} (${user.username})`);
      return res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("[Auth] Reset-password error:", error);
      return res.status(500).json({ message: "An error occurred. Please try again." });
    }
  });

  // ── Reset-password redirect (deep-link shim) ────────────────────────────────
  // GET /api/auth/reset-password-redirect?token=...
  // The reset email links here. Serves an HTML page that:
  //   1. Auto-attempts to open the production app deep link (shareswap://)
  //   2. Offers a manual "Open in app" button for both prod and Expo Go
  //   3. Shows the token so the user can paste it into the app manually
  // This avoids sending a bare custom-scheme redirect (which errors in browsers
  // that can't handle the scheme) and works for both installed and dev builds.
  app.get("/api/auth/reset-password-redirect", resetRedirectLimiter, (req, res) => {
    const rawToken = req.query.token as string;

    // Validate: reset tokens are always 64 lowercase hex chars (randomBytes(32).toString("hex")).
    // Reject anything that doesn't match to prevent reflected injection attacks.
    if (!rawToken || !/^[0-9a-f]{64}$/.test(rawToken)) {
      return res.redirect("/auth?error=invalid_token");
    }

    // HTML-escape helper — prevents XSS in every HTML context.
    const escHtml = (s: string) =>
      s.replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;")
       .replace(/"/g, "&quot;")
       .replace(/'/g, "&#x27;");

    // Safe values for each output context.
    const tokenHtml     = escHtml(rawToken);                       // HTML text / attribute
    const encodedToken  = encodeURIComponent(rawToken);            // URL component
    const tokenJson     = JSON.stringify(rawToken);                // JS string literal (quoted + escaped)

    // Production scheme (app.json: scheme = "shareswap")
    const prodDeepLink = `shareswap://reset-password?token=${encodedToken}`;
    // Expo Go / development scheme (exp+<slug>)
    const expoDeepLink = `exp+shareswap-mobile://reset-password?token=${encodedToken}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your ShareSwap password</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f1f5f9; min-height: 100vh; display: flex;
           align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: 20px; padding: 36px 28px;
            max-width: 420px; width: 100%; text-align: center;
            box-shadow: 0 2px 20px rgba(0,0,0,0.08); }
    .icon { width: 64px; height: 64px; border-radius: 50%;
            background: #f0fdf4; display: flex; align-items: center;
            justify-content: center; margin: 0 auto 20px; font-size: 28px; }
    h1 { font-size: 22px; font-weight: 700; color: #1e293b; margin-bottom: 10px; }
    p  { font-size: 14px; color: #64748b; line-height: 1.6; margin-bottom: 20px; }
    .btn { display: block; width: 100%; padding: 15px;
           background: #0D9488; color: #fff; border: none; border-radius: 14px;
           font-size: 16px; font-weight: 600; cursor: pointer;
           text-decoration: none; margin-bottom: 12px; }
    .btn-outline { background: transparent; color: #0D9488;
                   border: 1.5px solid #0D9488; }
    .token-box { background: #f8fafc; border: 1px solid #e2e8f0;
                 border-radius: 10px; padding: 14px 16px; margin: 16px 0;
                 text-align: left; }
    .token-label { font-size: 11px; font-weight: 600; color: #94a3b8;
                   text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
    .token-value { font-size: 13px; font-family: monospace; color: #1e293b;
                   word-break: break-all; }
    .divider { height: 1px; background: #e2e8f0; margin: 20px 0; }
    .note { font-size: 12px; color: #94a3b8; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔑</div>
    <h1>Reset your password</h1>
    <p>Tap the button below to open the ShareSwap app and set your new password.</p>

    <a class="btn" href="${escHtml(prodDeepLink)}">Open in ShareSwap</a>

    <div class="divider"></div>

    <p>Using Expo Go for development? Use this link instead:</p>
    <a class="btn btn-outline" href="${escHtml(expoDeepLink)}">Open in Expo Go</a>

    <div class="divider"></div>

    <p>Or open the app manually and enter this token on the &ldquo;Set new password&rdquo; screen:</p>
    <div class="token-box">
      <div class="token-label">Reset token</div>
      <div class="token-value">${tokenHtml}</div>
    </div>

    <p class="note">This token expires in <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this page.</p>
  </div>
  <script>
    // Auto-attempt the production deep link on page load — native apps will open;
    // desktop browsers will silently fail or show a dialog. The buttons above are
    // the primary CTA; this just saves one tap for mobile users.
    // tokenJson is a fully JSON-serialized string (no raw interpolation).
    var token = ${tokenJson};
    setTimeout(function() {
      window.location.href = "shareswap://reset-password?token=" + encodeURIComponent(token);
    }, 300);
  </script>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  // ── Change password (authenticated) ────────────────────────────────────────
  // POST /api/account/change-password
  // Body: { currentPassword, newPassword }
  // Only available to local (email/password) accounts. Rate-limited.
  app.post("/api/account/change-password", authLimiter, async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || typeof currentPassword !== "string") {
      return res.status(400).json({ message: "Current password is required" });
    }
    if (!newPassword || typeof newPassword !== "string") {
      return res.status(400).json({ message: "New password is required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    const user = req.user;

    // Google/OAuth users have no local password — they cannot use this endpoint
    if (user.authProvider && user.authProvider !== "local") {
      return res.status(403).json({ message: "Password change is not available for accounts using social login" });
    }

    if (!user.password) {
      return res.status(400).json({ message: "No password set on this account" });
    }

    try {
      const isMatch = await comparePasswords(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      const hashed = await hashPassword(newPassword);
      await db
        .update(users)
        .set({ password: hashed })
        .where(eq(users.id, user.id));

      console.log(`[Auth] Password changed for user ${user.id} (${user.username})`);
      return res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("[Auth] Change-password error:", error);
      return res.status(500).json({ message: "An error occurred. Please try again." });
    }
  });

  app.post("/api/logout", (req, res, next) => {
    if (!req.user) {
      return res.status(200).json({ success: true });
    }
    req.logout((err) => {
      if (err) return next(err);
      res.status(200).json({ success: true });
    });
  });

  app.get("/api/user", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    // Check verification levels
    const emailVerified =
      req.user.emailVerified ||
      !!req.user.googleId ||
      req.user.authProvider === "google";

    // Check identity verification (verifications table has an approved record)
    const [idVerification] = await db
      .select({ status: verifications.status })
      .from(verifications)
      .where(
        and(
          eq(verifications.userId, req.user.id),
          eq(verifications.status, "approved"),
        ),
      )
      .limit(1);
    const idVerified = !!idVerification;

    // Check payment method verification (user has a Stripe payment method on file)
    const paymentVerified = !!req.user.stripePaymentMethodId;

    // Determine verification level
    let verificationLevel: "unverified" | "email_only" | "fully_verified" =
      "unverified";
    if (emailVerified && idVerified && paymentVerified) {
      verificationLevel = "fully_verified";
    } else if (emailVerified) {
      verificationLevel = "email_only";
    }

    const [activeStatus, responseTime] = await Promise.all([
      Promise.resolve(
        computeActiveStatus((req.user as any).lastActiveAt ?? null),
      ),
      computeResponseTime(req.user.id),
    ]);

    res.json({
      ...req.user,
      emailVerified,
      idVerified,
      paymentVerified,
      verificationLevel,
      activeStatus,
      responseTime,
    });
  });
}
