// What the server's redirect back into the app means after Sign in with Apple ran in the browser (Android).

export type AppleRedirectResult =
  | { kind: "token"; token: string }
  | { kind: "reactivate"; token: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const APPLE_REDIRECT_MESSAGES: Record<string, string> = {
  failed: "Apple sign-in could not be completed. Please try again.",
  refused: "This account cannot be used on ShareSwap.",
  unavailable: "Sign in with Apple is not available right now.",
};

/** What the server's redirect back into the app means: ?token=, ?reactivate=1&token=, or ?apple=<reason>. */
export function parseAppleRedirect(url: string): AppleRedirectResult {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "";
  const params = new URLSearchParams(query);
  const reason = params.get("apple");
  if (reason === "cancelled") return { kind: "cancelled" };
  if (reason) return { kind: "error", message: APPLE_REDIRECT_MESSAGES[reason] ?? APPLE_REDIRECT_MESSAGES.failed };
  const token = params.get("token");
  if (!token) return { kind: "error", message: "Unable to verify your sign-in. Please try again." };
  return params.get("reactivate") === "1" ? { kind: "reactivate", token } : { kind: "token", token };
}
