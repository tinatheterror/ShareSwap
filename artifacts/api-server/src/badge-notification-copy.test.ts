import assert from "node:assert/strict";
import test from "node:test";
import { compactNotificationCopy, notificationCopyLimits } from "./notification-copy";

const description = "Completed 20 exchanges — an exchange veteran neighbours rely on.";

test("the actual notification API compactor preserves legacy badge reward text before truncation", () => {
  const notification = {
    id: 123, userId: 456, type: "badge_earned",
    title: "🏅 Badge Unlocked: Rising Star",
    message: `${description} +1 ShareCoin awarded!`,
  };
  const result = compactNotificationCopy(notification);
  assert.ok(result.message.startsWith("+1 ShareCoin earned."));
  assert.ok(result.message.includes("Completed 20 exchanges"));
  assert.equal(result.message, "+1 ShareCoin earned. Completed 20 exchanges.");
  assert.ok(result.message.length <= notificationCopyLimits.body);
  assert.equal(result.title, notification.title);
  assert.equal(result.id, notification.id);
  assert.equal(result.userId, notification.userId);
});

test("new badge reward prefixes remain visible and compacting twice does not duplicate credits", () => {
  const result = compactNotificationCopy({
    type: "badge_earned", title: "🏅 Badge Unlocked: Rising Star",
    message: `+1 ShareCoin earned. ${description}`,
  });
  assert.ok(result.message.startsWith("+1 ShareCoin earned."));
  assert.ok(result.message.length <= notificationCopyLimits.body);
  assert.equal(compactNotificationCopy(result).message, result.message);
  assert.equal(result.message.match(/\+1 ShareCoin earned\./g)?.length, 1);
});

test("badge push payloads without a type preserve their explicit reward", () => {
  const result = compactNotificationCopy({
    title: "🏅 Badge Unlocked: Rising Star",
    message: `${description} +1 ShareCoin awarded!`,
  });
  assert.ok(result.message.startsWith("+1 ShareCoin earned."));
});

test("an old badge without explicit credit text does not claim a new reward", () => {
  const result = compactNotificationCopy({
    type: "badge_earned", title: "🏅 Badge Unlocked: Rising Star", message: description,
  });
  assert.ok(!result.message.includes("+1"));
  assert.ok(!result.message.includes("ShareCoin"));
});

test("ordinary notification wording is not reordered as a badge reward", () => {
  const result = compactNotificationCopy({
    type: "sharecoin_earned", title: "Bonus", message: "Great work! +1 ShareCoin awarded!",
  });
  assert.equal(result.message, "Great work! +1 ShareCoin awarded!");
});