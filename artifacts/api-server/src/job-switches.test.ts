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
import { guardedJob } from "./guarded-job";
import {
  JOB_SWITCHES_ATTRIBUTION_CONSTRAINT,
  JOB_SWITCHES_SQL,
  createTableIfMissing,
  ensureJobSwitchesAttributionConstraint,
  ensureJobSwitchesTable,
} from "./startup-migrations";

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

test("on read, the environment default is off outside a deployment and dry-run inside one", () => {
  assert.equal(resolveOnReadEnvMode({}), "off");
  assert.equal(resolveOnReadEnvMode({ BACKGROUND_JOBS: "on" }), "off", "BACKGROUND_JOBS=on is not a deployment");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "" }), "off");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "0" }), "off");
  assert.equal(resolveOnReadEnvMode({ REPLIT_DEPLOYMENT: "1" }), "dry-run");
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
  assert.deepEqual(await resolveJobSwitch("j", "off", rowQuery({ mode: "live", max_cutoff_age_ms: "259200000", updated_by: "test", note: "test fixture" })), {
    ok: true, mode: "live", maxCutoffAgeMs: 259_200_000, source: "table",
  });
  assert.deepEqual(await resolveJobSwitch("j", "dry-run", rowQuery(null)), {
    ok: true, mode: "dry-run", maxCutoffAgeMs: null, source: "env",
  });
});

test("an unreadable table, or an invalid row, is a failure, never a mode", async () => {
  const unreadable = await resolveJobSwitch("j", "live", failingQuery());
  assert.equal(unreadable.ok, false);
  for (const row of [{ mode: "enabled" }, { mode: null }, { mode: "live", max_cutoff_age_ms: "0", updated_by: "test", note: "test fixture" }, { mode: "live", max_cutoff_age_ms: "-5", updated_by: "test", note: "test fixture" }, { mode: "live", max_cutoff_age_ms: "abc", updated_by: "test", note: "test fixture" }]) {
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
  assert.deepEqual(await resolveReadExpiryPolicy({ REPLIT_DEPLOYMENT: "1" }, rowQuery(null)), { mode: "dry-run", maxCutoffAgeMs: null });
});

test("a row can loosen the environment as well as tighten it", async () => {
  const deployment = { REPLIT_DEPLOYMENT: "1" }; // environment default: dry-run
  assert.equal((await resolveReadExpiryPolicy(deployment, rowQuery({ mode: "live", max_cutoff_age_ms: null, updated_by: "test", note: "test fixture" }))).mode, "live");
  assert.equal((await resolveReadExpiryPolicy(deployment, rowQuery({ mode: "off", max_cutoff_age_ms: null }))).mode, "off");
  assert.equal((await resolveReadExpiryPolicy({}, rowQuery({ mode: "live", max_cutoff_age_ms: null, updated_by: "test", note: "test fixture" }))).mode, "live", "even outside a deployment");
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
  await assert.rejects(pool.query("INSERT INTO job_switches (job_name, mode, max_cutoff_age_ms, updated_by, note) VALUES ($1, 'live', 0, 'test', 'test fixture')", [name]));
  assert.equal(await readJobSwitch(name), null);
  await pool.query("INSERT INTO job_switches (job_name, mode, max_cutoff_age_ms) VALUES ($1, 'dry-run', 7200000)", [name]);
  assert.deepEqual(await readJobSwitch(name), { mode: "dry-run", maxCutoffAgeMs: 7_200_000 });
  assert.deepEqual(await resolveJobSwitch(name, "live"), { ok: true, mode: "dry-run", maxCutoffAgeMs: 7_200_000, source: "table" });
});

test("the two job names are distinct", () => {
  assert.notEqual(REQUEST_EXPIRY_JOB, REQUEST_EXPIRY_ON_READ_JOB);
});

// ── A live row must say who set it and why ──────────────────────────────────────

const LIVE_CONSTRAINT = "job_switches_live_needs_attribution";

test("the database rejects a live row without updated_by or without a note, and a blank one", async () => {
  await createTableIfMissing(scratchSql);
  const insert = (name: string, mode: string, updatedBy: unknown, note: unknown) =>
    pool.query(`INSERT INTO ${scratch} (job_name, mode, updated_by, note) VALUES ($1, $2, $3, $4)`, [name, mode, updatedBy, note]);
  const rejected = async (label: string, updatedBy: unknown, note: unknown) => {
    await assert.rejects(insert(`live-${label}`, "live", updatedBy, note), (error: { code?: string; constraint?: string }) => {
      assert.equal(error.code, "23514", label);
      assert.equal(error.constraint, LIVE_CONSTRAINT, label);
      return true;
    });
  };
  await rejected("no-updated-by", null, "turning it on after the incident");
  await rejected("no-note", "ops@example.com", null);
  await rejected("neither", null, null);
  await rejected("empty-updated-by", "", "a note");
  await rejected("empty-note", "ops@example.com", "");
  await rejected("blank-updated-by", "  \t\n", "a note");
  await rejected("blank-note", "ops@example.com", " \n ");
  await assert.rejects(
    pool.query(`INSERT INTO ${scratch} (job_name, mode) VALUES ('live-bare', 'live')`),
    (error: { constraint?: string }) => error.constraint === LIVE_CONSTRAINT,
  );
  // An existing row cannot be switched live without them either.
  await insert("was-off", "off", null, null);
  await assert.rejects(
    pool.query(`UPDATE ${scratch} SET mode = 'live' WHERE job_name = 'was-off'`),
    (error: { constraint?: string }) => error.constraint === LIVE_CONSTRAINT,
  );
  await pool.query(`UPDATE ${scratch} SET mode = 'live', updated_by = 'ops@example.com', note = 'back on' WHERE job_name = 'was-off'`);

  // With both fields it is accepted; off and dry-run never need them.
  await insert("live-ok", "live", "ops@example.com", "turning it on after the incident");
  await insert("dry-run-bare", "dry-run", null, null);
  await insert("off-bare", "off", null, "");
  const { rows } = await pool.query(`SELECT job_name FROM ${scratch} ORDER BY job_name`);
  assert.deepEqual(rows.map((r) => r.job_name), ["dry-run-bare", "live-ok", "off-bare", "was-off"]);
});

test("the real table has the constraint, and readJobSwitch reads live, dry-run and off rows through it", async () => {
  await ensureJobSwitchesTable();
  const { rows } = await pool.query(
    "SELECT conname FROM pg_constraint WHERE conrelid = 'job_switches'::regclass AND conname = $1",
    [LIVE_CONSTRAINT],
  );
  assert.equal(rows.length, 1, "the table was created with the constraint");
  const name = `test-switch-live-${process.pid}-${Date.now()}`;
  jobNames.push(name);
  await assert.rejects(pool.query("INSERT INTO job_switches (job_name, mode) VALUES ($1, 'live')", [name]));
  await pool.query("INSERT INTO job_switches (job_name, mode, updated_by, note) VALUES ($1, 'live', 'ops', 'on')", [name]);
  assert.deepEqual(await readJobSwitch(name), { mode: "live", maxCutoffAgeMs: null });
});

// A table created before the constraint existed. A temp table named job_switches shadows the real one for
// one connection, so nothing shared is touched.
const LEGACY_JOB_SWITCHES_SQL = `
CREATE TEMP TABLE job_switches (
  job_name          TEXT        PRIMARY KEY,
  mode              TEXT        NOT NULL CHECK (mode IN ('live', 'dry-run', 'off')),
  max_cutoff_age_ms BIGINT      CHECK (max_cutoff_age_ms IS NULL OR max_cutoff_age_ms > 0),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by        TEXT,
  note              TEXT
)`;

test("a live row without updated_by or a note, from before the constraint, is unreadable: the tick skips and nothing runs", async () => {
  const client = await pool.connect();
  try {
    await client.query(LEGACY_JOB_SWITCHES_SQL);
    const query: SwitchQuery = (text, params) => client.query(text, params);
    const insert = (name: string, mode: string, updatedBy: string | null, note: string | null) =>
      client.query("INSERT INTO job_switches (job_name, mode, updated_by, note) VALUES ($1, $2, $3, $4)", [name, mode, updatedBy, note]);
    await insert("no-updated-by", "live", null, "a note");
    await insert("no-note", "live", "ops", null);
    await insert("blank-note", "live", "ops", "   ");
    await insert("complete", "live", "ops", "on after the incident");
    await insert("off-bare", "off", null, null);
    await insert("dry-run-bare", "dry-run", null, null);

    for (const name of ["no-updated-by", "no-note", "blank-note"]) {
      await assert.rejects(readJobSwitch(name, query), /is live without updated_by and note/, name);
      const decision = await resolveJobSwitch(name, "off", query);
      assert.equal(decision.ok, false, `${name}: no decision, so the environment mode is not used either`);
    }
    assert.deepEqual(await readJobSwitch("complete", query), { mode: "live", maxCutoffAgeMs: null });
    assert.deepEqual(await readJobSwitch("off-bare", query), { mode: "off", maxCutoffAgeMs: null });
    assert.deepEqual(await readJobSwitch("dry-run-bare", query), { mode: "dry-run", maxCutoffAgeMs: null });

    // The tick: a timer whose row is live without the fields runs nothing and records nothing, even when the environment says live.
    const runs: string[] = [];
    const records: string[] = [];
    const errors: string[] = [];
    const tickFor = (name: string) =>
      guardedJob({
        name,
        envMode: "live",
        supportsDryRun: true,
        run: (mode) => void runs.push(`${name}:${mode}`),
        resolveSwitch: (envMode) => resolveJobSwitch(name, envMode, query),
        recordRun: async (job) => void records.push(job),
        log: () => {},
        logError: (line) => void errors.push(line),
      });
    for (const name of ["no-updated-by", "no-note", "blank-note"]) await tickFor(name)();
    assert.deepEqual(runs, []);
    assert.deepEqual(records, []);
    assert.equal(errors.length, 3);
    assert.ok(errors.every((line) => line.includes("could not read") && line.includes("live without updated_by and note")), errors.join("\n"));
    // Complete live, and bare dry-run, run; bare off does not.
    await tickFor("complete")();
    await tickFor("dry-run-bare")();
    await tickFor("off-bare")();
    assert.deepEqual(runs, ["complete:live", "dry-run-bare:dry-run"]);

    // The read path treats it as off.
    const policy = await resolveReadExpiryPolicy({ REQUEST_EXPIRY_ON_READ_MODE: "live" }, async (text, params) => {
      return query(text, ["no-note"].concat(params.slice(1) as string[]));
    }, () => {});
    assert.deepEqual(policy, READ_EXPIRY_OFF);
  } finally {
    await client.query("DROP TABLE IF EXISTS pg_temp.job_switches").catch(() => {});
    client.release();
  }
});

// ── Adding the attribution CHECK to a table that predates it ────────────────────

test("the attribution CHECK is added once to a table created without it; a second run changes nothing", async () => {
  const table = `job_switches_old_${process.pid}`;
  const constraintRows = async () =>
    (await pool.query(
      "SELECT oid, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2",
      [table, JOB_SWITCHES_ATTRIBUTION_CONSTRAINT],
    )).rows;
  const create = async () => {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
    // The shape before the attribution CHECK existed.
    await pool.query(`CREATE TABLE ${table} (
      job_name TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK (mode IN ('live', 'dry-run', 'off')),
      max_cutoff_age_ms BIGINT CHECK (max_cutoff_age_ms IS NULL OR max_cutoff_age_ms > 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by TEXT,
      note TEXT
    )`);
  };
  try {
    // Empty table: added, and validated.
    await create();
    assert.deepEqual(await constraintRows(), [], "the scratch table starts without the constraint");
    assert.equal(await ensureJobSwitchesAttributionConstraint(table), "added");
    const [first, ...extra] = await constraintRows();
    assert.equal(extra.length, 0);
    assert.equal(first.convalidated, true);
    assert.match(first.def, /mode <> 'live'::text/);
    assert.equal(await ensureJobSwitchesAttributionConstraint(table), "present");
    const [second, ...extra2] = await constraintRows();
    assert.equal(extra2.length, 0);
    assert.deepEqual(second, first, "the second run left the constraint untouched");
    await assert.rejects(pool.query(`INSERT INTO ${table} (job_name, mode) VALUES ('x', 'live')`), /job_switches_live_needs_attribution/);

    // Table with an existing (non-compliant) row: added NOT VALID, old row kept, new writes checked.
    await create();
    await pool.query(`INSERT INTO ${table} (job_name, mode) VALUES ('legacy', 'live')`);
    assert.equal(await ensureJobSwitchesAttributionConstraint(table), "added-not-valid");
    const [pending] = await constraintRows();
    assert.equal(pending.convalidated, false);
    assert.equal(await ensureJobSwitchesAttributionConstraint(table), "present");
    assert.deepEqual(await constraintRows(), [pending]);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
    await assert.rejects(pool.query(`INSERT INTO ${table} (job_name, mode) VALUES ('new', 'live')`), /job_switches_live_needs_attribution/);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
  }
});
