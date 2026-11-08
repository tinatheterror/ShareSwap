import app from "./app";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import { setupStorageRoutes } from "./storage";
import { initializeSampleGames } from "./init-games";
import { initializeAchievements } from "./init-achievements";
import { startRateLimitCleanup } from "./auth";
import { applyStartupMigrations } from "./startup-migrations";
import { logStripeStartup } from "./stripe.server";
import { requireSubscriptionWebhookSecret } from "./subscription-webhook";
import { DISPUTE_WEBHOOK_SECRET_ENV } from "./dispute-webhook";
import { moderationEmail } from "./moderation-config";
import { termsEnforcementBootWarning } from "./terms-enforcement";
import { timeZoneBootLine } from "./request-dates";
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
  // First, so it is in the log even when a later step stops the boot.
  logger.info(timeZoneBootLine());
  const termsWarning = termsEnforcementBootWarning();
  if (termsWarning) logger.error(termsWarning);
  // Only whether each is set, never the values.
  const missingEmailVars = ["RESEND_API_KEY", "EMAIL_FROM"].filter((name) => !process.env[name]?.trim());
  if (missingEmailVars.length > 0) {
    logger.warn(`[email] ${missingEmailVars.join(" and ")} not set: no email can be sent`);
  }
  if (!moderationEmail()) {
    logger.warn("[moderation] MODERATION_EMAIL is not set: reports are stored and queued, but nobody is emailed about them");
  }

  // Apply idempotent SQL before any route or background worker can access new
  // columns. This also covers deployed instances where drizzle-kit is absent.
  await applyStartupMigrations();

  // One line saying whether the in-process timers run in this process, and why.
  logger.info(backgroundJobsBootLine(process.env));

  // A missing webhook signing secret stops the boot, like missing Stripe keys.
  requireSubscriptionWebhookSecret();

  // The dispute webhook secret only warns (names only): the app must be able to deploy before the Stripe endpoint exists.
  // Until it is set the endpoint rejects every request, so no dispute is recorded, no admin is alerted and no evidence is requested.
  if (!process.env[DISPUTE_WEBHOOK_SECRET_ENV]?.trim()) {
    logger.warn(`${DISPUTE_WEBHOOK_SECRET_ENV} is not set: Stripe dispute events are rejected, so disputes are not recorded and no admin is alerted.`);
  }

  // Missing Stripe keys stop the boot; a failed account lookup only warns. Otherwise log test/live and the account id (never the keys).
  await logStripeStartup((line) => logger.info(line), (line) => logger.warn(line));

  setupStorageRoutes(app);
  const httpServer = registerRoutes(app);

  try {
    await initializeSampleGames();
    await initializeAchievements();
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
