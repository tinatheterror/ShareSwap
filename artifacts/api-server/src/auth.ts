import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
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
import { eq, or, and } from "drizzle-orm";
import { fromZodError } from "zod-validation-error";
import { sendVerificationEmail } from "./sendgrid";
import { computeActiveStatus, computeResponseTime } from "./user-stats";

// Security: Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 attempts per windowMs
  message: "Too many authentication attempts, please try again later.",
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
});

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
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
    // Flag native app requests so the callback knows to deep-link back
    if (req.query.platform === "native" && req.query.redirect_uri) {
      (req.session as any).nativeRedirectUri = req.query.redirect_uri as string;
      console.log(
        "[Google OAuth] Native redirect URI stored:",
        req.query.redirect_uri,
      );
    }
    passport.authenticate("google", {
      scope: ["profile", "email"],
    })(req, res, next);
  });

  app.get("/api/auth/google/callback", authLimiter, (req, res, next) => {
    passport.authenticate("google", {
      failureRedirect: "/auth",
    })(req, res, (err: any) => {
      if (err) return next(err);
      // Check if this login came from the native app
      const nativeRedirectUri = (req.session as any)?.nativeRedirectUri;
      if (nativeRedirectUri) {
        delete (req.session as any).nativeRedirectUri;
        return res.redirect(nativeRedirectUri);
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

      // Mark email as verified
      const [updatedUser] = await db
        .update(users)
        .set({
          emailVerified: true,
          emailVerificationToken: null,
          emailVerificationExpires: null,
        })
        .where(eq(users.id, user.id))
        .returning();

      console.log(
        `[Auth] Email verified for user ${user.id} (${user.username})`,
      );

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
