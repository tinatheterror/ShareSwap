import assert from "node:assert/strict";
import { test } from "node:test";
import { heartbeatAfterRun, heartbeatUrl, pingHeartbeat } from "./heartbeat.js";

const SECRET_URL = "https://hc-ping.example.com/ping/abc123-secret-token";

function fakeFetch(answer: number | Error) {
  const calls: { url: string; method?: string; hasSignal: boolean }[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, hasSignal: !!init?.signal });
    if (answer instanceof Error) throw answer;
    return { ok: answer >= 200 && answer < 300, status: answer } as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function logs() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l), logError: (l: string) => lines.push(l) };
}

test("unset or blank: no request and no log line", async () => {
  for (const raw of [undefined, "", "   "]) {
    const f = fakeFetch(200);
    const l = logs();
    assert.equal(await pingHeartbeat(raw, { fetchImpl: f.fetchImpl, ...l }), false);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(l.lines, []);
  }
});

test("a URL that is not http(s) is refused with a warning that does not repeat it", async () => {
  for (const raw of ["not a url", "file:///etc/passwd", "ftp://example.com/x"]) {
    const f = fakeFetch(200);
    const l = logs();
    assert.equal(await pingHeartbeat(raw, { fetchImpl: f.fetchImpl, ...l }), false);
    assert.equal(f.calls.length, 0);
    assert.equal(l.lines.length, 1);
    assert.ok(!l.lines[0].includes(raw));
  }
  assert.equal(heartbeatUrl(SECRET_URL)?.host, "hc-ping.example.com");
});

test("a 2xx answer counts: one GET with a timeout, and only the host is logged", async () => {
  const f = fakeFetch(200);
  const l = logs();
  assert.equal(await pingHeartbeat(` ${SECRET_URL} `, { fetchImpl: f.fetchImpl, ...l }), true);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, SECRET_URL);
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[0].hasSignal, true);
  assert.deepEqual(l.lines, ["[scheduled-jobs] heartbeat sent to hc-ping.example.com"]);
});

test("a non-2xx answer or a network error is logged without the URL and never throws", async () => {
  for (const answer of [500, 404, new Error("socket hang up")]) {
    const f = fakeFetch(answer);
    const l = logs();
    assert.equal(await pingHeartbeat(SECRET_URL, { fetchImpl: f.fetchImpl, ...l }), false);
    assert.equal(l.lines.length, 1);
    assert.ok(l.lines[0].includes("hc-ping.example.com"));
    assert.ok(!l.lines.join("\n").includes("secret-token"));
  }
});

test("a hung monitor is given up on after the timeout", async () => {
  const fetchImpl = ((_: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
  const l = logs();
  assert.equal(await pingHeartbeat(SECRET_URL, { fetchImpl, timeoutMs: 20, ...l }), false);
  assert.match(l.lines[0], /failed/);
});

test("after a real run that finished cleanly it pings", async () => {
  const f = fakeFetch(200);
  const sent = await heartbeatAfterRun({ skipped: false, exitCode: 0 }, { reportOnly: false, env: { HEARTBEAT_URL: SECRET_URL } as NodeJS.ProcessEnv }, { fetchImpl: f.fetchImpl, ...logs() });
  assert.equal(sent, true);
  assert.equal(f.calls.length, 1);
});

test("it stays quiet after a failed step, a skipped run, or a report-only run", async () => {
  const env = { HEARTBEAT_URL: SECRET_URL } as NodeJS.ProcessEnv;
  const cases: [string, { skipped: boolean; exitCode: 0 | 1 }, boolean][] = [
    ["a failed step", { skipped: false, exitCode: 1 }, false],
    ["a skipped run (lock held)", { skipped: true, exitCode: 0 }, false],
    ["a report-only run", { skipped: false, exitCode: 0 }, true],
  ];
  for (const [label, report, reportOnly] of cases) {
    const f = fakeFetch(200);
    assert.equal(await heartbeatAfterRun(report, { reportOnly, env }, { fetchImpl: f.fetchImpl, ...logs() }), false, label);
    assert.equal(f.calls.length, 0, label);
  }
});

test("with HEARTBEAT_URL unset a clean run sends nothing", async () => {
  const f = fakeFetch(200);
  assert.equal(await heartbeatAfterRun({ skipped: false, exitCode: 0 }, { reportOnly: false, env: {} as NodeJS.ProcessEnv }, { fetchImpl: f.fetchImpl, ...logs() }), false);
  assert.equal(f.calls.length, 0);
});
