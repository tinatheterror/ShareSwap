import assert from "node:assert/strict";
import test from "node:test";
import {
  backgroundJobsBootLine,
  backgroundJobsDecision,
  shouldRunBackgroundJobs,
} from "./background-jobs-gate";

// The in-process timers run only in a deployment (REPLIT_DEPLOYMENT set) or with BACKGROUND_JOBS=on,
// and BACKGROUND_JOBS=off wins over both. No database here.

test("a plain dev workspace (neither variable set) runs no background jobs", () => {
  const decision = backgroundJobsDecision({});
  assert.equal(decision.enabled, false);
  assert.match(decision.reason, /not a deployment and BACKGROUND_JOBS is not on/);
  assert.equal(shouldRunBackgroundJobs({}), false);
});

test("REPLIT_DEPLOYMENT turns them on, except for empty, 0 and false", () => {
  for (const value of ["1", "true", "yes"]) {
    const decision = backgroundJobsDecision({ REPLIT_DEPLOYMENT: value });
    assert.equal(decision.enabled, true, `REPLIT_DEPLOYMENT=${value}`);
    assert.equal(decision.reason, "REPLIT_DEPLOYMENT is set");
  }
  for (const value of ["", "   ", "0", "false", "FALSE"]) {
    assert.equal(shouldRunBackgroundJobs({ REPLIT_DEPLOYMENT: value }), false, `REPLIT_DEPLOYMENT=${JSON.stringify(value)}`);
  }
});

test("BACKGROUND_JOBS=on opts a non-deployment in, in any case", () => {
  for (const value of ["on", "ON", " On "]) {
    const decision = backgroundJobsDecision({ BACKGROUND_JOBS: value });
    assert.equal(decision.enabled, true, `BACKGROUND_JOBS=${JSON.stringify(value)}`);
    assert.equal(decision.reason, "BACKGROUND_JOBS=on");
  }
  assert.equal(backgroundJobsDecision({ BACKGROUND_JOBS: "on", REPLIT_DEPLOYMENT: "1" }).reason, "BACKGROUND_JOBS=on");
});

test("BACKGROUND_JOBS=off wins, even in a deployment", () => {
  for (const env of [{ BACKGROUND_JOBS: "off" }, { BACKGROUND_JOBS: "OFF", REPLIT_DEPLOYMENT: "1" }]) {
    const decision = backgroundJobsDecision(env);
    assert.equal(decision.enabled, false);
    assert.equal(decision.reason, "BACKGROUND_JOBS=off");
  }
});

test("an unrecognized BACKGROUND_JOBS value is ignored, not treated as on", () => {
  for (const value of ["true", "1", "yes", "onn", "enabled"]) {
    const dev = backgroundJobsDecision({ BACKGROUND_JOBS: value });
    assert.equal(dev.enabled, false, `BACKGROUND_JOBS=${value} in dev`);
    assert.match(dev.reason, /ignoring unrecognized BACKGROUND_JOBS=/);
    assert.equal(shouldRunBackgroundJobs({ BACKGROUND_JOBS: value, REPLIT_DEPLOYMENT: "1" }), true, `BACKGROUND_JOBS=${value} in a deployment`);
  }
});

test("an empty BACKGROUND_JOBS is the same as unset", () => {
  assert.equal(shouldRunBackgroundJobs({ BACKGROUND_JOBS: "" }), false);
  assert.equal(shouldRunBackgroundJobs({ BACKGROUND_JOBS: "  ", REPLIT_DEPLOYMENT: "1" }), true);
});

test("the boot line says whether jobs run and why, and how to opt in when they don't", () => {
  assert.equal(backgroundJobsBootLine({ REPLIT_DEPLOYMENT: "1" }), "[background-jobs] ON (REPLIT_DEPLOYMENT is set)");
  assert.equal(backgroundJobsBootLine({ BACKGROUND_JOBS: "on" }), "[background-jobs] ON (BACKGROUND_JOBS=on)");
  assert.equal(
    backgroundJobsBootLine({}),
    "[background-jobs] OFF (not a deployment and BACKGROUND_JOBS is not on; set BACKGROUND_JOBS=on to opt in)",
  );
  assert.equal(
    backgroundJobsBootLine({ BACKGROUND_JOBS: "off", REPLIT_DEPLOYMENT: "1" }),
    "[background-jobs] OFF (BACKGROUND_JOBS=off; set BACKGROUND_JOBS=on to opt in)",
  );
});
