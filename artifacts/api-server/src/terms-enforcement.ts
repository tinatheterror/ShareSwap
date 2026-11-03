import type { NextFunction, Request, Response } from "express";
import { ageConfirmationRequired } from "./age-of-majority";
import { termsAcceptanceRequired } from "./legal-config";

/** The error code clients route to the acceptance screen. */
export const TERMS_ACCEPTANCE_REQUIRED_CODE = "TERMS_ACCEPTANCE_REQUIRED";
export const AGE_CONFIRMATION_REQUIRED_CODE = "AGE_CONFIRMATION_REQUIRED";
export const AGE_CONFIRMATION_REQUIRED_MESSAGE = "Please confirm your date of birth and where you live to continue.";

// Deliberately free of the words "csrf" and "token": both apps retry a 403 whose body mentions them.
export const TERMS_ACCEPTANCE_REQUIRED_MESSAGE = "Please accept the updated Terms of Service and Community Guidelines to continue.";

/**
 * Write requests that still work before the current Terms are accepted. Accepting must work, reporting and blocking must
 * never be locked (they are how people stay safe), and people must be able to sign out, change a password, leave or
 * delete their account (including withdrawing their own wallet balance first, which deletion requires), and have their device registered for notifications. Staff tools are exempt so moderation does not
 * wait on a moderator's own acceptance. Everything else that writes (messages, listings, requests, reviews, wishlists,
 * payments, profile edits and so on) is refused.
 */
const EXEMPT_PREFIXES = ["/api/account/", "/api/reports", "/api/blocks", "/api/admin/", "/api/e2e/", "/api/user/push-token", "/api/user/notification-prefs"];
// /api/rental-balance/payout moves only the signed-in person's own balance to their own payout account (every lookup in the route is
// keyed to req.user.id), and a wallet of $10 or more must be withdrawn before an account can be deleted, so a gated person needs it.
const EXEMPT_EXACT = new Set(["/api/login", "/api/logout", "/api/register", "/api/csrf-token", "/api/rental-balance/payout"]);
const EXEMPT_AUTH_PATTERN = /^\/api\/(?:auth\/|forgot-password|reset-password|verify-email|resend-verification)/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isExemptFromTermsAcceptance(path: string): boolean {
  return EXEMPT_EXACT.has(path) || EXEMPT_AUTH_PATTERN.test(path) || EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/$/, "")}/`));
}

/**
 * TERMS_ENFORCEMENT=off turns the refusal off (anything else, or nothing, leaves it on). It is the switch for backing the
 * rule out in an emergency, and what the API test script sets because most suites sign in users who were created
 * without an acceptance; terms.test.ts turns it back on for itself.
 */
export const termsEnforced = (env: NodeJS.ProcessEnv = process.env) => env.TERMS_ENFORCEMENT?.trim().toLowerCase() !== "off";

/**
 * The boot line for TERMS_ENFORCEMENT=off in production, where it means nobody has to accept the Terms or confirm their age
 * before writing anything. It is for emergencies and tests, so it is logged at error level every time the server starts, and
 * null when there is nothing to say.
 */
export function termsEnforcementBootWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.NODE_ENV !== "production" || termsEnforced(env)) return null;
  return "[terms] TERMS_ENFORCEMENT=off in production: write actions are NOT refused for people who have not accepted the current Terms or confirmed their age. Unset it unless this is a deliberate, temporary rollback.";
}

/** Refuses write actions from a signed-in person who has not accepted the current Terms. Reads and signed-out requests pass. */
export function requireCurrentTerms(req: Request, res: Response, next: NextFunction) {
  if (!WRITE_METHODS.has(req.method.toUpperCase()) || !termsEnforced()) return next();
  const user = req.user as { termsAcceptedAt?: Date | string | null; termsVersion?: string | null; ageConfirmedAt?: Date | string | null; ageRegion?: string | null } | undefined;
  if (!user) return next();
  const path = req.originalUrl.split("?")[0];
  if (isExemptFromTermsAcceptance(path)) return next();
  if (termsAcceptanceRequired(user)) return res.status(403).json({ code: TERMS_ACCEPTANCE_REQUIRED_CODE, message: TERMS_ACCEPTANCE_REQUIRED_MESSAGE });
  // The same rule and the same exemptions for the age check: nobody writes anything until their age has been confirmed.
  if (ageConfirmationRequired(user)) return res.status(403).json({ code: AGE_CONFIRMATION_REQUIRED_CODE, message: AGE_CONFIRMATION_REQUIRED_MESSAGE });
  return next();
}
