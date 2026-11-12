import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyStripeLinks } from "./demo-reviewer-account";

const links = { customerId: "cus_1", paymentMethodId: "pm_1", subscriptionId: "sub_1" };
const year = new Date().getFullYear() + 2;
function fake(over: { pmCustomer?: string; status?: string; tier?: string; deflt?: string; subCustomer?: string } = {}) {
  return {
    customers: { retrieve: async () => ({ id: "cus_1", invoice_settings: { default_payment_method: over.deflt ?? "pm_1" } }) },
    paymentMethods: { retrieve: async () => ({ id: "pm_1", customer: over.pmCustomer ?? "cus_1", card: { last4: "4242", brand: "visa", exp_month: 1, exp_year: year } }) },
    subscriptions: { retrieve: async () => ({ id: "sub_1", customer: over.subCustomer ?? "cus_1", status: over.status ?? "active", items: { data: [{ price: { product: { metadata: { tier: over.tier ?? "member" } } } }] } }) },
  } as never;
}

test("accepts a card and an active Member subscription that belong to the customer, and copies the card from Stripe", async () => {
  const r = await verifyStripeLinks(fake(), links);
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.value.card.paymentMethodLast4, "4242"); assert.equal(r.value.subscriptionStatus, "active"); }
});

test("refuses anything the app would undo on first view", async () => {
  for (const [name, over, text] of [
    ["card on another customer", { pmCustomer: "cus_other" }, "not attached"],
    ["canceled subscription", { status: "canceled" }, "not active"],
    ["Pro subscription", { tier: "pro" }, "not on the Member plan"],
    ["different default card", { deflt: "pm_2" }, "default payment method"],
    ["subscription of another customer", { subCustomer: "cus_other" }, "belongs to"],
  ] as const) {
    const r = await verifyStripeLinks(fake(over), links);
    assert.ok(!r.ok && r.problems.some((p) => p.includes(text)), name);
  }
  const missing = await verifyStripeLinks(fake(), {});
  assert.ok(!missing.ok && missing.problems.length === 3);
});
