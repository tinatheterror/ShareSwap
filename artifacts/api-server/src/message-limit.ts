import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";
import { PostgresRateLimitStore } from "./auth";

export const MESSAGE_WINDOW_MS = 60_000;
export const MESSAGES_PER_WINDOW = 30;
export const MAX_MESSAGE_LENGTH = 2000;

/**
 * POST /api/messages: at most 30 a minute per signed-in user, so one account cannot flood someone's inbox and push
 * notifications. Keyed by user, not IP: put it after the sign-in check. Backed by Postgres so the limit holds across
 * instances and restarts.
 */
export const messageLimiter = rateLimit({
  windowMs: MESSAGE_WINDOW_MS,
  max: MESSAGES_PER_WINDOW,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.E2E_TEST_MODE === "true",
  keyGenerator: (req: Request) => `user:${(req.user as { id: number } | undefined)?.id ?? "anonymous"}`,
  store: new PostgresRateLimitStore(MESSAGE_WINDOW_MS, "messages"),
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ code: "MESSAGE_RATE_LIMITED", error: "You're sending messages too quickly. Please wait a moment." });
  },
});
