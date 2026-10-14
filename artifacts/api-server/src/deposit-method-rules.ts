// Deposit-method rules that depend on the request type.
//
// A rental is always paid in the app: its rental fee and deposit are Stripe charges, and the
// refund rules on cancel and expiry assume they exist. Only a BORROW may settle its deposit in person.

export const RENT_REQUIRES_IN_APP_DEPOSIT_CODE = "RENT_REQUIRES_IN_APP_DEPOSIT";
export const RENT_REQUIRES_IN_APP_DEPOSIT_MESSAGE = "Rentals are paid in the app. Choose an in-app deposit.";

/** The 400 body to send when this type and deposit method may not go together, otherwise null. */
export function depositMethodRejection(
  requestType: string | null | undefined,
  depositMethod: unknown,
): { error: string; code: typeof RENT_REQUIRES_IN_APP_DEPOSIT_CODE } | null {
  if (requestType === "RENT" && depositMethod === "in_person") {
    return { error: RENT_REQUIRES_IN_APP_DEPOSIT_MESSAGE, code: RENT_REQUIRES_IN_APP_DEPOSIT_CODE };
  }
  return null;
}
