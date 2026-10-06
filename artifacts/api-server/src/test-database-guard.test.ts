import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allowedTestHosts,
  enforceTestDatabase,
  isTestProcess,
  TestDatabaseGuardError,
} from "@workspace/db/test-database-guard";

const SECRET_URL = "postgres://some-user:s3cret-pw@prod-host.example.com:5432/appdb?sslmode=require";

function refusal(env: Record<string, string | undefined>) {
  try {
    enforceTestDatabase(env);
  } catch (error) {
    assert.ok(error instanceof TestDatabaseGuardError);
    return (error as TestDatabaseGuardError).message;
  }
  assert.fail("expected the guard to refuse");
}

test("refuses a DATABASE_URL host that is not approved, naming only the host", () => {
  const message = refusal({ DATABASE_URL: SECRET_URL });
  assert.match(message, /prod-host\.example\.com/);
  assert.match(message, /TEST_DATABASE_URL/);
  assert.match(message, /TEST_DATABASE_ALLOWED_HOSTS/);
  for (const leaked of ["some-user", "s3cret-pw", "appdb", "postgres://"]) {
    assert.ok(!message.includes(leaked), `message must not contain ${leaked}`);
  }
});

test("allows a DATABASE_URL whose host is on the allowlist (case and spacing do not matter)", () => {
  const env = { DATABASE_URL: SECRET_URL, TEST_DATABASE_ALLOWED_HOSTS: " other.example.com , PROD-HOST.example.com " };
  assert.deepEqual(enforceTestDatabase(env), { host: "prod-host.example.com", source: "TEST_DATABASE_ALLOWED_HOSTS" });
  assert.equal(env.DATABASE_URL, SECRET_URL, "an allowlisted host keeps DATABASE_URL as is");
});

test("a different host on the allowlist does not approve this one", () => {
  refusal({ DATABASE_URL: SECRET_URL, TEST_DATABASE_ALLOWED_HOSTS: "other.example.com" });
});

test("TEST_DATABASE_URL wins and DATABASE_URL is pointed at it", () => {
  const testUrl = "postgres://u:p@test-host.example.com/testdb";
  const env: Record<string, string | undefined> = { DATABASE_URL: SECRET_URL, TEST_DATABASE_URL: testUrl };
  assert.deepEqual(enforceTestDatabase(env), { host: "test-host.example.com", source: "TEST_DATABASE_URL" });
  assert.equal(env.DATABASE_URL, testUrl);
});

test("a preflight check (apply=false) does not rewrite DATABASE_URL", () => {
  const env: Record<string, string | undefined> = { DATABASE_URL: SECRET_URL, TEST_DATABASE_URL: "postgres://u:p@test-host.example.com/testdb" };
  enforceTestDatabase(env, false);
  assert.equal(env.DATABASE_URL, SECRET_URL);
});

test("an unparseable TEST_DATABASE_URL is refused without echoing it", () => {
  const message = refusal({ DATABASE_URL: SECRET_URL, TEST_DATABASE_ALLOWED_HOSTS: "prod-host.example.com", TEST_DATABASE_URL: "not a url s3cret" });
  assert.match(message, /TEST_DATABASE_URL/);
  assert.ok(!message.includes("s3cret"));
});

test("no database configured at all is refused", () => {
  assert.match(refusal({}), /no usable database/);
});

test("test processes are recognised: node:test children, the e2e API, and explicit opt-in", () => {
  assert.equal(isTestProcess({}), false);
  assert.equal(isTestProcess({ NODE_TEST_CONTEXT: "child-v8" }), true);
  assert.equal(isTestProcess({ E2E_TEST_MODE: "true" }), true);
  assert.equal(isTestProcess({ E2E_TEST_MODE: "false" }), false);
  assert.equal(isTestProcess({ TEST_DB_GUARD: "1" }), true);
  assert.deepEqual(allowedTestHosts({}), []);
});
