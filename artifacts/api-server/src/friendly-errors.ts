import { randomBytes } from "node:crypto";
import type { Express, NextFunction, Request, Response } from "express";
import { logger } from "./lib/logger";

/**
 * No raw server error reaches a person (App Store readiness #10).
 *
 * Every 5xx response body is replaced with a friendly message and a support reference id; the original body
 * and the error behind it are logged under that id, so support can find the detail from what the person
 * reads out. 4xx bodies are deliberate validation messages and pass through unchanged. A 5xx that carries a
 * structured `code` (or is a 503 "not available right now") is deliberate too: it keeps its body and gains the id.
 */

export const GENERIC_SERVER_MESSAGE = "Something went wrong on our side. Please try again in a moment.";
export const REFERENCE_PREFIX = "SS-";

export function newReferenceId(): string {
  return `${REFERENCE_PREFIX}${randomBytes(4).toString("hex").toUpperCase()}`;
}

function referenceIdFor(res: Response): string {
  if (typeof res.locals.referenceId !== "string") res.locals.referenceId = newReferenceId();
  return res.locals.referenceId;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value);
}

/** Pure: what a 5xx body becomes. Exported for tests. */
export function shieldBody(status: number, body: unknown, referenceId: string): Record<string, unknown> {
  if (isPlainObject(body) && (status === 503 || typeof body.code === "string")) {
    return { ...body, referenceId };
  }
  return { error: GENERIC_SERVER_MESSAGE, message: GENERIC_SERVER_MESSAGE, referenceId };
}

/** Registered early in app.ts: wraps res.json so every 5xx body is shielded and logged. */
export function errorShield(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = ((body?: unknown) => {
    if (res.statusCode >= 500) {
      const referenceId = referenceIdFor(res);
      logger.error(
        {
          referenceId,
          method: req.method,
          path: req.originalUrl?.split("?")[0],
          status: res.statusCode,
          userId: (req as { user?: { id?: number } }).user?.id,
          responseBody: body,
          err: res.locals.errorDetail,
        },
        `[error ${referenceId}] ${req.method} ${req.originalUrl?.split("?")[0]} answered ${res.statusCode}`,
      );
      return originalJson(shieldBody(res.statusCode, body, referenceId));
    }
    return originalJson(body);
  }) as Response["json"];
  next();
}

type HttpishError = Error & { status?: number; statusCode?: number; type?: string };

/** Pure: status and message for an error that reached the final handler. Exported for tests. */
export function describeUncaught(err: HttpishError): { status: number; message: string } {
  const status = err.status ?? err.statusCode;
  if (err.type === "entity.too.large" || status === 413) return { status: 413, message: "That upload is too large. Try a smaller file." };
  if (err.type === "entity.parse.failed" || err.type === "encoding.unsupported" || status === 400) {
    return { status: 400, message: "We couldn't read that request. Please try again." };
  }
  if (typeof status === "number" && status >= 400 && status < 500) {
    return { status, message: "That request couldn't be completed." };
  }
  return { status: 500, message: GENERIC_SERVER_MESSAGE };
}

/** Registered last: JSON for unknown /api paths, and a JSON answer (never an HTML stack trace) for uncaught errors. */
export function installErrorHandlers(app: Express) {
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "We couldn't find that." });
  });

  app.use((err: HttpishError, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    res.locals.errorDetail = err;
    const { status, message } = describeUncaught(err);
    if (status >= 500) return res.status(status).json({ error: message });
    // A 4xx from a parser or middleware: log it quietly, keep the friendly text.
    logger.warn({ method: req.method, path: req.originalUrl?.split("?")[0], status, errType: err.type }, "[error] request refused");
    return res.status(status).json({ error: message });
  });
}
