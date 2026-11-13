import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { appleLinks, db, referrals, users } from "@workspace/db";
import { isBannedAppleSub } from "./account-deletion/banned-apple";
import { isBannedEmail } from "./account-deletion/banned-email";
import { encryptAppleToken, type AppleIdentity } from "./apple-auth";

type User = typeof users.$inferSelect;

export type AppleSignInOutcome =
  | { kind: "ok"; user: User; created: boolean; linked: boolean }
  /** The account is deactivated; Apple proved its owner, so the caller offers to bring it back. */
  | { kind: "reactivate"; userId: number }
  | { kind: "refused"; reason: "banned" | "blocked" };

export type AppleSignInDeps = {
  generateUserCode(firstLetter?: string): Promise<string>;
  generateDisplayName(email?: string, name?: string): string;
  env?: NodeJS.ProcessEnv;
};

export type AppleSignInInput = {
  /** Apple sends the name once, on the first authorization only, and only to the native client / the first web callback. */
  fullName?: string | null;
  referralCode?: string | null;
};

const shortId = (sub: string) => createHash("sha256").update(sub).digest("hex").slice(0, 10);

/** Apple's name object ({givenName, familyName}, or the web `user.name` with firstName/lastName) as one string. */
export function appleFullName(name: unknown): string | null {
  if (!name || typeof name !== "object") return null;
  const n = name as Record<string, unknown>;
  const parts = [n.givenName ?? n.firstName, n.familyName ?? n.lastName].filter((p): p is string => typeof p === "string" && !!p.trim());
  return parts.length ? parts.join(" ").trim().slice(0, 100) : null;
}

async function ensureLink(userId: number) {
  await db.insert(appleLinks).values({ userId }).onConflictDoNothing();
}

/**
 * Who this Apple sign-in is. In order: a banned Apple ID is refused; an account already holding this `sub` signs in;
 * an existing account with the same *verified* email that has no Apple ID yet is linked (a verified email on both sides
 * proves it is the same person); otherwise a new account is made. An unverified email never links.
 */
export async function resolveAppleUser(identity: AppleIdentity, input: AppleSignInInput, deps: AppleSignInDeps): Promise<AppleSignInOutcome> {
  const env = deps.env ?? process.env;
  if (await isBannedAppleSub(identity.sub, env)) return { kind: "refused", reason: "banned" };

  const [bySub] = await db.select().from(users).where(eq(users.appleId, identity.sub)).limit(1);
  if (bySub) return existingAccount(bySub, identity, false);

  if (identity.email && identity.emailVerified) {
    const matches = await db
      .select()
      .from(users)
      .where(and(sql`lower(${users.email}) = ${identity.email.toLowerCase()}`, eq(users.emailVerified, true), sql`${users.appleId} IS NULL`))
      .limit(2);
    if (matches.length === 1) {
      const target = matches[0];
      if (target.accountStatus === "banned" || target.accountStatus === "deleted") return { kind: "refused", reason: "banned" };
      const [linked] = await db
        .update(users)
        .set({ appleId: identity.sub })
        .where(and(eq(users.id, target.id), sql`${users.appleId} IS NULL`))
        .returning();
      if (linked) {
        await ensureLink(linked.id);
        return existingAccount(linked, identity, true);
      }
    }
  }

  // A banned person whose account was deleted cannot come back under the same address (a private-relay address is
  // new per app, so only a real address can match).
  if (identity.email && !identity.isPrivateEmail && (await isBannedEmail(identity.email, env))) return { kind: "refused", reason: "banned" };

  return createAccount(identity, input, deps);
}

async function existingAccount(user: User, identity: AppleIdentity, linked: boolean): Promise<AppleSignInOutcome> {
  if (user.accountStatus === "deactivated") return { kind: "reactivate", userId: user.id };
  if (user.accountStatus === "banned") return { kind: "refused", reason: "banned" };
  if (user.accountStatus === "deleted") return { kind: "refused", reason: "blocked" };
  const updates: Partial<typeof users.$inferInsert> = {};
  if (identity.email && !user.email) updates.email = identity.email;
  // Apple vouches for *its* address only. It may mark the stored address verified when it is that same address, or when
  // it is being stored from Apple in this very call; a different stored address stays as it was.
  const emailIsApples = !!identity.email && (!user.email || user.email.toLowerCase() === identity.email.toLowerCase());
  if (identity.emailVerified && emailIsApples && !user.emailVerified) updates.emailVerified = true;
  if (Object.keys(updates).length) {
    const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
    return { kind: "ok", user: updated ?? user, created: false, linked };
  }
  return { kind: "ok", user, created: false, linked };
}

async function createAccount(identity: AppleIdentity, input: AppleSignInInput, deps: AppleSignInDeps): Promise<AppleSignInOutcome> {
  // A relay address is random text, so it makes no username or name; a real address does, as for Google.
  const realEmail = identity.email && !identity.isPrivateEmail ? identity.email : undefined;
  const baseUsername = realEmail?.split("@")[0] || `apple_${shortId(identity.sub)}`;
  let username = baseUsername;
  for (let suffix = 1; ; suffix++) {
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (!taken) break;
    username = `${baseUsername}${suffix}`;
  }

  let referrerId: number | null = null;
  let referrerDeviceFingerprint: string | null = null;
  if (input.referralCode) {
    const [referrer] = await db.select().from(users).where(eq(users.referralCode, input.referralCode)).limit(1);
    if (referrer) {
      referrerId = referrer.id;
      referrerDeviceFingerprint = referrer.deviceFingerprint || null;
    }
  }

  const displayName = input.fullName || realEmail ? deps.generateDisplayName(realEmail, input.fullName ?? undefined) : "Member";
  const userCode = await deps.generateUserCode(realEmail?.split("@")[0]?.replace(/[^a-zA-Z]/g, "").charAt(0));
  let newUser: User;
  try {
    [newUser] = await db
      .insert(users)
      .values({
        username,
        handle: userCode,
        displayName,
        email: identity.email,
        appleId: identity.sub,
        authProvider: "apple",
        emailVerified: identity.emailVerified,
        isVerified: false,
        password: null,
        referredBy: referrerId,
        referralCode: userCode,
      })
      .returning();
  } catch (error) {
    // Two first sign-ins for one Apple ID at once: the second finds the first's account.
    if ((error as { code?: string }).code === "23505") {
      const [again] = await db.select().from(users).where(eq(users.appleId, identity.sub)).limit(1);
      if (again) return existingAccount(again, identity, false);
    }
    throw error;
  }
  await ensureLink(newUser.id);
  if (referrerId && input.referralCode) {
    await db.insert(referrals).values({
      referrerId,
      referredUserId: newUser.id,
      referralCode: input.referralCode,
      rewardAmount: "10.00",
      isRewardClaimed: false,
      completedFirstTransaction: false,
      referrerDeviceFingerprint,
      referredDeviceFingerprint: null,
    });
  }
  return { kind: "ok", user: newUser, created: true, linked: false };
}

/** Keeps the refresh token Apple gave for this sign-in, encrypted, so deleting the account can revoke it. */
export async function storeAppleRefreshToken(userId: number, token: { refreshToken: string; clientId: string }, env: NodeJS.ProcessEnv = process.env) {
  const refreshTokenEnc = encryptAppleToken(token, env);
  await db
    .insert(appleLinks)
    .values({ userId, refreshTokenEnc })
    .onConflictDoUpdate({ target: appleLinks.userId, set: { refreshTokenEnc, updatedAt: new Date() } });
}
