import assert from "node:assert/strict";
import test from "node:test";
import { compactNotificationCopy, notificationCopyLimits } from "./notification-copy";

test("serious overdue owner copy fits the mobile notification card", () => {
  const copy = compactNotificationCopy({
    title: "Serious overdue: 101d",
    message: '"Brown Suede Clogs" is seriously overdue with Tina L.. Please coordinate an immediate return.',
  });

  assert.equal(copy.title, "Serious overdue: 101d - Get Your Item Back");
  assert.equal(copy.message, '"Brown Suede Clogs" with Tina L. Arrange return.');
  assert.ok(copy.message.length <= notificationCopyLimits.body);
  assert.doesNotMatch(copy.message, /…|\.\.\./);
});

test("dynamic notification copy is shortened at a word boundary without ellipsis", () => {
  const copy = compactNotificationCopy({
    title: "Deposit authorization needs attention",
    message: "A very long dynamic notification body that cannot fit inside the compact mobile notification card without truncation.",
  });

  assert.ok(copy.title.length <= notificationCopyLimits.title);
  assert.ok(copy.message.length <= notificationCopyLimits.body);
  assert.doesNotMatch(`${copy.title}${copy.message}`, /…|\.\.\./);
});

test("renames existing trust score notifications", () => {
  const copy = compactNotificationCopy({
    title: "Trust score already updated",
    message: "The serious overdue penalty was already applied.",
  });

  assert.equal(copy.title, "Trust score update");
});

test("combined return notice preserves deposit release even with a long item name", () => {
  for (const name of ["Hermes scarf", "Camping stove", "A very long item name that must be shortened"]) {
    const copy = compactNotificationCopy({
      title: "Return Confirmed",
      message: `"${name}" returned to owner. Deposit hold lifted.`,
    });
    assert.equal(copy.title, "Return Confirmed");
    assert.match(copy.message, /returned\. Deposit hold lifted\.$/);
    assert.ok(copy.message.length <= notificationCopyLimits.body);
  }
});

test("in-person return notice does not gain a deposit release claim", () => {
  const copy = compactNotificationCopy({
    title: "Return Confirmed",
    message: '"Camping stove" returned to owner.',
  });
  assert.equal(copy.message, '"Camping stove" returned to owner.');
});

test("renames existing overdue notifications by recipient role", () => {
  assert.equal(
    compactNotificationCopy({
      title: "Return overdue",
      message: '"Jeans" is overdue. Arrange return or request an extension.',
    }).title,
    "Overdue - Return Item to Owner",
  );
  assert.equal(
    compactNotificationCopy({
      title: "Return overdue",
      message: '"Jeans" remains overdue.',
    }).title,
    "Overdue - Get Your Item Back",
  );
  assert.equal(
    compactNotificationCopy({
      title: "Return overdue by 9d",
      message: '"Jeans" is 9 days overdue with Tina. Please arrange its return.',
    }).title,
    "9d Overdue - Get Your Item Back",
  );
  assert.equal(
    compactNotificationCopy({
      title: "Serious overdue: 15d",
      message: '"Jeans" is seriously overdue. Return it to Sam immediately.',
    }).title,
    "Serious overdue: 15d - Return to Owner",
  );
});