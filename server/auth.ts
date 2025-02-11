import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { users, insertUserSchema, type SelectUser } from "@db/schema";
import { db, pool } from "@db";
import { eq } from "drizzle-orm";
import { fromZodError } from "zod-validation-error";

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

export const store = new PostgresStore({
  pool,
  createTableIfMissing: true,
  tableName: 'session',
  pruneSessionInterval: 60
});

export const sessionSettings = {
  secret: process.env.REPL_ID!,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax' as const,
    httpOnly: true,
    path: '/'
  },
  store,
  name: 'shareswap.sid'
};

export function setupAuth(app: Express) {
  // Enable trust proxy if we're behind a reverse proxy
  app.set('trust proxy', 1);

  // Create session middleware
  const sessionMiddleware = session(sessionSettings);

  // Use session middleware
  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const [user] = await getUserByUsername(username);
        if (!user || !(await comparePasswords(password, user.password))) {
          console.log(`Authentication failed for username: ${username}`);
          return done(null, false, { message: "Invalid username or password" });
        }
        console.log(`Authentication successful for user: ${username}`);
        return done(null, user);
      } catch (error) {
        console.error("Authentication error:", error);
        return done(error);
      }
    })
  );

  passport.serializeUser((user, done) => {
    console.log(`Serializing user ID: ${user.id}`);
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log(`Deserializing user ID: ${id}`);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

      if (!user) {
        console.log(`Deserialization failed: User ${id} not found`);
        return done(null, false);
      }
      console.log(`Deserialization successful for user ID: ${id}`);
      done(null, user);
    } catch (error) {
      console.error("Deserialization error:", error);
      done(error);
    }
  });

  // Authentication routes with improved error handling and logging
  app.post("/api/login", (req, res, next) => {
    console.log("Login attempt for username:", req.body.username);
    passport.authenticate("local", (err: any, user: SelectUser | false, info: any) => {
      if (err) {
        console.error("Login error:", err);
        return next(err);
      }
      if (!user) {
        console.log("Login failed:", info?.message || "Authentication failed");
        return res.status(401).json({ message: info?.message || "Authentication failed" });
      }
      req.login(user, (err) => {
        if (err) {
          console.error("Session creation error:", err);
          return next(err);
        }
        console.log("Login successful for user:", user.username);
        res.json(user);
      });
    })(req, res, next);
  });

  app.post("/api/register", async (req, res, next) => {
    try {
      console.log("Registration attempt for username:", req.body.username);
      const result = insertUserSchema.safeParse(req.body);
      if (!result.success) {
        const error = fromZodError(result.error);
        console.log("Registration validation failed:", error.toString());
        return res.status(400).json({ message: error.toString() });
      }

      const [existingUser] = await getUserByUsername(result.data.username);
      if (existingUser) {
        console.log("Registration failed: Username already exists:", result.data.username);
        return res.status(400).json({ message: "Username already exists" });
      }

      const [user] = await db
        .insert(users)
        .values({
          ...result.data,
          password: await hashPassword(result.data.password),
        })
        .returning();

      console.log("Registration successful for username:", user.username);
      req.login(user, (err) => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    } catch (error) {
      console.error("Registration error:", error);
      next(error);
    }
  });

  app.post("/api/logout", (req, res, next) => {
    if (!req.isAuthenticated()) {
      console.log("Logout failed: User not authenticated");
      return res.status(401).json({ message: "Not authenticated" });
    }
    const username = req.user?.username;
    req.logout((err) => {
      if (err) {
        console.error("Logout error:", err);
        return next(err);
      }
      console.log("Logout successful for user:", username);
      res.sendStatus(200);
    });
  });

  app.get("/api/user", (req, res) => {
    console.log("User info request - Authenticated:", req.isAuthenticated());
    console.log("Session ID:", req.sessionID);
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    console.log("Returning user info for:", req.user?.username);
    res.json(req.user);
  });

  return sessionMiddleware;
}

export function authenticationMiddleware(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Not authenticated" });
}