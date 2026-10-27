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
