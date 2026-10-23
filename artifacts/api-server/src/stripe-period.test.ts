import assert from "node:assert/strict";
import { test } from "node:test";
import { periodEndIso, stripeErrorDetails, subscriptionPeriod } from "./stripe-period";

test("the period comes from the subscription items (basil and later)", () => {
  const sub = { items: { data: [{ current_period_start: 1000, current_period_end: 2000 }] } } as any;
  assert.deepEqual(subscriptionPeriod(sub), { start: 1000, end: 2000 });
  assert.equal(periodEndIso(sub), new Date(2000 * 1000).toISOString());
});

test("the item values win over a stale subscription-level field; the subscription-level field is only a fallback", () => {
  assert.equal(subscriptionPeriod({ current_period_end: 9999, items: { data: [{ current_period_end: 2000 }] } } as any).end, 2000);
  assert.deepEqual(subscriptionPeriod({ current_period_start: 5, current_period_end: 9, items: { data: [{}] } } as any), { start: 5, end: 9 });
});

test("with several items the period that ends first is used; nothing at all is null", () => {
  assert.equal(subscriptionPeriod({ items: { data: [{ current_period_end: 3000 }, { current_period_end: 2000 }] } } as any).end, 2000);
  assert.deepEqual(subscriptionPeriod({ items: { data: [] } } as any), { start: null, end: null });
  assert.equal(periodEndIso({ items: { data: [] } } as any), null);
});

test("stripeErrorDetails names type, code, param and message", () => {
  const e = Object.assign(new Error("No such price"), { type: "StripeInvalidRequestError", code: "resource_missing", param: "items[0][price]" });
  assert.equal(stripeErrorDetails(e), "type=StripeInvalidRequestError code=resource_missing param=items[0][price] message=No such price");
  assert.equal(stripeErrorDetails(new Error("boom")), "type=unknown code=none message=boom");
});
