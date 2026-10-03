import assert from "node:assert/strict";
import { test } from "node:test";
import { publicPaymentFailure } from "./public-payment-error.js";

test("provider diagnostics and internal keys are never returned to payment clients", () => {
  const raw = Object.assign(new Error("Keys for idempotent requests: borrow-deposit-hold-2468-4200 pi_private"), {
    type: "StripeIdempotencyError", code: "private_code",
  });
  const body = publicPaymentFailure(raw);
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.doesNotMatch(JSON.stringify(body), /idempotent|2468|pi_private|private_code/);
});

test("only recognized payment codes are exposed, with decline details preferred", () => {
  assert.equal(publicPaymentFailure({ code: "card_declined", decline_code: "insufficient_funds" }).code, "insufficient_funds");
  assert.equal(publicPaymentFailure({ code: "card_declined", decline_code: "private_reason" }).code, "card_declined");
  assert.equal(publicPaymentFailure({ code: "authentication_required" }).code, "authentication_required");
  assert.equal(publicPaymentFailure({ code: "constructor" }).code, undefined);
});

test("missing or malformed errors fail safely", () => {
  for (const error of [null, undefined, "private error", {}, { code: 42 }]) {
    assert.equal(publicPaymentFailure(error).code, undefined);
    assert.match(publicPaymentFailure(error).error, /contact support/);
  }
});