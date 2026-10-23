/**
 * The rental deposit hold and the refundable deposit confirmation check the stored card against Stripe before
 * their database transactions start. A card Stripe no longer has is cleared and answered with CARD_STALE;
 * a good card, no card, or a check that cannot run leaves the flow to carry on as before.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool, db } from "@workspace/db";
import { users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createRentalPaymentHold, confirmRefundableDeposit } from "./routes/routes.js";

const UNIQUE = `stalecard-${Date.now()}`;
const created: number[] = [];

const gone = Object.assign(new Error("No such PaymentMethod"), { statusCode: 404, code: "resource_missing" });

function fakeStripe(pm: unknown) {
  return {
    customers: { retrieve: async (id: string) => ({ id, invoice_settings: { default_payment_method: null } }) },
    paymentMethods: {
      retrieve: async () => {
        if (!pm) throw gone;
        return pm;
      },
    },
  } as any;
}

async function userWithCard(withCard: boolean) {
  const [u] = await db
    .insert(users)
    .values({
      username: `${UNIQUE}-${created.length}`,
      stripeCustomerId: "cus_stale_test",
      ...(withCard && {
        stripePaymentMethodId: "pm_stale_test",
        paymentMethodLast4: "4242",
        paymentMethodBrand: "visa",
        paymentMethodExpMonth: 12,
        paymentMethodExpYear: 2030,
        isVerified: true,
      }),
    } as any)
    .returning({ id: users.id });
  created.push(u.id);
  return u.id;
}

const cardRow = async (id: number) =>
  (await db.select({ pm: users.stripePaymentMethodId, last4: users.paymentMethodLast4, verified: users.isVerified }).from(users).where(eq(users.id, id)))[0];

const flows = [
  ["createRentalPaymentHold", (userId: number, stripeClient: any) => createRentalPaymentHold({ requestId: 987654321, userId, stripeClient })],
  ["confirmRefundableDeposit", (userId: number, stripeClient: any) => confirmRefundableDeposit({ requestId: 987654321, userId, stripeClient })],
] as const;

for (const [name, run] of flows) {
  test(`${name}: a stale card is cleared and answered with CARD_STALE before anything else runs`, async () => {
    const id = await userWithCard(true);
    const r = await run(id, fakeStripe(null));
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "CARD_STALE");
    assert.equal(r.body.error, "Please re-add your card");
    assert.deepEqual(await cardRow(id), { pm: null, last4: null, verified: false });
  });

  test(`${name}: a card attached to another customer is stale too`, async () => {
    const id = await userWithCard(true);
    const r = await run(id, fakeStripe({ id: "pm_stale_test", customer: "cus_someone_else", card: { last4: "4242", brand: "visa", exp_month: 12, exp_year: 2030 } }));
    assert.equal(r.body.code, "CARD_STALE");
    assert.equal((await cardRow(id)).pm, null);
  });

  test(`${name}: a good card passes the check and the flow carries on (the missing request is rejected later)`, async () => {
    const id = await userWithCard(true);
    const r = await run(id, fakeStripe({ id: "pm_stale_test", customer: "cus_stale_test", card: { last4: "4242", brand: "visa", exp_month: 12, exp_year: 2030 } }));
    assert.notEqual(r.body.code, "CARD_STALE");
    assert.ok([403, 404].includes(r.status), `request lookup should fail, got ${r.status}`);
    assert.equal((await cardRow(id)).pm, "pm_stale_test");
  });

  test(`${name}: no saved card is not stale, and an unreachable Stripe does not block or clear`, async () => {
    const none = await userWithCard(false);
    assert.notEqual((await run(none, fakeStripe(null))).body.code, "CARD_STALE");
    const id = await userWithCard(true);
    const outage = { customers: { retrieve: async () => { throw Object.assign(new Error("connection reset"), { statusCode: 500 }); } }, paymentMethods: {} } as any;
    assert.notEqual((await run(id, outage)).body.code, "CARD_STALE");
    assert.equal((await cardRow(id)).pm, "pm_stale_test");
  });
}

after(async () => {
  for (const id of created) await db.delete(users).where(eq(users.id, id));
  await pool.end();
});
