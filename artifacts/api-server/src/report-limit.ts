import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { PostgresRateLimitStore } from "./auth";

export const REPORT_WINDOW_MS = 60 * 60 * 1000;
export const REPORTS_PER_WINDOW = 20;

/** POST /api/reports: 20 an hour per signed-in user, so the queue cannot be flooded from one account. */
export const reportLimiter = rateLimit({
  windowMs: REPORT_WINDOW_MS,
  max: REPORTS_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.E2E_TEST_MODE === "true",
  keyGenerator: (req: Request) => `user:${(req.user as { id: number } | undefined)?.id ?? "anonymous"}`,
  store: new PostgresRateLimitStore(REPORT_WINDOW_MS, "reports"),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ code: "REPORT_RATE_LIMITED", error: "You've sent a lot of reports. Please try again later." });
  },
});
