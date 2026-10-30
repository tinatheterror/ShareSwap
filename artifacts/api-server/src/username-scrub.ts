import type { NextFunction, Request, Response } from "express";
import { isEmailShaped } from "./public-identity";

/**
 * Backstop for the per-route fixes: an email account's username is its email address, and any object that
 * leaves the API carrying one for somebody else is rewritten to that person's handle (else display name,
 * else a plain label). The same goes for a display name, full name or handle that is shaped like an address.
 * The viewer's own address is left alone, and so is the admin user directory, whose
 * job is to find an account by email. A route that selects a user's username should still use
 * publicUsername; this catches the ones that are added or missed.
 */
const LABEL = "ShareSwap member";
/** An email account's username is its address, so any "@" in it is a leak. */
const USERNAME_KEY = /^(username|[a-z]+Username|verifierName)$/;
/** Names a person typed (or that was derived from their address): only a value shaped like an address is rewritten. */
const NAME_KEY = /^(displayName|[a-z]+DisplayName|fullName|[a-z]+FullName|handle|[a-z]+Handle)$/;

type Viewer = { id: number | null; username: string | null };

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const FIELD = /^(.*?)(Username|DisplayName|FullName|Handle)$/i;

/** The handle, else the display name, else a plain label: the first that is not itself an address. */
function replacement(object: Record<string, unknown>, key: string): string {
  const [, prefix = "", kind = ""] = key.match(FIELD) ?? [];
  const sibling = (field: "Handle" | "DisplayName") => object[prefix ? `${prefix}${field}` : field[0].toLowerCase() + field.slice(1)];
  const usable = (value: unknown): value is string => typeof value === "string" && value !== "" && !value.includes("@");
  const own = kind.toLowerCase();
  if (own !== "handle" && usable(sibling("Handle"))) return sibling("Handle") as string;
  if (own !== "displayname" && usable(sibling("DisplayName"))) return sibling("DisplayName") as string;
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
    const leaks = typeof entry === "string" && (
      (USERNAME_KEY.test(key) && entry.includes("@")) || (NAME_KEY.test(key) && isEmailShaped(entry))
    );
    if (leaks) {
      const ownId = viewer.id !== null && (value.id === viewer.id || value.userId === viewer.id);
      const ownAddress = viewer.username !== null && (entry as string).toLowerCase() === viewer.username.toLowerCase();
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

// The e2e fixture routes (registered only in E2E_TEST_MODE) hand back the login names the specs sign in with.
const exempt = (path: string) => path === "/api/admin/users" || path.startsWith("/api/admin/users/") || path.startsWith("/api/e2e/");

export function usernameScrubMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api") || exempt(req.path)) return next();
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const user = req.user as { id?: number; username?: string } | undefined;
    return json(scrubEmailUsernames(body, { id: user?.id ?? null, username: user?.username ?? null }));
  };
  next();
}
