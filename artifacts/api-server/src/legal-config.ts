/**
 * Which text people have agreed to. Bump TERMS_VERSION when the Terms of Service or the Community Guidelines change in a
 * way that matters: everyone is then asked to accept again before they continue (see POST /api/account/accept-terms).
 */
export const TERMS_VERSION = "2026-11-02";

export const DEFAULT_SUPPORT_EMAIL = "support@shareswap.app";

/** Where people write for help or to appeal a decision. Configuration (SUPPORT_EMAIL) first, so it can change without a release. */
export function supportEmail(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.SUPPORT_EMAIL?.trim();
  return value && /^[^\s@]+@[^\s@]+$/.test(value) ? value : DEFAULT_SUPPORT_EMAIL;
}

/** Whether this person still has to accept the current text: never accepted, or accepted an older version. */
export function termsAcceptanceRequired(user: { termsAcceptedAt?: Date | string | null; termsVersion?: string | null }): boolean {
  return !user.termsAcceptedAt || user.termsVersion !== TERMS_VERSION;
}
