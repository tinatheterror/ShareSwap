import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedTestHosts,
  assertDestructiveDatabaseAllowed,
  enforceTestDatabase,
  isTestDatabaseName,
  isTestProcess,
  NON_TEST_OVERRIDE_ENV,
  TestDatabaseGuardError,
} from "@workspace/db/test-database-guard";

const SECRET_URL = "postgres://some-user:s3cret-pw@prod-host.example.com:5432/appdb?sslmode=require";
const LOCAL_TEST = "postgres://postgres@localhost:5432/shareswap_test";

function refusalOf(run: () => unknown) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof TestDatabaseGuardError);
    return (error as TestDatabaseGuardError).message;
  }
  assert.fail("expected the guard to refuse");
}
const refusal = (env: Record<string, string | undefined>) => refusalOf(() => enforceTestDatabase(env));

function assertNoSecrets(message: string) {
  for (const leaked of ["some-user", "s3cret-pw", "postgres://", "sslmode"]) {
    assert.ok(!message.includes(leaked), `message must not contain ${leaked}`);
  }
}

test("only a database whose name has the word test in it counts as a test database", () => {
  for (const name of ["shareswap_test", "test", "ci-testing-2", "Tests", "app.test.db"]) assert.equal(isTestDatabaseName(name), true, name);
  for (const name of ["appdb", "heliumdb", "latest", "contest", "testdb", "attestation", "shareswap", ""]) assert.equal(isTestDatabaseName(name), false, name);
});

test("refuses a DATABASE_URL that is not clearly a test database, naming the host and database but never credentials", () => {
  const message = refusal({ DATABASE_URL: SECRET_URL });
  assert.match(message, /prod-host\.example\.com/);
  assert.match(message, /appdb/);
  assert.match(message, /TEST_DATABASE_URL/);
  assertNoSecrets(message);
});

test("a real database is refused even when its host is on the allowlist: the name must say test", () => {
  const message = refusal({ DATABASE_URL: SECRET_URL, TEST_DATABASE_ALLOWED_HOSTS: "prod-host.example.com" });
  assert.match(message, /does not say it is a test database/);
  assertNoSecrets(message);
});

test("a test-named database on a remote host needs that host on the allowlist (case and spacing do not matter)", () => {
  const url = "postgres://u:p@db.example.com:5432/shareswap_test";
  assert.match(refusal({ DATABASE_URL: url }), /not this machine/);
  assert.match(refusal({ DATABASE_URL: url, TEST_DATABASE_ALLOWED_HOSTS: "other.example.com" }), /not this machine/);
  const env = { DATABASE_URL: url, TEST_DATABASE_ALLOWED_HOSTS: " other.example.com , DB.example.com " };
  assert.deepEqual(enforceTestDatabase(env), { host: "db.example.com", database: "shareswap_test", source: "DATABASE_URL" });
  assert.equal(env.DATABASE_URL, url);
});

test("a test-named database on this machine is accepted without an allowlist", () => {
  for (const url of [LOCAL_TEST, "postgres://u@127.0.0.1/test", "postgres://u@[::1]/x_test", "postgres:///shareswap_test?host=/var/run/postgresql"]) {
    assert.equal(enforceTestDatabase({ DATABASE_URL: url }).database.includes("test"), true, url);
  }
});

test("TEST_DATABASE_URL wins and DATABASE_URL is pointed at it", () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: SECRET_URL, TEST_DATABASE_URL: LOCAL_TEST };
  assert.deepEqual(enforceTestDatabase(env), { host: "localhost", database: "shareswap_test", source: "TEST_DATABASE_URL" });
  assert.equal(env.DATABASE_URL, LOCAL_TEST);
});

test("TEST_DATABASE_URL pointing at a real-looking database is refused, whatever DATABASE_URL is", () => {
  assertNoSecrets(refusal({ TEST_DATABASE_URL: SECRET_URL, DATABASE_URL: LOCAL_TEST }));
  assert.match(refusal({ TEST_DATABASE_URL: "postgres://u@localhost/appdb" }), /does not say it is a test database/);
});

test("a preflight check (apply=false) does not rewrite DATABASE_URL", () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: SECRET_URL, TEST_DATABASE_URL: LOCAL_TEST };
  enforceTestDatabase(env, false);
  assert.equal(env.DATABASE_URL, SECRET_URL);
});

test("an unparseable TEST_DATABASE_URL is refused without echoing it", () => {
  const message = refusal({ DATABASE_URL: LOCAL_TEST, TEST_DATABASE_URL: "not a url s3cret" });
  assert.match(message, /TEST_DATABASE_URL/);
  assert.ok(!message.includes("s3cret"));
});

test("no database configured at all is refused", () => {
  assert.match(refusal({}), /no usable database/);
});

test("test processes are recognised: node:test children, the e2e API, NODE_ENV=test, test files run directly, and explicit opt-in", () => {
  assert.equal(isTestProcess({}, ["node", "server.js"]), false);
  assert.equal(isTestProcess({ NODE_TEST_CONTEXT: "child-v8" }, []), true);
  assert.equal(isTestProcess({ E2E_TEST_MODE: "true" }, []), true);
  assert.equal(isTestProcess({ E2E_TEST_MODE: "false" }, []), false);
  assert.equal(isTestProcess({ TEST_DB_GUARD: "1" }, []), true);
  assert.equal(isTestProcess({ NODE_ENV: "test" }, []), true);
  assert.equal(isTestProcess({}, ["node", "/repo/src/payments.test.ts"]), true, "tsx some.test.ts has no node:test marker");
  assert.equal(isTestProcess({}, ["node", "/repo/e2e/flow.spec.ts"]), true);
  assert.equal(isTestProcess({}, ["node", "/repo/src/latest.ts"]), false);
  assert.deepEqual(allowedTestHosts({}), []);
});

test("destructive scripts: a test database passes, anything else is refused unless that exact database is confirmed", () => {
  assert.equal(assertDestructiveDatabaseAllowed("drop things", { DATABASE_URL: LOCAL_TEST }).database, "shareswap_test");

  const message = refusalOf(() => assertDestructiveDatabaseAllowed("drop things", { DATABASE_URL: SECRET_URL }));
  assert.match(message, /Refusing to drop things/);
  assert.match(message, new RegExp(`${NON_TEST_OVERRIDE_ENV}=appdb`));
  assertNoSecrets(message);

  // A TEST_DATABASE_URL in the environment does not make DATABASE_URL safe: the script acts on DATABASE_URL.
  refusalOf(() => assertDestructiveDatabaseAllowed("drop things", { DATABASE_URL: SECRET_URL, TEST_DATABASE_URL: LOCAL_TEST }));
  // The override must name this database exactly; a different name, a blank, or "true" confirms nothing.
  for (const wrong of ["otherdb", "", "true", "1", "*"]) {
    refusalOf(() => assertDestructiveDatabaseAllowed("drop things", { DATABASE_URL: SECRET_URL, [NON_TEST_OVERRIDE_ENV]: wrong }));
  }
  assert.equal(assertDestructiveDatabaseAllowed("drop things", { DATABASE_URL: SECRET_URL, [NON_TEST_OVERRIDE_ENV]: "AppDB" }).database, "appdb");
  refusalOf(() => assertDestructiveDatabaseAllowed("drop things", {}));
});
