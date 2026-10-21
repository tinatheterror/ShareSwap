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
