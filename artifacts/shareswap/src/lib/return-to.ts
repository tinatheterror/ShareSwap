/**
 * Where to send someone once they have signed in. Only a plain path on this site is accepted ("/delete-account"):
 * no scheme, no host, no "//", no query, so a crafted link cannot send a signed-in person somewhere else.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\/[A-Za-z0-9\-_/]*$/.test(value) && !value.startsWith("//") ? value : null;
}

const KEY = "returnTo";

/** Remembers the path across the sign-in, which for Google leaves the site and comes back in the same tab. */
export function rememberReturnTo(search: string, storage: Pick<Storage, "setItem"> = sessionStorage) {
  const path = safeReturnTo(new URLSearchParams(search).get("returnTo"));
  if (!path) return;
  try {
    storage.setItem(KEY, path);
  } catch {
    // Private mode: the person just lands on the home page after signing in.
  }
}

/** The remembered path, once; asking again returns null. */
export function takeReturnTo(storage: Pick<Storage, "getItem" | "removeItem"> = sessionStorage): string | null {
  try {
    const path = safeReturnTo(storage.getItem(KEY));
    if (path) storage.removeItem(KEY);
    return path;
  } catch {
    return null;
  }
}
