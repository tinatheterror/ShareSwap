import assert from "node:assert/strict";
import { test } from "node:test";
import { depositHoldIdempotencyKey, prepareDepositAuthorization } from "./deposit-authorization.js";

const parameters = {
  amount: 4200, currency: "usd", capture_method: "manual" as const,
  customer: "cus_test", payment_method: "pm_test", confirm: true, off_session: true,
  metadata: { requestId: "123", userId: "456", type: "borrow_security_deposit", depositAmount: "42" },
  description: "Security deposit hold for ShareSwap request #123",
};
const keyForAttempt = (attempt: number) => `borrow-deposit-hold-123-4200${attempt ? `-attempt-${attempt}` : ""}`;

function fixture(options: {
  expandedLegacy?: boolean;
  legacyCanceled?: boolean;
  retrieveError?: Error;
  createTimeout?: boolean;
  createError?: Error;
  hasLegacy?: boolean;
} = {}) {
  const intents = new Map<string, any>();
  const keys = new Map<string, { fingerprint: string; cached: any }>();
  const calls = { create: [] as any[], retrieve: [] as any[], newIntents: [] as string[] };
  const attempts: { attemptNumber: number; paymentIntentId: string | null }[] = [];
  let timeoutOnce = !!options.createTimeout;
  let retrieveError = options.retrieveError;
  function intent(id: string) {
    return {
      id, status: "requires_capture", capture_method: "manual", amount: 4200,
      latest_charge: { id: `ch_${id}`, payment_method_details: { card: { capture_before: 2000000000 } } },
    };
  }
  function cacheResponse(pi: any, params: any) {
    return { ...pi, latest_charge: params.expand ? pi.latest_charge : pi.latest_charge.id };
  }
  if (options.hasLegacy !== false) {
    const legacy = intent("pi_legacy");
    const legacyParams = options.expandedLegacy ? { ...parameters, expand: ["latest_charge"] } : parameters;
    keys.set(keyForAttempt(0), { fingerprint: JSON.stringify(legacyParams), cached: cacheResponse(legacy, legacyParams) });
    intents.set(legacy.id, { ...legacy, status: options.legacyCanceled ? "canceled" : legacy.status });
  }
  const stripeClient = {
    paymentIntents: {
      create: async (params: any, opts: any) => {
        calls.create.push({ params, opts });
        if (options.createError) throw options.createError;
        const old = keys.get(opts.idempotencyKey);
        if (old) {
          if (old.fingerprint !== JSON.stringify(params)) {
            throw Object.assign(new Error("Idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" });
          }
          return old.cached;
        }
        const pi = intent(`pi_new_${calls.newIntents.length}`);
        calls.newIntents.push(pi.id);
        intents.set(pi.id, pi);
        const cached = cacheResponse(pi, params);
        keys.set(opts.idempotencyKey, { fingerprint: JSON.stringify(params), cached });
        if (timeoutOnce) {
          timeoutOnce = false;
          throw new Error("Stripe connection timed out after creating the intent");
        }
        return cached;
      },
      retrieve: async (id: string, params: any) => {
        calls.retrieve.push({ id, params });
        if (retrieveError) throw retrieveError;
        const pi = intents.get(id);
        if (!pi) throw new Error("Unknown intent");
        return pi;
      },
    },
  };
  const run = (saved = { attemptNumber: 0, paymentIntentId: null as string | null }) =>
    prepareDepositAuthorization({
      stripeClient: stripeClient as any, parameters, keyForAttempt, ...saved,
      onAttempt: async (attempt) => { attempts.push(attempt); },
    });
  return { run, calls, attempts, clearRetrieveError: () => { retrieveError = undefined; } };
}

test("old unexpanded idempotent attempts are replayed unchanged and their deadline is read separately", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.paymentIntent.id, "pi_legacy");
  assert.equal(result.attemptNumber, 0);
  assert.deepEqual(f.calls.create[0].params, parameters);
  assert.deepEqual(f.calls.retrieve[0].params, { expand: ["latest_charge"] });
  assert.equal(f.calls.newIntents.length, 0);
});

test("expansion-era attempts are recovered using the same key and exact earlier parameters", async () => {
  const f = fixture({ expandedLegacy: true });
  const result = await f.run();
  assert.equal(result.paymentIntent.id, "pi_legacy");
  assert.equal(f.calls.create.length, 2);
  assert.deepEqual(f.calls.create.map(call => call.opts.idempotencyKey), [keyForAttempt(0), keyForAttempt(0)]);
  assert.deepEqual(f.calls.create[1].params, { ...parameters, expand: ["latest_charge"] });
  assert.equal(f.calls.newIntents.length, 0);
  assert.equal(result.attemptNumber, 0);
});

test("a stale creation response only gets a new attempt after live Stripe confirms cancellation", async () => {
  const f = fixture({ legacyCanceled: true });
  const result = await f.run();
  assert.equal(result.attemptNumber, 1);
  assert.equal(result.paymentIntent.status, "requires_capture");
  assert.equal(f.calls.newIntents.length, 1);
  assert.equal(f.calls.retrieve[0].id, "pi_legacy");
  assert.deepEqual(f.calls.create.map(call => call.opts.idempotencyKey), [keyForAttempt(0), keyForAttempt(1)]);
  assert.deepEqual(f.attempts.find(a => a.attemptNumber === 1), { attemptNumber: 1, paymentIntentId: null });
});

test("an unknown live deadline/state does not rotate the key or create another hold", async () => {
  const f = fixture({ retrieveError: new Error("Stripe read timed out") });
  await assert.rejects(f.run(), /read timed out/);
  assert.deepEqual(f.attempts.at(-1), { attemptNumber: 0, paymentIntentId: "pi_legacy" });
  assert.equal(f.calls.newIntents.length, 0);
  f.clearRetrieveError();
  const result = await f.run(f.attempts.at(-1)!);
  assert.equal(result.paymentIntent.id, "pi_legacy");
  assert.equal(f.calls.create.length, 1, "known intent is inspected rather than recreated");
});

test("a lost creation response reuses the same idempotency key on retry", async () => {
  const f = fixture({ hasLegacy: false, createTimeout: true });
  await assert.rejects(f.run(), /connection timed out/);
  const result = await f.run(f.attempts.at(-1)!);
  assert.equal(result.attemptNumber, 0);
  assert.equal(f.calls.newIntents.length, 1);
  assert.deepEqual(f.calls.create.map(call => call.opts.idempotencyKey), [keyForAttempt(0), keyForAttempt(0)]);
});

test("card declines and other create errors do not cause a new key or parameter fallback", async () => {
  const f = fixture({ createError: Object.assign(new Error("Card declined"), { type: "StripeCardError" }) });
  await assert.rejects(f.run(), /Card declined/);
  assert.equal(f.calls.create.length, 1);
  assert.equal(f.calls.newIntents.length, 0);
  assert.equal(f.calls.retrieve.length, 0);
});
// Mirrors Stripe: a key is bound to the first create payload and rejects any different one.
function strictStripe() {
  const bound = new Map<string, { payload: string; id: string }>();
  const intents = new Map<string, any>();
  const created: string[] = [];
  const paymentIntents = {
    create: async (params: any, opts: any) => {
      const payload = JSON.stringify(params);
      const existing = bound.get(opts.idempotencyKey);
      if (existing && existing.payload !== payload) {
        throw Object.assign(
          new Error("Keys for idempotent requests can only be used with the same parameters they were first used with."),
          { type: "StripeIdempotencyError" },
        );
      }
      if (existing) return intents.get(existing.id);
      const id = `pi_${created.length}`;
      const pi = {
        id, status: "requires_capture", capture_method: "manual", amount: params.amount,
        latest_charge: { id: `ch_${id}`, payment_method_details: { card: { capture_before: 2000000000 } } },
      };
      created.push(id);
      intents.set(id, pi);
      bound.set(opts.idempotencyKey, { payload, id });
      return pi;
    },
    retrieve: async (id: string) => intents.get(id),
  };
  return { paymentIntents, created };
}

const holdKey = (params: any, attempt: number) => depositHoldIdempotencyKey("borrow-deposit-hold-123-4200", params, attempt);

test("hold idempotency key is stable for identical payloads regardless of property order", () => {
  const reordered = {
    description: parameters.description, off_session: true, confirm: true,
    metadata: { depositAmount: "42", type: "borrow_security_deposit", userId: "456", requestId: "123" },
    payment_method: "pm_test", customer: "cus_test", capture_method: "manual" as const, currency: "usd", amount: 4200,
  };
  assert.equal(holdKey(parameters, 0), holdKey(reordered, 0));
  assert.match(holdKey(parameters, 0), /^borrow-deposit-hold-123-4200-[0-9a-f]{16}$/);
  assert.equal(holdKey(parameters, 2), `${holdKey(parameters, 0)}-attempt-2`);
});

test("hold idempotency key changes when payment method, description or metadata change", () => {
  const base = holdKey(parameters, 0);
  assert.notEqual(base, holdKey({ ...parameters, payment_method: "pm_other" }, 0));
  assert.notEqual(base, holdKey({ ...parameters, description: "ShareSwap temporary deposit hold (not a charge) - request #123" }, 0));
  assert.notEqual(base, holdKey({ ...parameters, metadata: { ...parameters.metadata, userId: "789" } }, 0));
});

test("a changed payload after an earlier hold attempt gets a new key instead of a Stripe idempotency error", async () => {
  const stripe = strictStripe();
  const run = (params: any) =>
    prepareDepositAuthorization({
      stripeClient: stripe as any, parameters: params,
      keyForAttempt: (n) => holdKey(params, n),
      onAttempt: async () => {},
    });

  const first = await run(parameters);
  // Same request retried with a different card and reworded description (the reported bug).
  const changed = { ...parameters, payment_method: "pm_new_card", description: "ShareSwap temporary deposit hold (not a charge) - request #123" };
  const second = await run(changed);
  assert.notEqual(second.paymentIntent.id, first.paymentIntent.id);

  // An unchanged retry still replays the original creation rather than making another hold.
  const replay = await run(changed);
  assert.equal(replay.paymentIntent.id, second.paymentIntent.id);
  assert.equal(stripe.created.length, 2);

  // The previous static key (request + amount only) is what produced the failure.
  const staticKey = (n: number) => keyForAttempt(n);
  const legacy = strictStripe();
  const runStatic = (params: any) =>
    prepareDepositAuthorization({ stripeClient: legacy as any, parameters: params, keyForAttempt: staticKey, onAttempt: async () => {} });
  await runStatic(parameters);
  await assert.rejects(runStatic(changed), /same parameters/);
});
