import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { pool } from "@workspace/db";
import { assertDestructiveDatabaseAllowed } from "@workspace/db/test-database-guard";
import { applyLegacyEvidenceCleanup, describeLegacyPlan, planLegacyEvidence, type RemoveResult } from "../legacy-evidence-cleanup";
import { deleteFromStorage, getFromStorage } from "../storage";

// Deletes evidence photos that were uploaded as public URLs, and clears the references to them.
//   pnpm --filter @workspace/api-server exec tsx src/scripts/purge-public-evidence.ts            (dry run: reads only)
//   ALLOW_NON_TEST_DATABASE=<database name> pnpm ... purge-public-evidence.ts --apply             (deletes)
// --apply is refused unless DATABASE_URL is a test database or ALLOW_NON_TEST_DATABASE names this database.

async function removePublicFile(url: string): Promise<RemoveResult> {
  const local = url.startsWith("/uploads/") ? path.join("./uploads", path.basename(url)) : null;
  const exists = async () => (local ? fs.existsSync(local) : (await getFromStorage(url.replace(/^\/storage\//, ""))) !== null);
  if (!(await exists())) return "missing";
  await deleteFromStorage(url);
  return (await exists()) ? "failed" : "deleted";
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  if (apply) assertDestructiveDatabaseAllowed("delete legacy public evidence files");
  const plan = await planLegacyEvidence();
  console.log(describeLegacyPlan(plan));
  if (!apply) return console.log("\nDRY RUN: nothing was changed. Pass --apply to delete the files and clear the references.");
  console.log("\n" + JSON.stringify(await applyLegacyEvidenceCleanup(plan, removePublicFile), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool.end());
}
