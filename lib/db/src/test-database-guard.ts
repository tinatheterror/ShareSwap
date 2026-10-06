// Refuses to let a test run against a database nobody chose for testing.
//
// Tests and e2e specs insert, backdate and delete rows. Without this guard they run
// against whatever DATABASE_URL the shell happens to have, which in a workspace can be
// the same database as real data. A test process may only use:
//
//   1. TEST_DATABASE_URL, when set (DATABASE_URL is then pointed at it), or
//   2. the DATABASE_URL host, when it is listed in TEST_DATABASE_ALLOWED_HOSTS
//      (comma-separated hostnames).
//
// Anything else fails with a message that names the host only: never the URL, user or password.

export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseGuardError";
  }
}

type Env = Record<string, string | undefined>;

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** True for node:test child processes, the e2e API server, and anything that opts in. */
export function isTestProcess(env: Env = process.env): boolean {
  return Boolean(env.NODE_TEST_CONTEXT) || env.E2E_TEST_MODE === "true" || env.TEST_DB_GUARD === "1";
}

export function allowedTestHosts(env: Env = process.env): string[] {
  return (env.TEST_DATABASE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

const HOW_TO_FIX =
  "Set TEST_DATABASE_URL to a database that is safe to write to (tests will use it instead of DATABASE_URL), " +
  "or set TEST_DATABASE_ALLOWED_HOSTS to a comma-separated list of hostnames that are safe to test against.";

/**
 * Returns the database host the tests will use, or throws. Pass `apply: true` (the default)
 * to point DATABASE_URL at TEST_DATABASE_URL so every pool created afterwards uses it.
 */
export function enforceTestDatabase(env: Env = process.env, apply = true): { host: string; source: string } {
  if (env.TEST_DATABASE_URL !== undefined && env.TEST_DATABASE_URL !== "") {
    const host = hostnameOf(env.TEST_DATABASE_URL);
    if (!host) {
      throw new TestDatabaseGuardError("TEST_DATABASE_URL is set but is not a valid database URL. Refusing to run tests.");
    }
    if (apply) env.DATABASE_URL = env.TEST_DATABASE_URL;
    return { host, source: "TEST_DATABASE_URL" };
  }

  const host = hostnameOf(env.DATABASE_URL);
  if (!host) {
    throw new TestDatabaseGuardError(
      `Refusing to run tests: no usable database is configured. ${HOW_TO_FIX}`,
    );
  }
  if (!allowedTestHosts(env).includes(host)) {
    throw new TestDatabaseGuardError(
      `Refusing to run tests: DATABASE_URL points at host "${host}", which is not approved for tests. ` +
        `Tests insert, backdate and delete rows, so they must not run against a database that holds real data. ${HOW_TO_FIX}`,
    );
  }
  return { host, source: "TEST_DATABASE_ALLOWED_HOSTS" };
}
