const TITLE_LIMIT = 64;
const BODY_LIMIT = 54;

function shortenQuotedNames(text: string): string {
  return text.replace(/"([^"]+)"/g, (_match, name: string) => {
    const words = name.trim().split(/\s+/);
    let shortened = "";
    for (const word of words) {
      const candidate = shortened ? `${shortened} ${word}` : word;
      if (candidate.length > 18) break;
      shortened = candidate;
    }
    return `"${shortened || name.slice(0, 18).trim()}"`;
  });
}

function fitAtWord(text: string, limit: number): string {
  const clean = text
    .replace(/[.…]{2,}/g, ".")
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= limit) return clean;

  const shortenedNames = shortenQuotedNames(clean);
  if (shortenedNames.length <= limit) return shortenedNames;

  const slice = shortenedNames.slice(0, limit + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const result = (lastSpace >= Math.floor(limit * 0.65)
    ? slice.slice(0, lastSpace)
    : shortenedNames.slice(0, limit))
    .replace(/[\s,;:—–-]+$/g, "")
    .trim();
  return result.endsWith(".") || result.endsWith("!") || result.endsWith("?")
    ? result
    : `${result.slice(0, limit - 1).trimEnd()}.`;
}

function isOwnerOverdueMessage(message?: string | null): boolean {
  return !!message && (
    /\bwith .+?(?:\.|$)/i.test(message) ||
    /has not yet been returned|remains overdue/i.test(message)
  );
}

function rewriteTitle(title: string, message?: string | null): string {
  const ownerCopy = isOwnerOverdueMessage(message);
  return title
    .replace(/^Trust score already updated\.?$/, "Trust score update")
    .replace(
      /^Return overdue$/,
      ownerCopy
        ? "Overdue - Get Your Item Back"
        : "Overdue - Return Item to Owner",
    )
    .replace(
      /^Return overdue by (\d+)d$/,
      ownerCopy
        ? "$1d Overdue - Get Your Item Back"
        : "$1d Overdue - Return to Owner",
    )
    .replace(
      /^Serious overdue: (\d+)d$/,
      ownerCopy
        ? "Serious overdue: $1d - Get Your Item Back"
        : "Serious overdue: $1d - Return to Owner",
    );
}

function rewriteBody(message: string, isBadge = false): string {
  // Legacy badge messages put the confirmed coin credit after a long
  // description. Move it before fitting, or the API/push response drops it
  // before clients have a chance to preserve it.
  const badgeReward = /\+1\s+ShareCoin\s+(?:awarded!|earned[.!]?)(?=\s|$)/i;
  if (isBadge && badgeReward.test(message)) {
    const description = message.replace(badgeReward, "").trim()
      .replace(/^(Completed \d+ exchanges) — .+$/, "$1.");
    message = `+1 ShareCoin earned.${description ? ` ${description}` : ""}`;
  }
  return message
    .replace(
      /^"([^"]+)" — temporary hold released; return confirmation is pending while we finish updating your request\.$/,
      'Hold released. Return pending: "$1".',
    )
    .replace(
      /^"([^"]+)" — part of the temporary hold was released; return confirmation is pending while we release the rest\.$/,
      'Partial release; return pending: "$1".',
    )
    .replace(
      /^"([^"]+)" returned to owner\. Temporary hold released\.$/,
      '"$1" returned. Hold released.',
    )
    .replace(
      /^"([^"]+)" returned to owner\. Refundable deposit refunded\.$/,
      '"$1" returned. Deposit refunded.',
    )
    .replace(
      /^"([^"]+)" is seriously overdue with (.+?)\. Please coordinate an immediate return\.$/,
      '"$1" with $2. Arrange return.',
    )
    .replace(
      /^"([^"]+)" is seriously overdue\. Return it to (.+?) immediately\.$/,
      '"$1": return to $2 now.',
    )
    .replace(
      /^"([^"]+)" is (\d+) days overdue with (.+?)\. Please arrange its return\.$/,
      '"$1" is $2d overdue with $3. Arrange return.',
    )
    .replace(
      /^"([^"]+)" is (\d+) days overdue\. Return it now before starting another borrow\.$/,
      '"$1" is $2d overdue. Return it now.',
    )
    .replace(
      /^Authorization hold for "([^"]+)" has been removed — nothing was charged\.$/,
      'Hold removed for "$1". Nothing charged.',
    )
    .replace(
      /^You earned (\d+) ShareCoins? for completing identity verification\.$/,
      '+$1 ShareCoins for ID verification.',
    )
    .replace(
      /^You earned (\d+) ShareCoins? for completing your first transaction as a referred member\. Happy sharing!$/,
      '+$1 ShareCoins for your first transaction.',
    )
    .replace(
      /^The owner reported an issue\. You can respond before it is reviewed\.$/,
      "Owner reported an issue. Respond before review.",
    )
    .replace(
      /^Handoff disagreement on "([^"]+)"\. Submit proof within 24 hours\.$/,
      'Handoff dispute: "$1". Send proof in 24h.',
    );
}

/**
 * Deposit charge/refund/hold-release notices carry amounts and the
 * "not charged" / "charged" distinction. Compacting them would drop exactly
 * that wording, so their bodies are delivered in full.
 */
const FULL_BODY_TYPES = new Set([
  "security_deposit_charged", "security_claim_opened_owner", "security_claim_opened",
  "security_deposit_refunded", "security_deposit_retained", "security_claim_rejected",
  "deposit_hold_released", "deposit_unsecured", "deposit_renewal_failed",
]);

export function compactNotificationCopy<T extends { title?: string | null; message?: string | null; type?: string | null }>(
  notification: T,
): T {
  return {
    ...notification,
    title: notification.title
      ? fitAtWord(rewriteTitle(notification.title, notification.message), TITLE_LIMIT)
      : notification.title,
    message: notification.message && notification.type && FULL_BODY_TYPES.has(notification.type)
      ? notification.message
      : notification.message
      ? fitAtWord(rewriteBody(
          notification.message,
          notification.type === "badge_earned" || /\bBadge Unlocked:/i.test(notification.title ?? ""),
        ), BODY_LIMIT)
      : notification.message,
  };
}

export const notificationCopyLimits = {
  title: TITLE_LIMIT,
  body: BODY_LIMIT,
} as const;