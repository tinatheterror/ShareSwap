import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, items, referrals, insertUserSchema, type SelectUser } from "@db/schema";
import { db, pool } from "@db";
import { eq, or, and } from "drizzle-orm";
import { fromZodError } from "zod-validation-error";

// Security: Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 attempts per windowMs
  message: 'Too many authentication attempts, please try again later.',
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

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

async function getUserByUsername(username: string) {
  return db.select().from(users).where(eq(users.username, username)).limit(1);
}

// Use a strong session secret from environment, fallback to REPL_ID only in development
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.REPL_ID || randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('WARNING: SESSION_SECRET not set in production! Using fallback which is insecure.');
}

export const sessionSettings: session.SessionOptions = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // Enable secure cookies in production
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict', // Stricter CSRF protection
    httpOnly: true,
    path: '/'
  },
  name: 'shareswap.sid'
};

export const store = new PostgresStore({
  pool,
  createTableIfMissing: true,
  tableName: 'session',
  pruneSessionInterval: 60
});

export function setupAuth(app: Express) {
  // Enable trust proxy for secure cookies behind reverse proxy
  app.set('trust proxy', 1);

  app.use(session({
    ...sessionSettings,
    store
  }));

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await getUserByUsername(username);
        if (!user || !user.password || !(await comparePasswords(password, user.password))) {
          return done(null, false, { message: "Invalid username or password" });
        }
        return done(null, user);
      } catch (error) {
        console.error("Authentication error:", error);
        return done(error);
      }
    })
  );

  // Google OAuth Strategy - use absolute production URL for callback
  // This must match exactly what's configured in Google Cloud Console
  const googleCallbackURL = 'https://share-swap-mvp.replit.app/api/auth/google/callback';
  
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    console.log("[Google OAuth] Strategy configured with callback URL:", googleCallbackURL);
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: googleCallbackURL,
          passReqToCallback: false,
        } as any,
        async (accessToken, refreshToken, profile, done) => {
          try {
            // Check if user exists with this Google ID
            const [existingUser] = await db
              .select()
              .from(users)
              .where(eq(users.googleId, profile.id))
              .limit(1);

            if (existingUser) {
              return done(null, existingUser);
            }

            // Create new user from Google profile
            let baseUsername = profile.emails?.[0]?.value?.split('@')[0] || `google_${profile.id.slice(0, 10)}`;
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
            
            const [newUser] = await db
              .insert(users)
              .values({
                username,
                googleId: profile.id,
                authProvider: 'google',
                isVerified: true, // Google accounts are pre-verified
                password: null,
              })
              .returning();

            return done(null, newUser);
          } catch (error) {
            console.error("Google authentication error:", error);
            return done(error as Error);
          }
        }
      )
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
    passport.authenticate("local", (err: any, user: SelectUser | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Authentication failed" });
      }
      // Check if account is deactivated
      if ((user as any).accountStatus === 'deactivated') {
        return res.status(403).json({ 
          message: "Account deactivated",
          accountStatus: 'deactivated',
          deactivatedAt: (user as any).deactivatedAt,
          userId: user.id
        });
      }
      req.login(user, (err) => {
        if (err) return next(err);
        res.json(user);
      });
    })(req, res, next);
  });

  // Reactivate a deactivated account
  app.post("/api/reactivate-account", authLimiter, async (req, res, next) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    try {
      const [user] = await getUserByUsername(username);
      if (!user || !user.password || !(await comparePasswords(password, user.password))) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      if ((user as any).accountStatus !== 'deactivated') {
        return res.status(400).json({ message: "Account is not deactivated" });
      }
      // Reactivate the account
      await db
        .update(users)
        .set({ 
          accountStatus: 'active',
          deactivatedAt: null
        } as any)
        .where(eq(users.id, user.id));
      
      // Restore user's items (make them available again)
      await db
        .update(items)
        .set({ isAvailable: true })
        .where(eq(items.ownerId, user.id));
      
      // Login the user
      req.login({ ...user, accountStatus: 'active', deactivatedAt: null } as any, (err) => {
        if (err) return next(err);
        res.json({ message: "Account reactivated successfully", user: { ...user, accountStatus: 'active' } });
      });
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
      const { referralCode } = req.body;
      let referrerId: number | null = null;

      if (referralCode) {
        // Find the user who owns this referral code
        const [referrer] = await db
          .select()
          .from(users)
          .where(eq(users.referralCode, referralCode))
          .limit(1);

        if (referrer) {
          referrerId = referrer.id;
        }
      }

      const [user] = await db
        .insert(users)
        .values({
          ...result.data,
          password: result.data.password ? await hashPassword(result.data.password) : null,
          referredBy: referrerId,
        })
        .returning();

      // Create referral record if user was referred
      if (referrerId && referralCode) {
        await db.insert(referrals).values({
          referrerId: referrerId,
          referredUserId: user.id,
          referralCode: referralCode,
          rewardAmount: "10.00",
          isRewardClaimed: false,
          completedFirstTransaction: false,
        });
      }

      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    } catch (error) {
      next(error);
    }
  });

  // Google OAuth routes
  app.get("/api/auth/google", authLimiter, (req, res, next) => {
    passport.authenticate("google", { 
      scope: ["profile", "email"]
    })(req, res, next);
  });

  app.get("/api/auth/google/callback", authLimiter, (req, res, next) => {
    passport.authenticate("google", { 
      failureRedirect: "/auth"
    })(req, res, (err: any) => {
      if (err) return next(err);
      res.redirect("/");
    });
  });

  app.post("/api/logout", (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not logged in" });
    }
    req.logout((err) => {
      if (err) return next(err);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json(req.user);
  });
}