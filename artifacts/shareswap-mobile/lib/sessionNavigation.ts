const PRIVATE_SCREEN = /^\/(?:wallet|sharecoin-wallet|my-shared-items|transactions|achievements|score-history|referrals|settings|edit-profile|payment-methods|subscription|verification|notifications|verify-email-prompt)$/;

export function requiresSignIn(pathname: string): boolean {
  return PRIVATE_SCREEN.test(pathname) || /^\/(?:chat|edit-item)\/\d+$/.test(pathname);
}

/** Resume read-only screens, never replay a mutation or accept arbitrary URLs. */
export function resumeDestination(
  returnTo: unknown,
  returnUserId: unknown,
  userId: number,
): string {
  if (typeof returnTo !== "string" || String(userId) !== returnUserId) return "/(tabs)";
  if (/^\/chat\/\d+(?:\?requestId=\d+)?$/.test(returnTo)) return returnTo;
  if (PRIVATE_SCREEN.test(returnTo)) return returnTo;
  if (/^\/(?:item|profile|edit-item)\/\d+$/.test(returnTo)) return returnTo;
  if (/^\/(?:inbox|profile|share|wishlist|games)?$/.test(returnTo)) return returnTo;
  return "/(tabs)";
}