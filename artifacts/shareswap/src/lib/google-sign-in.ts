/** Cross-origin preview frames may deny access; those also need a new tab. */
export function isEmbeddedBrowser(browser: { self: unknown; readonly top: unknown }): boolean {
  try {
    return browser.self !== browser.top;
  } catch {
    return true;
  }
}

export function googleSignInHref(referralCode: string, basePath: string): string {
  const path = `${basePath.replace(/\/$/, "")}/api/auth/google`;
  const referral = referralCode.trim();
  return referral ? `${path}?ref=${encodeURIComponent(referral)}` : path;
}