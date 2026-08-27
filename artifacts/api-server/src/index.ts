import app from "./app";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import { setupStorageRoutes } from "./storage";
import { initializeSampleGames } from "./init-games";
import { initializeAchievements, initializeSubscriptionPlans } from "./init-achievements";
import { startRateLimitCleanup } from "./auth";
import { applyStartupMigrations } from "./startup-migrations";

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

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    logger.error({ err }, "Server error");
    process.exit(1);
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to apply startup database migrations");
  process.exit(1);
});
