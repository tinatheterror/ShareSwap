/**
 * Unit tests for the late-return penalty softening logic in trust-score-service.
 *
 * These tests verify the core promise made to borrowers: tapping
 * "I'll be returning late" (which sets returnDelayNotifiedAt) genuinely
 * reduces the trust-score penalty applied at confirm-return time.
 *
 * The lateTier helper is a pure function so no database is needed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { lateTier } from "./trust-score-service.js";

// ── Tier boundaries without notification ─────────────────────────────────────

test("1-2 days late → tier 1 (+5) without notification", () => {
  assert.equal(lateTier(1, false), 1);
  assert.equal(lateTier(2, false), 1);
});

test("3-6 days late → tier 2 (−20) without notification", () => {
  assert.equal(lateTier(3, false), 2);
  assert.equal(lateTier(6, false), 2);
});

test("7-13 days late → tier 3 (−40) without notification", () => {
  assert.equal(lateTier(7, false), 3);
  assert.equal(lateTier(13, false), 3);
});

test("14+ days late → tier 4 (−60) without notification", () => {
  assert.equal(lateTier(14, false), 4);
  assert.equal(lateTier(30, false), 4);
});

// ── Notification softens by one tier ─────────────────────────────────────────

test("notification: 1-2 days late stays tier 1 — cannot soften below minimum", () => {
  // Tier 1 is already the lightest; notifying doesn't push it below 1
  assert.equal(lateTier(1, true), 1);
  assert.equal(lateTier(2, true), 1);
});

test("notification: 3-6 days late softened from tier 2 to tier 1 (+5 instead of −20)", () => {
  assert.equal(lateTier(3, true), 1);
  assert.equal(lateTier(6, true), 1);
});

test("notification: 7-13 days late softened from tier 3 to tier 2 (−20 instead of −40)", () => {
  assert.equal(lateTier(7, true), 2);
  assert.equal(lateTier(13, true), 2);
});

test("notification: 14+ days late softened from tier 4 to tier 3 (−40 instead of −60)", () => {
  assert.equal(lateTier(14, true), 3);
  assert.equal(lateTier(30, true), 3);
});

// ── Notified always scores better than unnotified ────────────────────────────

test("notified late return always scores better (lower tier) than unnotified for same days late", () => {
  const daySamples = [3, 5, 7, 10, 14, 21];
  for (const days of daySamples) {
    const withNotify    = lateTier(days, true);
    const withoutNotify = lateTier(days, false);
    assert.ok(
      withNotify <= withoutNotify,
      `${days} days late: notified tier (${withNotify}) should be ≤ unnotified tier (${withoutNotify})`,
    );
  }
});

test("for days late > 2, notified tier is strictly less than unnotified tier", () => {
  // Only days > 2 can be softened (tier >= 2); 1-2 day returns are already at tier 1
  const daySamples = [3, 6, 7, 13, 14, 28];
  for (const days of daySamples) {
    const withNotify    = lateTier(days, true);
    const withoutNotify = lateTier(days, false);
    assert.ok(
      withNotify < withoutNotify,
      `${days} days late: notified tier (${withNotify}) should be strictly < unnotified tier (${withoutNotify})`,
    );
  }
});
