// Preflight for `pnpm test`: fails loudly, before any test starts, if the database is not approved.
import { enforceTestDatabase } from "./test-database-guard";

try {
  const { host, database, source } = enforceTestDatabase(process.env, false);
  console.log(`[test-database-guard] OK: tests will use database ${database} on ${host} (${source})`);
} catch (error) {
  console.error(`\n[test-database-guard] ${(error as Error).message}\n`);
  process.exit(1);
}
