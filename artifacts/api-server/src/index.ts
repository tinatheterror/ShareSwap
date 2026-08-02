import app from "./app";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import { setupStorageRoutes } from "./storage";
import { initializeSampleGames } from "./init-games";
import { initializeAchievements, initializeSubscriptionPlans } from "./init-achievements";
import { pool } from "@workspace/db";

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
    // Ensure expo_push_token column exists (idempotent migration)
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS expo_push_token TEXT
    `);
    // Ensure user_notification_prefs table exists (idempotent migration)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notification_prefs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        messages BOOLEAN NOT NULL DEFAULT true,
        requests BOOLEAN NOT NULL DEFAULT true,
        payments BOOLEAN NOT NULL DEFAULT true,
        achievements BOOLEAN NOT NULL DEFAULT true,
        sharecoins BOOLEAN NOT NULL DEFAULT true,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_notification_prefs_user_uniq
      ON user_notification_prefs(user_id)
    `);
    // Ensure user_push_tokens table exists (idempotent migration).
    // Stores one row per device token so a single user on multiple devices
    // receives all notifications.  Replaces the single users.expo_push_token column.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS user_push_tokens_token_uniq
      ON user_push_tokens(token)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS user_push_tokens_user_id_idx
      ON user_push_tokens(user_id)
    `);
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
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  logger.error({ err }, "Server error");
  process.exit(1);
});
