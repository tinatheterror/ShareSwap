/**
 * Turns a failed response (or a failed fetch) into text a person can read (App Store readiness #10).
 * The server already replaces 5xx bodies with a friendly message and a support reference id
 * (api-server/src/friendly-errors.ts); this is the second line of defence: a non-JSON body, an HTML error
 * page, a proxy error or a technical-looking message never reaches the screen. This file is mirrored in
 * shareswap-mobile/lib/friendlyError.ts.
 */

export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again in a moment.";
export const NETWORK_ERROR_MESSAGE = "We couldn't reach ShareSwap. Check your connection and try again.";

/** Text that comes from a crash, a database or a proxy rather than from a sentence we wrote. */
const TECHNICAL = new RegExp(
  [
    String.raw`<\/?[a-z][^>]*>`, // markup
    String.raw`\bat\s+\S+\s+\(.*:\d+:\d+\)`, // stack frame
    String.raw`\b(?:ECONN\w*|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE)\b`,
    String.raw`\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b`,
    String.raw`violates (?:foreign key|unique|not-null|check)`,
    String.raw`duplicate key value`,
    String.raw`\brelation "[^"]+"`,
    String.raw`\bcolumn "[^"]+"`,
    String.raw`Unexpected token`,
    String.raw`\[object \w+\]`,
    String.raw`\bundefined\b`,
    String.raw`\b(?:psql|pg_|sqlstate)\b`,
  ].join("|"),
  "i",
);

/** A bare error code such as CONNECT_NOT_ENABLED is for programs, not people. */
const CODE_LIKE = /^[A-Z][A-Z0-9_]{2,}$/;

export function messageForStatus(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "Your request could not be verified. Please try again.";
  if (status === 404) return "We couldn't find that.";
  if (status === 413) return "That upload is too large. Try a smaller file.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  return GENERIC_ERROR_MESSAGE;
}

function readable(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 400 || CODE_LIKE.test(text) || TECHNICAL.test(text)) return null;
  return text;
}

export function withReference(message: string, referenceId?: unknown): string {
  return typeof referenceId === "string" && /^SS-[0-9A-F]{8}$/.test(referenceId) ? `${message} (Reference: ${referenceId})` : message;
}

/** The message for a non-2xx response. `parsed` is the JSON body when there was one. */
export function friendlyMessage(status: number, parsed: Record<string, unknown> | null): string {
  const fromServer = readable(parsed?.message) ?? readable(parsed?.error);
  if (status >= 500) {
    // The server's own shielded text is fine; anything else (a proxy, a crash page) is not.
    const referenceId = parsed?.referenceId;
    const base = typeof referenceId === "string" && fromServer ? fromServer : GENERIC_ERROR_MESSAGE;
    return withReference(base, referenceId);
  }
  return fromServer ?? messageForStatus(status);
}

/** True for the errors fetch throws when the request never got an answer. */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { status?: number }).status !== undefined) return false;
  return error.name === "TypeError" || /network request failed|failed to fetch|load failed|network error/i.test(error.message);
}

export function networkError(): Error & { code: string } {
  return Object.assign(new Error(NETWORK_ERROR_MESSAGE), { code: "NETWORK_ERROR" });
}

/** Parse a response body the way both clients need: JSON object or null, never throwing. */
export function parseErrorBody(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
