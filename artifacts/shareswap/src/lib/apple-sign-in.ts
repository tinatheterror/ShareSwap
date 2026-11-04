/** The server's Sign in with Apple redirect (web). The referral code rides along so a new account is credited to the referrer. */
export function appleSignInHref(referralCode: string, basePath: string): string {
  const path = `${basePath.replace(/\/$/, "")}/api/auth/apple/start`;
  const referral = referralCode.trim();
  return referral ? `${path}?ref=${encodeURIComponent(referral)}` : path;
}

/** What the sign-in page says when the server sends the browser back with ?apple=<reason>. */
export const APPLE_SIGN_IN_MESSAGES: Record<string, string> = {
  failed: "Apple sign-in could not be completed. Please try again.",
  refused: "This account cannot be used on ShareSwap.",
  unavailable: "Sign in with Apple is not available right now.",
};
