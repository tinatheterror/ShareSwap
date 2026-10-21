import type { NextFunction, Request, Response } from "express";
import { isDeployment } from "./background-jobs-gate";

/** Fails closed: NODE_ENV=production or any Replit deployment counts as production. */
export function isProductionRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || isDeployment(env);
}

/**
 * Guards demo and test-only endpoints. In production the route answers as if it did not exist,
 * and the environment is read on every request, not at startup.
 */
export function nonProductionOnly(req: Request, res: Response, next: NextFunction) {
  if (isProductionRuntime()) return res.sendStatus(404);
  return next();
}
