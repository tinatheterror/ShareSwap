// Refuses to let a test, or a script that deletes data, run against a database nobody chose for testing.
//
// Tests and e2e specs insert, backdate and delete rows, and `drizzle-kit push --force` drops whatever the schema does not
// declare. Without a guard they act on whatever DATABASE_URL the shell happens to have, which in a workspace can be the real data.
//
// A database counts as a test database only when BOTH hold:
//   1. its NAME says so: the name, split at anything that is not a letter or digit, has the word "test", "tests" or "testing"
//      (shareswap_test, test, ci-testing-2; not "latest", "contest", "appdb", "heliumdb"), and
//   2. it is on this machine (localhost, 127.x, ::1, a unix socket) or its host is listed in TEST_DATABASE_ALLOWED_HOSTS.
//
// Test processes (see isTestProcess) use TEST_DATABASE_URL when set (DATABASE_URL is then pointed at it), else DATABASE_URL, and the
// chosen URL must pass both checks. Destructive scripts (assertDestructiveDatabaseAllowed) act on DATABASE_URL and need the same,
// or an explicit per-database override: ALLOW_NON_TEST_DATABASE=<the exact database name>.
//
// Messages name the host and database only: never the URL, user or password.

export class TestDatabaseGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseGuardError";
  }
}

type Env = Record<string, string | undefined>;

export const NON_TEST_OVERRIDE_ENV = "ALLOW_NON_TEST_DATABASE";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_WORDS = new Set(["test", "tests", "testing"]);

export interface DatabaseTarget {
  host: string;
  database: string;
}

/** Host and database name of a Postgres URL, or null when it is not one. */
export function parseDatabaseTarget(url: string | undefined): DatabaseTarget | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const socket = parsed.searchParams.get("host");
    const host = parsed.hostname.toLowerCase() || (socket?.startsWith("/") ? "unix-socket" : "");
    if (!host) return null;
    return { host, database: decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase() };
  } catch {
    return null;
  }
}

/** True for node:test children, the e2e API server, test files run directly, and anything that opts in. */
export function isTestProcess(env: Env = process.env, argv: readonly string[] = process.argv): boolean {
  return (
    Boolean(env.NODE_TEST_CONTEXT) ||
    env.E2E_TEST_MODE === "true" ||
    env.TEST_DB_GUARD === "1" ||
    env.NODE_ENV === "test" ||
    // `tsx some.test.ts` runs the file without node:test's child-process marker; it is still a test.
    argv.some((arg) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(arg))
  );
}

export function allowedTestHosts(env: Env = process.env): string[] {
  return (env.TEST_DATABASE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

export function isTestDatabaseName(name: string): boolean {
  return name.toLowerCase().split(/[^a-z0-9]+/).some((word) => TEST_WORDS.has(word));
}

function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || host === "unix-socket" || /^127\./.test(host);
}

/** Why this URL is not clearly a test database, or null when it is one. */
export function whyNotTestDatabase(url: string | undefined, env: Env = process.env): string | null {
  const target = parseDatabaseTarget(url);
  if (!target) return "it is missing or not a valid database URL";
  const problems: string[] = [];
  if (!isTestDatabaseName(target.database)) {
    problems.push(`the database name "${target.database}" does not say it is a test database (it needs the word "test" in it, like "shareswap_test")`);
  }
  if (!isLocalHost(target.host) && !allowedTestHosts(env).includes(target.host)) {
    problems.push(`the host "${target.host}" is not this machine and is not listed in TEST_DATABASE_ALLOWED_HOSTS`);
  }
  return problems.length ? problems.join(", and ") : null;
}

const HOW_TO_FIX =
  'Point TEST_DATABASE_URL at a database whose name contains "test" (for example shareswap_test) on this machine, ' +
  "or on a host listed in TEST_DATABASE_ALLOWED_HOSTS (comma-separated).";

/**
 * Returns the database the tests will use, or throws. Pass `apply: true` (the default) to point DATABASE_URL at
 * TEST_DATABASE_URL so every pool created afterwards uses it.
 */
export function enforceTestDatabase(env: Env = process.env, apply = true): { host: string; database: string; source: string } {
  const usingTestUrl = env.TEST_DATABASE_URL !== undefined && env.TEST_DATABASE_URL !== "";
  const source = usingTestUrl ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const url = usingTestUrl ? env.TEST_DATABASE_URL : env.DATABASE_URL;
  const target = parseDatabaseTarget(url);
  if (!target) {
    throw new TestDatabaseGuardError(
      usingTestUrl
        ? `Refusing to run tests: TEST_DATABASE_URL is set but is not a valid database URL. ${HOW_TO_FIX}`
        : `Refusing to run tests: no usable database is configured. ${HOW_TO_FIX}`,
    );
  }
  const problem = whyNotTestDatabase(url, env);
  if (problem) {
    throw new TestDatabaseGuardError(
      `Refusing to run tests against ${source}: ${problem}. ` +
        `Tests insert, backdate and delete rows, so they must never run against a database that holds real data. ${HOW_TO_FIX}`,
    );
  }
  if (usingTestUrl && apply) env.DATABASE_URL = env.TEST_DATABASE_URL;
  return { host: target.host, database: target.database, source };
}

/**
 * For scripts that delete or drop data (drizzle-kit push, the test-data cleanups). Acts on DATABASE_URL. Throws unless it is clearly a
 * test database, or ALLOW_NON_TEST_DATABASE names exactly that database (a deliberate, per-database confirmation).
 */
export function assertDestructiveDatabaseAllowed(action: string, env: Env = process.env): DatabaseTarget {
  const target = parseDatabaseTarget(env.DATABASE_URL);
  if (!target) throw new TestDatabaseGuardError(`Refusing to ${action}: DATABASE_URL is missing or not a valid database URL.`);
  const problem = whyNotTestDatabase(env.DATABASE_URL, env);
  if (!problem) return target;
  if ((env[NON_TEST_OVERRIDE_ENV] ?? "").trim().toLowerCase() === target.database) return target;
  throw new TestDatabaseGuardError(
    `Refusing to ${action}: ${problem}. This can delete data. Run it against a test database, ` +
      `or, if you really mean this database, set ${NON_TEST_OVERRIDE_ENV}=${target.database}.`,
  );
}
