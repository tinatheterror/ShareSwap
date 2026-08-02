import app from "./app";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import { setupStorageRoutes } from "./storage";
import { initializeSampleGames } from "./init-games";
import { initializeAchievements, initializeSubscriptionPlans } from "./init-achievements";
import { startRateLimitCleanup } from "./auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Setup storage routes
setupStorageRoutes(app);

// Register all app routes (returns HTTP server with WebSocket support)
const httpServer = registerRoutes(app);

// Initialize features
(async () => {
  try {
    await initializeSampleGames();
    await initializeAchievements();
    // @ts-ignore
    await initializeSubscriptionPlans?.();
  } catch (err) {
    logger.error({ err }, "Failed to initialize features");
  }
})();

httpServer.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
  startRateLimitCleanup();
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
