import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { bannedAppleHashes, db } from "@workspace/db";
import { BANNED_EMAIL_BLOCK } from "./retention";
import { BannedEmailKeyMissingError } from "./banned-email";

/**
 * The same block as banned-email.ts, for the Apple ID: a banned person whose account was deleted leaves a keyed hash of
 * their Apple `sub` (never the sub), so the same Apple ID cannot sign in again. It uses the same secret as the email
 * hashes, with a prefix so the two kinds of hash can never collide.
 */
export function hashBannedAppleSub(sub: string, env: NodeJS.ProcessEnv = process.env): string {
  const key = env[BANNED_EMAIL_BLOCK.keyEnvVar];
  if (!key || !key.trim()) throw new BannedEmailKeyMissingError();
  return createHmac("sha256", key).update(`apple-sub:${sub}`).digest("hex");
}

/** Whether this Apple ID belongs to a banned person whose account was deleted. With no key configured it answers false (and says so), like the email check. */
export async function isBannedAppleSub(sub: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  let hash: string;
  try {
    hash = hashBannedAppleSub(sub, env);
  } catch (error) {
    if (error instanceof BannedEmailKeyMissingError) {
      console.warn(`[banned-apple] ${error.message}; Apple sign-in is not checked against the block`);
      return false;
    }
    throw error;
  }
  const [row] = await db.select({ id: bannedAppleHashes.id }).from(bannedAppleHashes).where(eq(bannedAppleHashes.subHash, hash)).limit(1);
  return !!row;
}
