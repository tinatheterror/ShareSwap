import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAuthoritativeBorrowDeposit } from "./routes/routes.js";
import { trustDepositDiscountPercent } from "./trust-deposit-discount.js";

test("the discount follows the trust level, at each boundary", () => {
  const cases: [number, number][] = [
    [0, 0], [49, 0],
    [50, 10], [149, 10],
    [150, 20], [299, 20],
    [300, 40], [499, 40],
    [500, 60], [900, 60],
  ];
  for (const [score, percent] of cases) assert.equal(trustDepositDiscountPercent(score), percent, `score ${score}`);
  assert.equal(trustDepositDiscountPercent(null), 0);
  assert.equal(trustDepositDiscountPercent(undefined), 0);
});

test("the borrow deposit applies the level discount to the tier's base amount", () => {
  const dress = { tier: 3, originalValue: "$300–$1,000" }; // $650 midpoint at 30% = $195 base
  assert.deepEqual(computeAuthoritativeBorrowDeposit(dress, 0), { amount: 195, base: 195, discount: 0, trust: 0 });
  assert.deepEqual(computeAuthoritativeBorrowDeposit(dress, 60), { amount: 176, base: 195, discount: 10, trust: 60 });
  assert.deepEqual(computeAuthoritativeBorrowDeposit(dress, 200), { amount: 156, base: 195, discount: 20, trust: 200 });
  assert.deepEqual(computeAuthoritativeBorrowDeposit(dress, 350), { amount: 117, base: 195, discount: 40, trust: 350 });
  assert.deepEqual(computeAuthoritativeBorrowDeposit(dress, 500), { amount: 78, base: 195, discount: 60, trust: 500 });
});

test("a $5 deposit is never discounted, and the floor never reports a discount that did not happen", () => {
  assert.deepEqual(computeAuthoritativeBorrowDeposit({ tier: 1, originalValue: "Under $50" }, 500), { amount: 5, base: 5, discount: 0, trust: 500 });
  // $8 base at 40% would be $4.80: the floor holds it at $5 and reports no discount.
  const item = { tier: 1, replacementValue: 80 }; // 10% of $80 = $8
  assert.deepEqual(computeAuthoritativeBorrowDeposit(item, 300), { amount: 5, base: 8, discount: 0, trust: 300 });
});
