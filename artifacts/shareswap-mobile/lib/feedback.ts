/**
 * The public UserJot feedback board, opened in the system browser from Settings > Send feedback. Configuration, not code: set
 * EXPO_PUBLIC_FEEDBACK_URL in the EAS build profile (eas.json) or the dev environment. Nothing about the person is passed to
 * it, and with no (or an invalid) value the row is not shown.
 */
export function parseFeedbackUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// The literal property access is what lets Expo inline the value at build time.
export const FEEDBACK_URL = parseFeedbackUrl(process.env.EXPO_PUBLIC_FEEDBACK_URL);
