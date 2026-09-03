import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { processExpiringDepositHolds, renewDepositHold } from "./deposit-renewal-service.js";

test("renewal compatibility APIs are inert and never contact Stripe", async () => {
  let stripeCalls = 0;
  const stripe = {
    paymentIntents: {
      retrieve: async () => { stripeCalls++; throw new Error("must not be called"); },
      create: async () => { stripeCalls++; throw new Error("must not be called"); },
      cancel: async () => { stripeCalls++; throw new Error("must not be called"); },
    },
  };
  const result = await renewDepositHold({ requestId: 99, stripeClient: stripe as any });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /disabled/i);
  assert.equal(stripeCalls, 0);

  const sweep = await processExpiringDepositHolds({ stripeClient: stripe as any });
  assert.deepEqual(sweep, { checked: 0, renewed: 0, failed: 0, results: [] });
  assert.equal(stripeCalls, 0);
});

test("routes expose consent-only fallback and no renter renewal route or renewal sweep", async () => {
  const source = await readFile(new URL("./routes/routes.ts", import.meta.url), "utf8");
  assert.match(source, /confirm-refundable-deposit/);
  assert.match(source, /consentRequired: true/);
  assert.match(source, /authorization_window_insufficient/);
  assert.doesNotMatch(source, /\/api\/requests\/:requestId\/renew-deposit/);
  assert.doesNotMatch(source, /processExpiringDepositHolds\(\{ stripeClient: stripe \}\)/);
});