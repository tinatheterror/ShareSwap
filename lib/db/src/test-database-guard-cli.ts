// Preflight for `pnpm test`: fails loudly, before any test starts, if the database is not approved.
import { enforceTestDatabase } from "./test-database-guard";

try {
  const { host, source } = enforceTestDatabase(process.env, false);
  console.log(`[test-database-guard] OK: tests will use host ${host} (${source})`);
} catch (error) {
  console.error(`\n[test-database-guard] ${(error as Error).message}\n`);
  process.exit(1);
}
