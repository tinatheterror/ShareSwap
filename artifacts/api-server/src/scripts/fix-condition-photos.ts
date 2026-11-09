import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { assertDestructiveDatabaseAllowed } from "@workspace/db/test-database-guard";
import { describeBrokenConditionPlan, planBrokenConditionPhotos, removeBrokenConditionPhotos } from "../broken-condition-photos";

// Removes the "/uploads/undefined" photo entries that early admin condition verifications saved.
//   pnpm --filter @workspace/api-server run condition-photos:fix            (dry run: reads only)
//   ALLOW_NON_TEST_DATABASE=<database name> pnpm ... condition-photos:fix --apply
async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  if (apply) assertDestructiveDatabaseAllowed("remove broken condition-verification photos");
  const rows = await planBrokenConditionPhotos();
  console.log(describeBrokenConditionPlan(rows));
  if (!apply) return console.log("\nDRY RUN: nothing was changed. Pass --apply to remove the bad entries.");
  console.log(`\nRows changed: ${await removeBrokenConditionPhotos(rows.map((r) => r.id))}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool.end());
}
