import app from "./app";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import { setupStorageRoutes } from "./storage";
import { initializeSampleGames } from "./init-games";
import { initializeAchievements, initializeSubscriptionPlans } from "./init-achievements";
import { startRateLimitCleanup } from "./auth";
import { applyStartupMigrations } from "./startup-migrations";
import { logStripeStartup } from "./stripe.server";
import { backgroundJobsBootLine } from "./background-jobs-gate";
import { backgroundJobs } from "./background-jobs-registry";
import { installShutdownHandlers } from "./shutdown";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  // Apply idempotent SQL before any route or background worker can access new
  // columns. This also covers deployed instances where drizzle-kit is absent.
  await applyStartupMigrations();

  // One line saying whether the in-process timers run in this process, and why.
  logger.info(backgroundJobsBootLine(process.env));

  // Missing Stripe keys stop the boot; otherwise log test/live and the account id (never the keys).
  await logStripeStartup((line) => logger.info(line));

  setupStorageRoutes(app);
  const httpServer = registerRoutes(app);

  try {
    await initializeSampleGames();
    await initializeAchievements();
    // @ts-ignore
    await initializeSubscriptionPlans?.();
  } catch (err) {
    logger.error({ err }, "Failed to initialize features");
  }

  httpServer.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "Server listening");
    startRateLimitCleanup();
  });

  // SIGTERM/SIGINT: stop the timers and let running ticks finish, close the server, end the pool.
  installShutdownHandlers(process, {
    registry: backgroundJobs,
    closeServer: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeIdleConnections?.();
      }),
    closePool: () => pool.end(),
    exit: (code) => process.exit(code),
    log: (line) => logger.info(line),
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    logger.error({ err }, "Server error");
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to apply startup database migrations");
  process.exit(1);
});
