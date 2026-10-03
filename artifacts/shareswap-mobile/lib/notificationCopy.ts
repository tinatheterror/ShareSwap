const LEGACY_BADGE_COIN_REWARD = /\+1 ShareCoin awarded!\s*/i;
const BADGE_COIN_EARNED_PREFIX = "+1 ShareCoin earned.";

/**
 * Make a confirmed badge reward visible before the notification row truncates.
 * Older stored messages put the reward at the end; unknown historic badges
 * without an explicit reward disclosure are intentionally left unchanged.
 */
export function notificationDisplayMessage(type: string, message: string): string {
  if (type !== "badge_earned") return message;
  if (message.trimStart().toLowerCase().startsWith(BADGE_COIN_EARNED_PREFIX.toLowerCase())) {
    return message;
  }
  if (!LEGACY_BADGE_COIN_REWARD.test(message)) return message;

  const description = message.replace(LEGACY_BADGE_COIN_REWARD, "").trim();
  return description
    ? `${BADGE_COIN_EARNED_PREFIX} ${description}`
    : BADGE_COIN_EARNED_PREFIX;
}