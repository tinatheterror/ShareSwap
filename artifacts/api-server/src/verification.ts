// The one rule for what a signed-in person may do, shared by the API routes and by web and mobile
// (which read the capability flags from GET /api/user instead of working it out themselves).
//
// Verified account: a verified email (link or Google with email_verified) or a verified phone
// sign-up. May swap, claim gifts, list items and act on requests for their own items.
// Fully verified: a verified account + approved ID + a card on file. Required to send BORROW or
// RENT requests.

import { and, desc, eq } from "drizzle-orm";
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

/** The one question "does this member have an approved ID?": any approved verification, whatever rows came after it. */
export async function hasApprovedId(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(and(eq(verifications.userId, userId), eq(verifications.status, "approved")))
    .limit(1);
  return !!row;
}

export type IdVerificationStatus = "unverified" | "pending" | "verified" | "failed";

export interface IdVerificationSummary {
  status: IdVerificationStatus;
  legalFullName: string | null;
  submittedAt: Date | null;
  verifiedAt: Date | null;
  failureReason: string | null;
}

/**
 * What GET /api/verification-status shows. An approved verification always wins ("verified"), so a later pending or rejected row
 * (a second attempt) never turns an approved member back into "Under Review". Without one, the latest row decides; a Persona
 * inquiry that was only started ("created") counts as unverified so the member can retry.
 */
export async function getIdVerificationSummary(userId: number): Promise<IdVerificationSummary> {
  const [approved] = await db
    .select()
    .from(verifications)
    .where(and(eq(verifications.userId, userId), eq(verifications.status, "approved")))
    .orderBy(desc(verifications.createdAt), desc(verifications.id))
    .limit(1);
  if (approved) {
    const [user] = await db.select({ verifiedAt: users.verifiedAt }).from(users).where(eq(users.id, userId)).limit(1);
    return { status: "verified", legalFullName: approved.fullName, submittedAt: approved.createdAt, verifiedAt: user?.verifiedAt ?? approved.createdAt, failureReason: null };
  }
  const [latest] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.userId, userId))
    .orderBy(desc(verifications.createdAt), desc(verifications.id))
    .limit(1);
  if (!latest) return { status: "unverified", legalFullName: null, submittedAt: null, verifiedAt: null, failureReason: null };
  let status: IdVerificationStatus = "unverified";
  if (latest.status === "pending" && latest.personaStatus !== "created") status = "pending";
  else if (latest.status === "rejected") status = "failed";
  return {
    status, legalFullName: latest.fullName, submittedAt: latest.createdAt, verifiedAt: null,
    failureReason: status === "failed" ? "Document could not be verified. Please upload a clearer image." : null,
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

  const idApproved = await hasApprovedId(userId);

  return computeVerification({
    emailVerified: user?.emailVerified,
    phoneVerified: user?.phoneVerified,
    idApproved,
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

/**
 * Where to send the verification link: the stored email, else a username that is itself an address.
 * Google accounts have a username like "jane" and an email on file, so the username alone is not enough.
 */
export function verificationRecipient(user: { email?: string | null; username?: string | null }): string | null {
  const email = user.email?.trim();
  if (email) return email;
  const username = user.username?.trim();
  return username && username.includes("@") ? username : null;
}
