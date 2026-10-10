import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import {
  READ_EXPIRY_OFF,
  REQUEST_EXPIRY_JOB,
  REQUEST_EXPIRY_ON_READ_JOB,
  createReadRunRecorder,
  parseSwitchMode,
  readJobSwitch,
  resolveJobSwitch,
  resolveOnReadEnvMode,
  resolveReadExpiryPolicy,
  type SwitchQuery,
} from "./job-switches";
import { JOB_SWITCHES_SQL, createTableIfMissing, ensureJobSwitchesTable } from "./startup-migrations";

const rowQuery = (row: Record<string, unknown> | null): SwitchQuery => async () => ({ rows: row ? [row] : [] });
const failingQuery = (message = 'relation "job_switches" does not exist'): SwitchQuery => async () => {
  throw new Error(message);
};

// ── Modes and the environment default ───────────────────────────────────────────

test("a switch mode is exactly live, dry-run or off; nothing else is accepted", () => {
  assert.equal(parseSwitchMode("live"), "live");
  assert.equal(parseSwitchMode("dry-run"), "dry-run");
  assert.equal(parseSwitchMode("off"), "off");
  for (const bad of ["LIVE", " live", "on", "dryrun", "", null, undefined, 1]) assert.equal(parseSwitchMode(bad), null);
});

test("on read, the environment default is off outside a deployment and live inside one", () => {
  assert.equal(resolveOnReadEnvMode({}), "off");
  assert.equal(resolveOnReadEnvMode({ BACKGROUND_JOBS: "on" }), "off", "BACKGROUND_JOBS=on is not a deployment");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "" }), "off");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "0" }), "off");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "1" }), "live");
});

test("on read, REQUEST_EXPIRY_ON_READ_MODE overrides the default; anything unrecognised is off", () => {
  assert.equal(resolveOnReadEnvMode({ REQUEST_EXPIRY_ON_READ_MODE: "live" }), "live");
  assert.equal(resolveOnReadEnvMode({ REQUEST_EXPIRY_ON_READ_MODE: " Dry-Run " }), "dry-run");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "1", REQUEST_EXPIRY_ON_READ_MODE: "off" }), "off");
  for (const bad of ["on", "true", "1", "liv"]) {
    assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "1", REQUEST_EXPIRY_ON_READ_MODE: bad }), "off", bad);
  }
});

// ── Resolving a switch ──────────────────────────────────────────────────────────

test("a row wins over the environment; no row falls back to it", async () => {
  assert.deepEqual(await resolveJobSwitch("j", "live", rowQuery({ mode: "off", max_cutoff_age_ms: null })), {
    ok: true, mode: "off", maxCutoffAgeMs: null, source: "table",
  });
  assert.deepEqual(await resolveJobSwitch("j", "off", rowQuery({ mode: "live", max_cutoff_age_ms: "259200000" })), {
    ok: true, mode: "live", maxCutoffAgeMs: 259_200_000, source: "table",
  });
  assert.deepEqual(await resolveJobSwitch("j", "dry-run", rowQuery(null)), {
    ok: true, mode: "dry-run", maxCutoffAgeMs: null, source: "env",
  });
});

test("an unreadable table, or an invalid row, is a failure, never a mode", async () => {
  const unreadable = await resolveJobSwitch("j", "live", failingQuery());
  assert.equal(unreadable.ok, false);
  for (const row of [{ mode: "enabled" }, { mode: null }, { mode: "live", max_cutoff_age_ms: "0" }, { mode: "live", max_cutoff_age_ms: "-5" }, { mode: "live", max_cutoff_age_ms: "abc" }]) {
    const decision = await resolveJobSwitch("j", "live", rowQuery(row));
    assert.equal(decision.ok, false, JSON.stringify(row));
  }
});

test("a failed read of job_switches makes the read path off, even when the environment says live", async () => {
  const errors: string[] = [];
  const env = { REPLIT_DEPLOYMENT: "1", REQUEST_EXPIRY_ON_READ_MODE: "live" };
  const policy = await resolveReadExpiryPolicy(env, failingQuery(), (l) => void errors.push(l), () => 1_000_000);
  assert.deepEqual(policy, READ_EXPIRY_OFF);
  assert.equal(errors.length, 1);
  // Logged at most once a minute, not on every request.
  await resolveReadExpiryPolicy(env, failingQuery(), (l) => void errors.push(l), () => 1_030_000);
  assert.equal(errors.length, 1);
  await resolveReadExpiryPolicy(env, failingQuery(), (l) => void errors.push(l), () => 1_061_000);
  assert.equal(errors.length, 2);
});

test("the read policy follows the row for request-expiry-on-read, with its max cutoff age", async () => {
  const asked: unknown[][] = [];
  const query: SwitchQuery = async (_text, params) => {
    asked.push(params);
    return { rows: [{ mode: "dry-run", max_cutoff_age_ms: 3_600_000 }] };
  };
  assert.deepEqual(await resolveReadExpiryPolicy({}, query), { mode: "dry-run", maxCutoffAgeMs: 3_600_000 });
  assert.deepEqual(asked, [[REQUEST_EXPIRY_ON_READ_JOB]]);
  // No row: the environment default (off here: not a deployment).
  assert.deepEqual(await resolveReadExpiryPolicy({}, rowQuery(null)), { mode: "off", maxCutoffAgeMs: null });
  assert.deepEqual(await resolveReadExpiryPolicy({ REPLIT_DEPLOYMENT: "1" }, rowQuery(null)), { mode: "live", maxCutoffAgeMs: null });
});

// ── Last-run recording ──────────────────────────────────────────────────────────

test("read-path runs are recorded in scheduled_job_runs at most once a minute, with the counts in between added up", async () => {
  const writes: Array<{ params: unknown[] }> = [];
  let clock = 10_000_000;
  const record = createReadRunRecorder({
    query: async (_text, params) => (writes.push({ params }), { rows: [] }),
    now: () => new Date(clock),
    everyMs: 60_000,
  });
  await record({ mode: "live", expired: 1, wouldExpire: 0 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].params[0], REQUEST_EXPIRY_ON_READ_JOB);
  clock += 10_000;
  await record({ mode: "live", expired: 2, wouldExpire: 0 });
  clock += 10_000;
  await record({ mode: "live", expired: 0, wouldExpire: 0 });
  assert.equal(writes.length, 1, "throttled");
  clock += 60_000;
  await record({ mode: "live", expired: 1, wouldExpire: 0 });
  assert.equal(writes.length, 2);
  assert.deepEqual(JSON.parse(writes[1].params[2] as string), { mode: "live", checks: 3, expired: 3, wouldExpire: 0 });
});

test("off runs are not recorded, and a failing write is ignored", async () => {
  let writes = 0;
  const record = createReadRunRecorder({ query: async () => (writes++, { rows: [] }), now: () => new Date(0), everyMs: 0 });
  await record({ mode: "off", expired: 0, wouldExpire: 0 });
  assert.equal(writes, 0);
  const failing = createReadRunRecorder({ query: failingQuery("boom"), now: () => new Date(0), everyMs: 0 });
  await assert.doesNotReject(() => failing({ mode: "dry-run", expired: 0, wouldExpire: 1 }));
});

// ── The migration, on the real database ─────────────────────────────────────────

const scratch = `job_switches_test_${process.pid}_${Date.now()}`;
const scratchSql = JOB_SWITCHES_SQL.replace("job_switches", scratch);
const jobNames: string[] = [];

after(async () => {
  await pool.query(`DROP TABLE IF EXISTS ${scratch}`);
  if (jobNames.length) await pool.query("DELETE FROM job_switches WHERE job_name = ANY($1)", [jobNames]);
  await pool.end();
});

test("the migration is idempotent, and safe when several processes create the table at once", async () => {
  assert.ok(scratchSql.includes(scratch), "the scratch copy really renamed the table");
  await Promise.all([1, 2, 3, 4, 5].map(() => createTableIfMissing(scratchSql)));
  await createTableIfMissing(scratchSql);
  await createTableIfMissing(scratchSql);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = $1", [scratch]);
  assert.equal(rows[0].n, 1);
});

test("the migration only creates: it is a single CREATE TABLE IF NOT EXISTS with no seed rows", () => {
  const statements = JOB_SWITCHES_SQL.split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS job_switches \(/);
  assert.doesNotMatch(JOB_SWITCHES_SQL, /\b(ALTER|DROP|UPDATE|DELETE|INSERT|TRUNCATE)\b/i);
});

test("job_switches holds config only: the last-run columns are in scheduled_job_runs", async () => {
  await ensureJobSwitchesTable();
  await ensureJobSwitchesTable();
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'job_switches' ORDER BY ordinal_position",
  );
  assert.deepEqual(rows.map((r) => r.column_name), ["job_name", "mode", "max_cutoff_age_ms", "updated_at", "updated_by", "note"]);
});

test("the table rejects a bad mode or a non-positive max cutoff age, and reads back through readJobSwitch", async () => {
  await ensureJobSwitchesTable();
  const name = `test-switch-${process.pid}-${Date.now()}`;
  jobNames.push(name);
  await assert.rejects(pool.query("INSERT INTO job_switches (job_name, mode) VALUES ($1, 'bogus')", [name]));
  await assert.rejects(pool.query("INSERT INTO job_switches (job_name, mode, max_cutoff_age_ms) VALUES ($1, 'live', 0)", [name]));
  assert.equal(await readJobSwitch(name), null);
  await pool.query("INSERT INTO job_switches (job_name, mode, max_cutoff_age_ms) VALUES ($1, 'dry-run', 7200000)", [name]);
  assert.deepEqual(await readJobSwitch(name), { mode: "dry-run", maxCutoffAgeMs: 7_200_000 });
  assert.deepEqual(await resolveJobSwitch(name, "live"), { ok: true, mode: "dry-run", maxCutoffAgeMs: 7_200_000, source: "table" });
});

test("the two job names are distinct", () => {
  assert.notEqual(REQUEST_EXPIRY_JOB, REQUEST_EXPIRY_ON_READ_JOB);
});
