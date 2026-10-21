// Who must be fully verified (email + ID + card on file): only the person who asks to borrow or rent.
// Swaps and gifts need a verified email, which every route already requires. Owners and lenders never
// need ID or a card to list an item or to act on a request for it.

export const FULL_VERIFICATION_REQUIRED_CODE = "FULL_VERIFICATION_REQUIRED";
const FULL_VERIFICATION_REQUEST_TYPES = ["BORROW", "RENT"];

export interface VerificationStatus {
  level: string;
  idVerified: boolean;
  paymentVerified: boolean;
}

/** The 403 body to send when this requester may not make this kind of request yet, otherwise null. */
export function fullVerificationRejection(
  requestType: string | null | undefined,
  verification: VerificationStatus,
): {
  error: string;
  code: typeof FULL_VERIFICATION_REQUIRED_CODE;
  missing: { idVerified: boolean; paymentVerified: boolean };
} | null {
  if (!requestType || !FULL_VERIFICATION_REQUEST_TYPES.includes(requestType)) return null;
  if (verification.level === "fully_verified") return null;
  return {
    error: "Please complete identity and payment verification to borrow or rent items",
    code: FULL_VERIFICATION_REQUIRED_CODE,
    missing: { idVerified: verification.idVerified, paymentVerified: verification.paymentVerified },
  };
}

// Open gift claims: a person may hold at most this many at once (waiting for an answer or for the handoff).
export const OPEN_GIFT_CLAIM_LIMIT = 3;
export const OPEN_GIFT_CLAIM_STATUSES = ["PENDING", "ACCEPTED"];
export const GIFT_CLAIM_LIMIT_CODE = "GIFT_CLAIM_LIMIT_REACHED";

/** The 403 body to send when this person already has too many open gift claims, otherwise null. */
export function giftClaimLimitRejection(
  requestType: string | null | undefined,
  openGiftClaims: number,
): { error: string; code: typeof GIFT_CLAIM_LIMIT_CODE; limit: number } | null {
  if (requestType !== "GIFT" || openGiftClaims < OPEN_GIFT_CLAIM_LIMIT) return null;
  return {
    error: `You can have up to ${OPEN_GIFT_CLAIM_LIMIT} open gift claims at a time. Wait for an owner to answer, or cancel one, before claiming another gift.`,
    code: GIFT_CLAIM_LIMIT_CODE,
    limit: OPEN_GIFT_CLAIM_LIMIT,
  };
}
