/**
 * Integration test: brute-force limits survive a server restart.
 *
 * The security guarantee of the Postgres-backed store is that hit counters are
 * durable — an attacker cannot reset their counter by crashing or restarting
 * the server.  This test verifies that guarantee end-to-end:
 *
 *   1. Exhaust the limit against store instance A (simulates the first process).
 *   2. Create a fresh store instance B (simulates a restarted process).
 *   3. Confirm the next increment via B still sees totalHits > max.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { PostgresRateLimitStore } from "./auth.js";

// ── Config ──────────────────────────────────────────────────────────────────
// Use a dedicated test prefix so this test never touches live rate-limit rows.
const TEST_PREFIX = `test-rl-persist-${Date.now()}`;
const TEST_KEY    = "127.0.0.1";
const WINDOW_MS   = 15 * 60 * 1000; // matches authLimiter
const MAX_HITS    = 5;               // matches authLimiter

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Remove all rows written by this test run. */
async function cleanup() {
  await pool.query(
    "DELETE FROM rate_limit_store WHERE key LIKE $1",
    [`${TEST_PREFIX}:%`],
  );
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

before(cleanup);
after(async () => {
  await cleanup();
  // Close the pool so Node exits cleanly after the tests finish.
  await pool.end();
});

// ── Tests ────────────────────────────────────────────────────────────────────

test("rate-limit hits persist across a simulated server restart", async () => {
  // ── Phase 1: exhaust the limit (simulates the first server process) ────────
  const storeA = new PostgresRateLimitStore(WINDOW_MS, TEST_PREFIX);
  // init() mirrors what express-rate-limit calls at middleware setup time.
  await storeA.init({} as any);

  let lastInfo = { totalHits: 0, resetTime: new Date() };
  for (let i = 0; i < MAX_HITS; i++) {
    lastInfo = await storeA.increment(TEST_KEY);
  }

  assert.equal(
    lastInfo.totalHits,
    MAX_HITS,
    `Expected ${MAX_HITS} hits after exhausting the limit, got ${lastInfo.totalHits}`,
  );

  // ── Phase 2: restart — create a completely fresh store instance ────────────
  // This is what happens when the Node.js process restarts: a brand-new Store
  // object is constructed, but the Postgres rows written by the old process
  // are still there.
  const storeB = new PostgresRateLimitStore(WINDOW_MS, TEST_PREFIX);
  await storeB.init({} as any);

  // ── Phase 3: the next attempt (what the attacker sends after restart) ──────
  const postRestartInfo = await storeB.increment(TEST_KEY);

  assert.ok(
    postRestartInfo.totalHits > MAX_HITS,
    `After restart the counter should exceed ${MAX_HITS} (got ${postRestartInfo.totalHits}).` +
    ` If this fails the counter was reset to 1, meaning limits do NOT survive restarts.`,
  );
});

test("rate-limit store.get() returns persisted hits after re-instantiation", async () => {
  // Separate key so this test is independent of the one above.
  const GET_KEY = "127.0.0.2";

  const storeA = new PostgresRateLimitStore(WINDOW_MS, TEST_PREFIX);
  await storeA.init({} as any);

  for (let i = 0; i < MAX_HITS; i++) {
    await storeA.increment(GET_KEY);
  }

  // Fresh instance — exactly what a restarted process creates.
  const storeB = new PostgresRateLimitStore(WINDOW_MS, TEST_PREFIX);
  await storeB.init({} as any);

  const info = await storeB.get(GET_KEY);

  assert.ok(
    info !== undefined,
    "store.get() returned undefined — the row was not persisted",
  );
  assert.equal(
    info!.totalHits,
    MAX_HITS,
    `Expected ${MAX_HITS} persisted hits, got ${info!.totalHits}`,
  );
});
