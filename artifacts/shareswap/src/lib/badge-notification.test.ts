import { describe, it, expect } from "vitest";
import { badgeNotificationMessage } from "./badge-notification";

describe("badge reward notification copy", () => {
  it("puts the existing reward first so it survives compact display clipping", () => {
    expect(badgeNotificationMessage({
      type: "badge_earned",
      message: "Completed 20 exchanges — an exchange veteran. +1 ShareCoin awarded!",
    })).toBe("+1 ShareCoin earned. Completed 20 exchanges — an exchange veteran.");
  });

  it("leaves the new server copy unchanged without duplicating the reward", () => {
    const notification = { type: "badge_earned", message: "+1 ShareCoin earned. Completed 20 exchanges." };
    expect(badgeNotificationMessage(notification)).toBe(notification.message);
  });

  it("does not invent a credit for an old badge message without a reward", () => {
    const notification = { type: "badge_earned", message: "Completed 20 exchanges." };
    expect(badgeNotificationMessage(notification)).toBe(notification.message);
  });

  it("does not rewrite other notification types", () => {
    const notification = { type: "sharecoin_earned", message: "Great work! +1 ShareCoin awarded!" };
    expect(badgeNotificationMessage(notification)).toBe(notification.message);
  });
});