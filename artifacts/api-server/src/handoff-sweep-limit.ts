import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { PostgresRateLimitStore } from "./auth";

export const HANDOFF_SWEEP_WINDOW_MS = 60_000;

/**
 * POST /api/requests/check-handoff-deadlines runs a sweep over every request, so one signed-in user
 * may trigger it once a minute (the web app polls every two minutes). Keyed by user, not IP: put it
 * after the sign-in check. Backed by Postgres so the limit holds across instances and restarts.
 */
export const handoffSweepLimiter = rateLimit({
  windowMs: HANDOFF_SWEEP_WINDOW_MS,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.E2E_TEST_MODE === "true",
  keyGenerator: (req: Request) => `user:${(req.user as { id: number } | undefined)?.id ?? "anonymous"}`,
  store: new PostgresRateLimitStore(HANDOFF_SWEEP_WINDOW_MS, "handoff-sweep"),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: "Handoff deadlines were checked a moment ago. Please try again in a minute." });
  },
});
