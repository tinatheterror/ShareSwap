import type { NextFunction, Request, Response } from "express";

// The trust score used to be called reputationScore in the API. Apps already installed on people's phones still
// read that name, so every JSON response that carries a numeric trustScore also carries reputationScore with the
// same value. New code reads trustScore; drop this once those builds are gone.

const MAX_DEPTH = 6;

export function addLegacyReputationScore<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    for (const item of value) addLegacyReputationScore(item, depth + 1);
    return value;
  }
  // Plain objects only: dates and other class instances are left alone.
  if (Object.getPrototypeOf(value) !== Object.prototype) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.trustScore === "number" && !("reputationScore" in record)) record.reputationScore = record.trustScore;
  for (const key of Object.keys(record)) addLegacyReputationScore(record[key], depth + 1);
  return value;
}

export function legacyReputationScoreAlias(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => json(addLegacyReputationScore(body));
  next();
}
