import express, { type Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { initializeSampleGames } from "./init-games";
import {
  initializeAchievements,
  initializeSubscriptionPlans,
} from "./init-achievements";
import { setupVite, serveStatic, log } from "./vite";
import { attachCsrfToken } from "./csrf";
import { setupStorageRoutes } from "./storage";

// ─── Global crash guards ────────────────────────────────────────────────────
// Neon serverless databases auto-suspend and emit various connection errors
// (57P01, ECONNRESET, socket hang up, WebSocket closed, etc.).  Rather than
// trying to enumerate every possible error message we keep the process alive
// for ALL uncaught exceptions and unhandled rejections that aren't
// programmer errors (syntax / type errors detected at startup time would
// already have been thrown before this handler is registered).
process.on("uncaughtException", (err: any) => {
  const msg = err?.message ?? String(err);
  log(`[warn] Uncaught exception – keeping process alive: ${msg}`);
  if (process.env.NODE_ENV !== "production") {
    console.error(err);
  }
});

process.on("unhandledRejection", (reason: any) => {
  const msg = reason?.message ?? String(reason);
  log(`[warn] Unhandled promise rejection – keeping process alive: ${msg}`);
  if (process.env.NODE_ENV !== "production") {
    console.error(reason);
  }
});

const app = express();

// Security: Enable helmet with appropriate CSP for Vite
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production" ? undefined : false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow images to load on iOS
  }),
);

// Security: Rate limiting for all requests
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Security: Stricter rate limiting for auth endpoints
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: "Too many login attempts, please try again later.",
  skipSuccessfulRequests: true,
});

app.use("/api/", generalLimiter);

// Security: Parse cookies (required for CSRF protection)
app.use(cookieParser());

app.use(express.json({ limit: "10mb" })); // Limit request body size
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Setup object storage routes for serving uploaded images
  setupStorageRoutes(app);
  
  const server = registerRoutes(app);

  // Initialize sample games and features
  await initializeSampleGames();
  await initializeAchievements();
  await initializeSubscriptionPlans();

  // Security: Global error handler - don't expose stack traces or internal errors
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    // Log error for debugging (consider using proper logging service in production)
    console.error("Error:", {
      message: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      status,
    });

    // Don't expose internal error messages in production
    const message =
      status === 500 && process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : err.message || "Internal Server Error";

    res.status(status).json({ message });
    // Don't throw error - it's already handled
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // Use the HTTP server returned by registerRoutes instead of app.listen
  const PORT = 5000;

  const startServer = () => {
    server.listen(PORT, "0.0.0.0", () => {
      log(`serving on port ${PORT}`);
    });
  };

  let retryCount = 0;
  const maxRetries = 5;

  const handleServerError = (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && retryCount < maxRetries) {
      retryCount++;
      log(`Port ${PORT} in use — retry ${retryCount}/${maxRetries} in 1.5s...`);
      if (retryCount === 1) {
        // First attempt: try to kill whatever is holding the port
        const { execSync } = require("child_process");
        try {
          // pkill is available in this environment; target the previous tsx process
          execSync(`pkill -f "tsx server/index" || true`, { stdio: "ignore" });
        } catch (_) {}
      }
      setTimeout(() => {
        server.removeAllListeners("error");
        server.on("error", handleServerError);
        startServer();
      }, 1500);
    } else {
      log(`[error] Server error (code=${err.code}): ${err.message}`);
    }
  };

  server.on("error", handleServerError);

  startServer();

  // Log WebSocket server setup
  log(`WebSocket server configured at /ws/chat`);
})();
