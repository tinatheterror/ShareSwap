import type { NextFunction, Request, Response } from "express";

/**
 * Backstop for the per-route fixes: an email account's username is its email address, and any object that
 * leaves the API carrying one for somebody else is rewritten to that person's handle (else display name,
 * else a plain label). The viewer's own address is left alone, and so is the admin user directory, whose
 * job is to find an account by email. A route that selects a user's username should still use
 * publicUsername; this catches the ones that are added or missed.
 */
const LABEL = "ShareSwap member";
const NAME_KEY = /^(username|[a-z]+Username|verifierName)$/;

type Viewer = { id: number | null; username: string | null };

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

function replacement(object: Record<string, unknown>, key: string): string {
  const prefix = key === "username" || key === "verifierName" ? "" : key.slice(0, -"Username".length);
  const handle = object[prefix ? `${prefix}Handle` : "handle"];
  const display = object[prefix ? `${prefix}DisplayName` : "displayName"];
  if (typeof handle === "string" && handle) return handle;
  if (typeof display === "string" && display) return display;
  return LABEL;
}

export function scrubEmailUsernames<T>(value: T, viewer: Viewer): T {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const scrubbed = scrubEmailUsernames(entry, viewer);
      if (scrubbed !== entry) changed = true;
      return scrubbed;
    });
    return (changed ? next : value) as T;
  }
  if (!isPlain(value)) return value;

  let copy: Record<string, unknown> | null = null;
  for (const [key, entry] of Object.entries(value)) {
    let scrubbed: unknown = entry;
    if (typeof entry === "string" && NAME_KEY.test(key) && entry.includes("@")) {
      const ownId = viewer.id !== null && (value.id === viewer.id || value.userId === viewer.id);
      const ownAddress = viewer.username !== null && entry.toLowerCase() === viewer.username.toLowerCase();
      if (!ownId && !ownAddress) scrubbed = replacement(value, key);
    } else {
      scrubbed = scrubEmailUsernames(entry, viewer);
    }
    if (scrubbed !== entry) {
      copy ??= { ...value };
      copy[key] = scrubbed;
    }
  }
  return (copy ?? value) as T;
}

const exempt = (path: string) => path === "/api/admin/users" || path.startsWith("/api/admin/users/");

export function usernameScrubMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api") || exempt(req.path)) return next();
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const user = req.user as { id?: number; username?: string } | undefined;
    return json(scrubEmailUsernames(body, { id: user?.id ?? null, username: user?.username ?? null }));
  };
  next();
}
