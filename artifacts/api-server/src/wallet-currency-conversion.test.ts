import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, notifications, pool, rentalPayouts, users, walletTransactions } from "@workspace/db";
import { applyUserConversion, planCurrencyConversion, rateForCharge, type StripeRates } from "./wallet-currency-conversion.js";
import { recordWalletEntry, rentalEarningKey } from "./wallet-ledger.js";

const unique = `wallet-conversion-${Date.now()}`;
let ownerId: number;
let borrowerId: number;
let itemId: number;
const requestIds: number[] = [];
const userIds: number[] = [];

function fakeStripe(rates: Record<string, any>): StripeRates & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    paymentIntents: {
      retrieve: async (id: string) => {
        calls.push(id);
        if (!(id in rates)) throw new Error(`No such payment_intent: '${id}'`);
        return rates[id];
      },
    },
  };
}
const converted = (rate: number | null, opts: { settleCurrency?: string; amount?: number } = {}) => ({
  currency: "usd",
  latest_charge: {
    currency: "usd", amount: opts.amount ?? 6000,
    balance_transaction: { currency: opts.settleCurrency ?? "cad", amount: Math.round((opts.amount ?? 6000) * (rate ?? 1.3)), exchange_rate: rate },
  },
});

async function legacyUser(name: string, credits: Array<{ net: string; pi: string }>) {
  const [user] = await db.insert(users).values({ username: `${unique}-${name}` }).returning();
  userIds.push(user.id);
  let total = 0;
  for (const credit of credits) {
    const [request] = await db.insert(itemRequests).values({ itemId, requesterId: borrowerId, requestType: "RENT", status: "COMPLETED", paymentCurrency: "usd" } as any).returning({ id: itemRequests.id });
    requestIds.push(request.id);
    const [payout] = await db.insert(rentalPayouts).values({
      userId: user.id, requestId: request.id, amount: credit.net, rentalAmount: credit.net, netAmount: credit.net, status: "released", stripePaymentIntentId: credit.pi,
    }).returning();
    await recordWalletEntry(db, {
      userId: user.id, kind: "rental_payout", amountCents: Math.round(Number(credit.net) * 100), currency: "usd", requestId: request.id, rentalPayoutId: payout.id,
      idempotencyKey: rentalEarningKey(payout.id),
    });
    total += Number(credit.net);
  }
  await db.update(users).set({ rentalBalance: total.toFixed(2) }).where(eq(users.id, user.id));
  return user.id;
}
const balanceCents = async (id: number) => Math.round(Number((await db.select({ b: users.rentalBalance }).from(users).where(eq(users.id, id)))[0].b) * 100);
const ledgerSum = async (id: number) => (await db.select().from(walletTransactions).where(eq(walletTransactions.userId, id))).reduce((t, r) => t + r.amountCents, 0);

before(async () => {
  const inserted = await db.insert(users).values([{ username: `${unique}-lender` }, { username: `${unique}-borrower` }]).returning();
  ownerId = inserted[0].id;
  borrowerId = inserted[1].id;
  userIds.push(ownerId, borrowerId);
  const [item] = await db.insert(items).values({ ownerId, name: `${unique}-item`, description: "conversion test", conditionRating: 5, photos: [], shareCoinsReward: "0" }).returning();
  itemId = item.id;
});

after(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, userIds));
  await db.delete(walletTransactions).where(inArray(walletTransactions.userId, userIds));
  await db.delete(rentalPayouts).where(inArray(rentalPayouts.userId, userIds));
  if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  await db.delete(items).where(eq(items.id, itemId));
  await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

test("rateForCharge uses the balance transaction's exchange rate, and says why when there is none", async () => {
  assert.deepEqual(await rateForCharge(fakeStripe({ pi_a: converted(1.35) }), "pi_a"), { rate: 1.35 });
  assert.deepEqual(await rateForCharge(fakeStripe({ pi_b: converted(null, { amount: 1000 }) }), "pi_b"), { rate: 1.3 }, "falls back to settled amount / charged amount");
  assert.match((await rateForCharge(fakeStripe({}), "simulated-123") as any).reason, /simulated/);
  assert.match((await rateForCharge(fakeStripe({}), "pi_missing") as any).reason, /could not retrieve/);
  assert.match((await rateForCharge(fakeStripe({ pi_c: converted(1.2, { settleCurrency: "usd" }) }), "pi_c") as any).reason, /did not convert/);
});

test("the plan shows before and after, applies once in one transaction, keeps the ledger equal to the balance, and notifies the owner", async () => {
  const id = await legacyUser("ok", [{ net: "60.00", pi: `pi_${unique}_a` }, { net: "40.00", pi: `pi_${unique}_b` }]);
  const stripe = fakeStripe({ [`pi_${unique}_a`]: converted(1.35), [`pi_${unique}_b`]: converted(1.4, { amount: 4000 }) });
  const plan = (await planCurrencyConversion(stripe)).find(p => p.userId === id)!;
  assert.equal(plan.beforeCents, 10_000);
  assert.equal(plan.afterCents, 8100 + 5600);
  assert.deepEqual(plan.conversions.map(c => [c.fromCents, c.rate, c.toCents]), [[6000, 1.35, 8100], [4000, 1.4, 5600]]);
  assert.equal(await balanceCents(id), 10_000, "planning changes nothing");

  assert.equal(await applyUserConversion(plan), true);
  assert.equal(await balanceCents(id), 13_700);
  assert.equal(await ledgerSum(id), 13_700, "the ledger still explains the balance");
  const rows = (await db.select().from(walletTransactions).where(eq(walletTransactions.userId, id))).filter(r => r.kind === "currency_conversion");
  assert.deepEqual(rows.map(r => [r.amountCents, r.currency]).sort(), [[-4000, "usd"], [-6000, "usd"], [5600, "cad"], [8100, "cad"]].sort());
  const [note] = await db.select().from(notifications).where(eq(notifications.userId, id));
  assert.equal(note.type, "wallet_currency_conversion");
  assert.match(note.message, /\$100\.00 USD .* converted to \$137\.00 CAD/);

  assert.equal(await applyUserConversion(plan), false, "the same plan cannot be applied twice");
  assert.equal(await balanceCents(id), 13_700);
  assert.equal((await planCurrencyConversion(stripe)).filter(p => p.userId === id).length, 0, "nothing left to convert");
});

test("a credit with no Stripe rate is listed and left alone, and the others still convert", async () => {
  const id = await legacyUser("sim", [{ net: "5.00", pi: "simulated-1776452725813" }, { net: "10.00", pi: `pi_${unique}_c` }]);
  const plan = (await planCurrencyConversion(fakeStripe({ [`pi_${unique}_c`]: converted(1.3, { amount: 1000 }) }))).find(p => p.userId === id)!;
  assert.equal(plan.skipped.length, 1);
  assert.match(plan.skipped[0].reason, /simulated/);
  assert.equal(plan.afterCents, 500 + 1300);
  assert.equal(await applyUserConversion(plan), true);
  assert.equal(await balanceCents(id), 1800);
  assert.equal(await ledgerSum(id), 1800);
});

test("a user whose balance the ledger does not explain, or who has withdrawn, is refused and nothing changes", async () => {
  const drifted = await legacyUser("drift", [{ net: "20.00", pi: `pi_${unique}_d` }]);
  await db.update(users).set({ rentalBalance: "25.00" }).where(eq(users.id, drifted));
  const stripe = fakeStripe({ [`pi_${unique}_d`]: converted(1.3, { amount: 2000 }) });
  const plan = (await planCurrencyConversion(stripe)).find(p => p.userId === drifted)!;
  assert.match(plan.refused!, /ledger does not explain/);
  assert.equal(await applyUserConversion(plan), false);
  assert.equal(await balanceCents(drifted), 2500);

  const withdrawn = await legacyUser("withdrawn", [{ net: "50.00", pi: `pi_${unique}_f` }]);
  await recordWalletEntry(db, { userId: withdrawn, kind: "withdrawal", amountCents: -2000, currency: "cad", idempotencyKey: `${unique}-withdrawal` });
  await db.update(users).set({ rentalBalance: "30.00" }).where(eq(users.id, withdrawn));
  const second = (await planCurrencyConversion(fakeStripe({ [`pi_${unique}_f`]: converted(1.3, { amount: 5000 }) }))).find(p => p.userId === withdrawn)!;
  assert.match(second.refused!, /has withdrawn/);
  assert.equal(await applyUserConversion(second), false);
  assert.equal(await balanceCents(withdrawn), 3000);
});

test("if the balance moves between the plan and the apply, nothing is converted", async () => {
  const id = await legacyUser("race", [{ net: "30.00", pi: `pi_${unique}_e` }]);
  const plan = (await planCurrencyConversion(fakeStripe({ [`pi_${unique}_e`]: converted(1.3, { amount: 3000 }) }))).find(p => p.userId === id)!;
  await db.update(users).set({ rentalBalance: "10.00" }).where(eq(users.id, id));
  assert.equal(await applyUserConversion(plan), false);
  assert.equal(await balanceCents(id), 1000);
  assert.equal((await db.select().from(walletTransactions).where(eq(walletTransactions.userId, id))).filter(r => r.kind === "currency_conversion").length, 0);
});
