// The one rule for what a signed-in person may do, shared by the API routes and by web and mobile
// (which read the capability flags from GET /api/user instead of working it out themselves).
//
// Verified account: a verified email (link or Google with email_verified) or a verified phone
// sign-up. May swap, claim gifts, list items and act on requests for their own items.
// Fully verified: a verified account + approved ID + a card on file. Required to send BORROW or
// RENT requests.

import { and, eq } from "drizzle-orm";
import { db, users, verifications } from "@workspace/db";

export type VerificationLevel = "unverified" | "email_only" | "fully_verified";
export type MissingVerification = "email" | "id" | "card";

export interface VerificationFacts {
  emailVerified?: boolean | null;
  phoneVerified?: boolean | null;
  idApproved: boolean;
  cardOnFile: boolean;
}

export interface VerificationCapabilities {
  canSwap: boolean;
  canClaimGift: boolean;
  canList: boolean;
  canBorrow: boolean;
  canRent: boolean;
  /** What is still needed to be fully verified, in the order the user should do it. */
  missing: MissingVerification[];
}

export interface VerificationCheckResult extends VerificationCapabilities {
  level: VerificationLevel;
  /** True for a verified account (email or phone), not only email. Kept as emailVerified for existing callers. */
  emailVerified: boolean;
  idVerified: boolean;
  paymentVerified: boolean;
}

export function computeVerification(facts: VerificationFacts): VerificationCheckResult {
  const verifiedAccount = facts.emailVerified === true || facts.phoneVerified === true;
  const fullyVerified = verifiedAccount && facts.idApproved && facts.cardOnFile;

  const missing: MissingVerification[] = [];
  if (!verifiedAccount) missing.push("email");
  if (!facts.idApproved) missing.push("id");
  if (!facts.cardOnFile) missing.push("card");

  return {
    level: fullyVerified ? "fully_verified" : verifiedAccount ? "email_only" : "unverified",
    emailVerified: verifiedAccount,
    idVerified: facts.idApproved,
    paymentVerified: facts.cardOnFile,
    canSwap: verifiedAccount,
    canClaimGift: verifiedAccount,
    canList: verifiedAccount,
    canBorrow: fullyVerified,
    canRent: fullyVerified,
    missing,
  };
}

export async function getVerificationForUser(userId: number): Promise<VerificationCheckResult> {
  const [user] = await db
    .select({
      emailVerified: users.emailVerified,
      phoneVerified: users.phoneVerified,
      stripePaymentMethodId: users.stripePaymentMethodId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [idVerification] = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(and(eq(verifications.userId, userId), eq(verifications.status, "approved")))
    .limit(1);

  return computeVerification({
    emailVerified: user?.emailVerified,
    phoneVerified: user?.phoneVerified,
    idApproved: !!idVerification,
    cardOnFile: !!user?.stripePaymentMethodId,
  });
}

/** Whether a Google profile proves the email belongs to the person (Google's email_verified claim). */
export function googleEmailIsVerified(profile: {
  emails?: Array<{ value?: string; verified?: boolean | string }>;
  _json?: { email_verified?: boolean | string };
}): boolean {
  const flag = profile.emails?.[0]?.verified ?? profile._json?.email_verified;
  return flag === true || flag === "true";
}
