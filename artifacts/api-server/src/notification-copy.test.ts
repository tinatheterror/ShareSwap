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
      message: `"${name}" returned to owner. Temporary hold released.`,
    });
    assert.equal(copy.title, "Return Confirmed");
    assert.match(copy.message, /returned\. Hold released\.$/);
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

test("pending return copy keeps both the release and pending state visible", () => {
  for (const name of ["Camping stove", "A very long item name that must be shortened"]) {
    const copy = compactNotificationCopy({
      title: "Deposit hold released",
      message: `"${name}" — temporary hold released; return confirmation is pending while we finish updating your request.`,
    });
    assert.match(copy.message, /Hold released\. Return pending:/);
    assert.ok(copy.message.length <= notificationCopyLimits.body);
  }
});

test("partially released return copy does not imply the entire deposit was released", () => {
  const copy = compactNotificationCopy({
    title: "Deposit Release Pending",
    message: '"A very long item name that must be shortened" — part of the temporary hold was released; return confirmation is pending while we release the rest.',
  });
  assert.match(copy.message, /^Partial release; return pending:/);
  assert.ok(copy.message.length <= notificationCopyLimits.body);
  assert.doesNotMatch(copy.message, /Hold released/);
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
test("charge, refund and hold-release notices keep their full wording", () => {
  const body = "A $105 security deposit was charged to your card because a claim was opened for your Tineco vacuum mop. The charge will remain while the claim is reviewed and may be refunded depending on the outcome.";
  const copy = compactNotificationCopy({ type: "security_deposit_charged", title: "Security deposit charged", message: body });
  assert.equal(copy.message, body);
  assert.equal(copy.title, "Security deposit charged");
});
