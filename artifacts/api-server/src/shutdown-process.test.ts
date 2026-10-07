import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

// Real signals against a real child process running the real registry, guard and signal installer
// (src/test-fixtures/shutdown-child.ts). No database.

interface Child {
  output: () => string;
  waitFor: (text: string, ms?: number) => Promise<void>;
  signal: (name: NodeJS.Signals) => void;
  exited: Promise<{ code: number | null; ms: number }>;
}

function startChild(mode: "finish" | "hang", env: Record<string, string> = {}): Child {
  const child = spawn(process.execPath, ["--import", "tsx", "src/test-fixtures/shutdown-child.ts", mode], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  child.stdout.on("data", (chunk) => (text += chunk));
  child.stderr.on("data", (chunk) => (text += chunk));
  let signalledAt = 0;
  const exited = new Promise<{ code: number | null; ms: number }>((resolve) => {
    child.on("exit", (code) => resolve({ code, ms: Date.now() - signalledAt }));
  });
  const waitFor = async (needle: string, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!text.includes(needle)) {
      if (Date.now() > deadline) {
        child.kill("SIGKILL");
        assert.fail(`timed out waiting for ${JSON.stringify(needle)}; output so far:\n${text}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  return {
    output: () => text,
    waitFor,
    signal: (name) => {
      signalledAt ||= Date.now();
      child.kill(name);
    },
    exited,
  };
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`${signal} during a tick: the tick finishes, no new tick starts, everything closes, exit 0`, async () => {
    const child = startChild("finish");
    await child.waitFor("TICK_STARTED 1");
    child.signal(signal);
    const { code } = await child.exited;
    const out = child.output();
    assert.equal(code, 0, out);
    assert.ok(out.includes("TICK_FINISHED 1"), "the running tick was allowed to finish");
    assert.ok(!out.includes("TICK_STARTED 2"), "no tick started after the signal");
    const order = ["TICK_FINISHED 1", "background jobs stopped", "HTTP server closed", "POOL_CLOSED", "[shutdown] complete"].map((s) => out.indexOf(s));
    assert.ok(order.every((n) => n >= 0), out);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `steps out of order:\n${out}`);
  });
}

test("a tick that never ends is abandoned after the jobs timeout, then the process still exits 0", async () => {
  const child = startChild("hang", { JOBS_TIMEOUT_MS: "400" });
  await child.waitFor("TICK_STARTED 1");
  child.signal("SIGTERM");
  const { code, ms } = await child.exited;
  const out = child.output();
  assert.equal(code, 0, out);
  assert.ok(out.includes("background jobs still running") && out.includes("demo-tick"), out);
  assert.ok(ms < 5000, `took ${ms}ms`);
});

test("a second signal while a tick hangs exits 1 straight away", async () => {
  const child = startChild("hang", { JOBS_TIMEOUT_MS: "60000" });
  await child.waitFor("TICK_STARTED 1");
  child.signal("SIGTERM");
  await child.waitFor("SIGTERM received;");
  child.signal("SIGTERM");
  const { code, ms } = await child.exited;
  assert.equal(code, 1, child.output());
  assert.ok(ms < 3000, `took ${ms}ms`);
  assert.ok(child.output().includes("received again; exiting immediately"));
});
