import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { bannedEmailHashes, db } from "@workspace/db";
import { BANNED_EMAIL_BLOCK } from "./retention";

/** Raised when a banned account is deleted but the hash key is not configured: the block would silently not exist. */
export class BannedEmailKeyMissingError extends Error {
  constructor() {
    super(`${BANNED_EMAIL_BLOCK.keyEnvVar} is not set, so the email block for a banned account cannot be recorded`);
    this.name = "BannedEmailKeyMissingError";
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The address an account was opened with: the email column, or the username of an email account. */
export function accountEmail(user: { email?: string | null; username?: string | null }): string | null {
  const candidate = user.email?.trim() || (user.username?.includes("@") ? user.username.trim() : "");
  return candidate || null;
}

/** HMAC-SHA256 of the normalised address, hex. Throws when the key is missing or empty. */
export function hashBannedEmail(email: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env[BANNED_EMAIL_BLOCK.keyEnvVar];
  if (!key || !key.trim()) throw new BannedEmailKeyMissingError();
  return createHmac("sha256", key).update(normalizeEmail(email)).digest("hex");
}

/**
 * Whether this address belongs to a banned person whose account was deleted. Used by sign-up. With no key
 * configured it answers false (and says so), because refusing every sign-up would be worse than a missing block;
 * deleting a banned account without the key still fails closed.
 */
export async function isBannedEmail(email: string | null | undefined, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!email) return false;
  let hash: string;
  try {
    hash = hashBannedEmail(email, env);
  } catch (error) {
    if (error instanceof BannedEmailKeyMissingError) {
      console.warn(`[banned-email] ${error.message}; sign-up is not checked against the block`);
      return false;
    }
    throw error;
  }
  const [row] = await db.select({ id: bannedEmailHashes.id }).from(bannedEmailHashes).where(eq(bannedEmailHashes.emailHash, hash)).limit(1);
  return !!row;
}
