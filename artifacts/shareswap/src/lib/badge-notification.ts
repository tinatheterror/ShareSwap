/** Keep an explicitly recorded badge reward visible before compact text is clipped. */
export function badgeNotificationMessage(notification: { type: string; message: string }): string {
  if (notification.type !== "badge_earned") return notification.message;
  const reward = /(?:^|\s)\+1\s+ShareCoin\s+(?:awarded!|earned[.!]?)(?=\s|$)/i;
  if (!reward.test(notification.message)) return notification.message;
  const description = notification.message.replace(reward, " ").trim();
  return `+1 ShareCoin earned.${description ? ` ${description}` : ""}`;
}