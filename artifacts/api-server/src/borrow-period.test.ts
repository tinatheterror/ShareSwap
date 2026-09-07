import assert from "node:assert/strict";
import test from "node:test";
import { validateBorrowPeriod } from "./borrow-period";

test("accepts a borrow ending exactly 12 calendar months after it starts", () => {
  assert.equal(validateBorrowPeriod("2026-09-06", "2027-09-06").valid, true);
});

test("rejects a borrow longer than 12 calendar months", () => {
  const result = validateBorrowPeriod("2026-09-06", "2027-09-07");
  assert.deepEqual(result.valid, false);
  if (!result.valid) assert.equal(result.code, "BORROW_PERIOD_TOO_LONG");
});

test("handles leap-day boundaries as calendar months", () => {
  assert.equal(validateBorrowPeriod("2024-02-29", "2025-03-01").valid, true);
  const result = validateBorrowPeriod("2024-02-29", "2025-03-02");
  assert.equal(result.valid, false);
});

test("rejects reversed and malformed dates", () => {
  assert.equal(validateBorrowPeriod("2026-09-07", "2026-09-06").valid, false);
  assert.equal(validateBorrowPeriod("not-a-date", "2026-09-06").valid, false);
});