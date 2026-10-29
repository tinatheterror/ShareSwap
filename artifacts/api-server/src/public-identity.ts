/**
 * An email account's `username` is its email address, so it must never reach another user. Google accounts
 * get an email local part as their username, which is not an address, and stay as they are. The handle is a
 * generated code that the by-username profile routes already accept, so clients that still read `username`
 * keep working.
 */
export type PublicIdentityRow = {
  username: string | null;
  handle: string | null;
  displayName: string | null;
  authProvider: string | null;
};

export const isEmailAccount = (row: Pick<PublicIdentityRow, "authProvider">) =>
  !row.authProvider || row.authProvider === "local";

export function publicUsername(row: PublicIdentityRow): string | null {
  if (!isEmailAccount(row)) return row.username;
  return row.handle || row.displayName || null;
}

/**
 * The name to put in text another user reads (a notification, a push, a chat line): the display name, or a
 * username that is not an email address. Null when neither exists, so the caller's own fallback applies.
 */
export const publicName = (row: { displayName?: string | null; username?: string | null } | null | undefined): string | null =>
  row?.displayName || (row?.username && !row.username.includes("@") ? row.username : null);

/** Something@something: what a name field must not hold, since the name is shown to other users. */
export const isEmailShaped = (value: unknown): boolean => typeof value === "string" && /[^\s@]+@[^\s@]+/.test(value);
