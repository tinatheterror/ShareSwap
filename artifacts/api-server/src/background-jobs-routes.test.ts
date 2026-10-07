import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import express from "express";
import { pool } from "@workspace/db";
import { startRateLimitCleanup } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";

// The in-process timers must not be scheduled unless background jobs are on (a deployment, or
// BACKGROUND_JOBS=on). registerRoutes schedules its timers 30s after boot and the rate-limit cleanup
// 60s after listen; these tests record those setTimeout calls and never let them fire.

const ROUTES_TIMER_MS = 30_000;
const CLEANUP_TIMER_MS = 60_000;
const CONTROLLED_ENV = ["BACKGROUND_JOBS", "REPLIT_DEPLOYMENT", "E2E_TEST_MODE"] as const;

after(async () => {
  await pool.end();
});

function fakeHandle() {
  return { unref() { return this; }, ref() { return this; }, hasRef: () => false, [Symbol.toPrimitive]: () => 0 };
}

/** Runs `fn` with the three switches set as given, recording (and swallowing) the two timers we care about. */
function recordTimers<T>(env: Partial<Record<(typeof CONTROLLED_ENV)[number], string>>, fn: () => T) {
  const saved = Object.fromEntries(CONTROLLED_ENV.map((key) => [key, process.env[key]]));
  for (const key of CONTROLLED_ENV) delete process.env[key];
  Object.assign(process.env, env);
  const original = globalThis.setTimeout;
  const delays: number[] = [];
  const spy = mock.method(globalThis, "setTimeout", ((handler: any, ms?: number, ...rest: any[]) => {
    if (ms === ROUTES_TIMER_MS || ms === CLEANUP_TIMER_MS) {
      delays.push(ms);
      return fakeHandle();
    }
    return (original as any)(handler, ms, ...rest);
  }) as any);
  try {
    const result = fn();
    return { result, delays };
  } finally {
    spy.mock.restore();
    for (const key of CONTROLLED_ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const routesTimers = (env: Parameters<typeof recordTimers>[0], options: Parameters<typeof registerRoutes>[1] = {}) =>
  recordTimers(env, () => registerRoutes(express(), options)).delays.filter((ms) => ms === ROUTES_TIMER_MS).length;

test("registerRoutes schedules no background timers in a plain dev workspace", () => {
  assert.equal(routesTimers({}), 0);
});

test("registerRoutes schedules them with BACKGROUND_JOBS=on, or in a deployment", () => {
  assert.equal(routesTimers({ BACKGROUND_JOBS: "on" }), 1);
  assert.equal(routesTimers({ REPLIT_DEPLOYMENT: "1" }), 1);
});

test("BACKGROUND_JOBS=off beats a deployment, and an unrecognized value does not opt in", () => {
  assert.equal(routesTimers({ BACKGROUND_JOBS: "off", REPLIT_DEPLOYMENT: "1" }), 0);
  assert.equal(routesTimers({ BACKGROUND_JOBS: "true" }), 0);
});

test("the existing switches still win: startBackgroundJobs:false and E2E_TEST_MODE", () => {
  assert.equal(routesTimers({ BACKGROUND_JOBS: "on" }, { startBackgroundJobs: false }), 0);
  assert.equal(routesTimers({ BACKGROUND_JOBS: "on", E2E_TEST_MODE: "true" }), 0);
});

test("the rate-limit cleanup follows the same gate", () => {
  const off = recordTimers({}, () => startRateLimitCleanup(process.env));
  assert.equal(off.result, false);
  assert.deepEqual(off.delays, []);

  const on = recordTimers({ BACKGROUND_JOBS: "on" }, () => startRateLimitCleanup(process.env));
  assert.equal(on.result, true);
  assert.deepEqual(on.delays, [CLEANUP_TIMER_MS]);

  const deployed = recordTimers({ REPLIT_DEPLOYMENT: "1" }, () => startRateLimitCleanup(process.env));
  assert.equal(deployed.result, true);

  const killed = recordTimers({ BACKGROUND_JOBS: "off", REPLIT_DEPLOYMENT: "1" }, () => startRateLimitCleanup(process.env));
  assert.equal(killed.result, false);
  assert.deepEqual(killed.delays, []);
});
