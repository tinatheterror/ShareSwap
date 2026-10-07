import assert from "node:assert/strict";
import test from "node:test";
import { createShutdown, installShutdownHandlers, type ShutdownDeps } from "./shutdown";
import type { StopResult } from "./background-jobs-registry";

// What shutdown does, in what order, and what happens when a step hangs or fails. No database, no signals.

function harness(overrides: Partial<ShutdownDeps> & { jobs?: StopResult | (() => Promise<StopResult>) } = {}) {
  const events: string[] = [];
  const exits: number[] = [];
  const jobs = overrides.jobs ?? { timedOut: [], waitedFor: 1 };
  const deps: ShutdownDeps = {
    registry: {
      stop: async () => {
        events.push("jobs");
        return typeof jobs === "function" ? jobs() : jobs;
      },
    },
    closeServer: async () => void events.push("server"),
    closePool: async () => void events.push("pool"),
    exit: (code) => void exits.push(code),
    log: (line) => void events.push(`log:${line}`),
    jobsTimeoutMs: 50,
    serverTimeoutMs: 50,
    poolTimeoutMs: 50,
    hardTimeoutMs: 5000,
    ...overrides,
  };
  return { events, exits, shutdown: createShutdown(deps) };
}

const steps = (events: string[]) => events.filter((e) => !e.startsWith("log:"));

test("stops jobs, then the server, then the pool, then exits 0", async () => {
  const { events, exits, shutdown } = harness();
  await shutdown("SIGTERM");
  assert.deepEqual(steps(events), ["jobs", "server", "pool"]);
  assert.deepEqual(exits, [0]);
  assert.ok(events.includes("log:[shutdown] complete"));
});

test("jobs that outlast the wait are named in the log and shutdown continues", async () => {
  const { events, exits, shutdown } = harness({ jobs: { timedOut: ["return-recovery"], waitedFor: 2 } });
  await shutdown("SIGTERM");
  assert.deepEqual(steps(events), ["jobs", "server", "pool"]);
  assert.ok(events.some((e) => e.includes("still running") && e.includes("return-recovery")));
  assert.deepEqual(exits, [0]);
});

test("a server that never closes is abandoned after its timeout, and the pool still ends", async () => {
  const { events, exits, shutdown } = harness({ closeServer: () => new Promise<void>(() => {}) });
  await shutdown("SIGTERM");
  assert.ok(events.includes("pool"));
  assert.ok(events.some((e) => e.includes("HTTP server still open")));
  assert.deepEqual(exits, [0]);
});

test("a pool that never ends is abandoned after its timeout", async () => {
  const { events, exits, shutdown } = harness({ closePool: () => new Promise<void>(() => {}) });
  await shutdown("SIGINT");
  assert.ok(events.some((e) => e.includes("database pool still open")));
  assert.deepEqual(exits, [0]);
});

test("a step that throws does not stop the later steps", async () => {
  const { events, exits, shutdown } = harness({
    jobs: async () => { throw new Error("registry broke"); },
    closeServer: async () => { throw new Error("close broke"); },
  });
  await shutdown("SIGTERM");
  assert.ok(events.includes("pool"));
  assert.ok(events.some((e) => e.includes("stopping background jobs failed")));
  assert.ok(events.some((e) => e.includes("closing the HTTP server failed")));
  assert.deepEqual(exits, [0]);
});

test("a second signal exits 1 immediately, without waiting for the first shutdown", async () => {
  const { exits, shutdown } = harness({ jobs: () => new Promise<StopResult>(() => {}), jobsTimeoutMs: 60_000 });
  void shutdown("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await shutdown("SIGTERM");
  assert.deepEqual(exits, [1]);
});

test("the hard timeout exits 1 if shutdown cannot finish", async () => {
  const { exits, shutdown } = harness({
    jobs: () => new Promise<StopResult>(() => {}),
    jobsTimeoutMs: 60_000,
    hardTimeoutMs: 40,
  });
  void shutdown("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(exits, [1]);
});

test("installShutdownHandlers wires SIGTERM and SIGINT, and each runs the shutdown", async () => {
  const handlers = new Map<string, () => void>();
  const events: string[] = [];
  const exits: number[] = [];
  installShutdownHandlers(
    { on: ((signal: string, handler: () => void) => void handlers.set(signal, handler)) as any },
    {
      registry: { stop: async () => ({ timedOut: [], waitedFor: 0 }) },
      closeServer: async () => void events.push("server"),
      closePool: async () => void events.push("pool"),
      exit: (code) => void exits.push(code),
      log: () => {},
    },
  );
  assert.deepEqual([...handlers.keys()].sort(), ["SIGINT", "SIGTERM"]);
  handlers.get("SIGTERM")!();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(events, ["server", "pool"]);
  assert.deepEqual(exits, [0]);
});
