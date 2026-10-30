import assert from "node:assert/strict";
import { test } from "node:test";
import { createConnectDeleter, createStripeCleanup, type StripeCleanupClient } from "./stripe-cleanup.js";

// Only fake clients here: nothing in this file can reach Stripe, live or test.

const target = { userId: 1, customerId: "cus_x", subscriptionId: "sub_x", connectedAccountId: "acct_x" };
const missing = Object.assign(new Error("No such object"), { code: "resource_missing" });

function fake(failures: Partial<Record<"sub" | "cus" | "acct", Error>> = {}) {
  const calls: string[] = [];
  const client: StripeCleanupClient = {
    subscriptions: { cancel: async (id) => { calls.push(`sub:${id}`); if (failures.sub) throw failures.sub; } },
    customers: { del: async (id) => { calls.push(`cus:${id}`); if (failures.cus) throw failures.cus; } },
    accounts: { del: async (id) => { calls.push(`acct:${id}`); if (failures.acct) throw failures.acct; } },
  };
  return { calls, client };
}

test("it ends the subscription, then the Customer, then the Connect account", async () => {
  const { calls, client } = fake();
  await createStripeCleanup(() => client)(target);
  assert.deepEqual(calls, ["sub:sub_x", "cus:cus_x", "acct:acct_x"]);
});

test("an account with nothing on Stripe never asks for a client", async () => {
  let asked = false;
  await createStripeCleanup(() => { asked = true; throw new Error("no client"); })({ userId: 1, customerId: null, subscriptionId: null, connectedAccountId: null });
  assert.equal(asked, false);
});

test("things Stripe no longer has count as done, so it can be repeated", async () => {
  const { calls, client } = fake({ sub: missing, cus: missing, acct: missing });
  const cleanup = createStripeCleanup(() => client);
  await cleanup(target);
  await cleanup(target);
  assert.equal(calls.length, 6);
});

test("a failure on the subscription or the Customer stops the deletion", async () => {
  for (const failure of [{ sub: new Error("stripe down") }, { cus: new Error("stripe down") }]) {
    const { calls, client } = fake(failure);
    await assert.rejects(createStripeCleanup(() => client)(target), /stripe down/);
    assert.ok(!calls.includes("acct:acct_x"), "later steps wait for the retry");
  }
});

test("a Connect account Stripe will not delete is reported with its reason and does not stop the deletion", async () => {
  const logged: string[] = [];
  const { client } = fake({ acct: new Error("account still has a balance") });
  const result = await createStripeCleanup(() => client, (line) => void logged.push(line))(target);
  assert.deepEqual(result, { connectRefused: "account still has a balance" });
  assert.equal(logged.length, 1);
  assert.match(logged[0], /acct_x/);
});

test("the retry deleter treats an account Stripe no longer has as done, and throws on a refusal", async () => {
  await createConnectDeleter(() => fake({ acct: missing }).client)("acct_x");
  await assert.rejects(createConnectDeleter(() => fake({ acct: new Error("still has a balance") }).client)("acct_x"), /still has a balance/);
});
