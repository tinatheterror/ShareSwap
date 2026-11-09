import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { assertDestructiveDatabaseAllowed } from "@workspace/db/test-database-guard";
import { applySandboxReset, describeResetPlan, findSandboxApprovedVerifications } from "../persona-sandbox-reset";

// Takes members whose verification was approved by a Persona SANDBOX key back to "not verified", and notifies them to verify again.
//   pnpm --filter @workspace/api-server run persona:reset-sandbox                                   (dry run: reads only)
//   ALLOW_NON_TEST_DATABASE=<database name> pnpm --filter @workspace/api-server run persona:reset-sandbox --apply --before=<ISO time>
// --before is the moment the production key went live (verifications created after it are real and are never touched); --apply refuses without it.
// --apply is refused unless DATABASE_URL is a test database or ALLOW_NON_TEST_DATABASE names this database (same rule as the other cleanups).
// Not undone: the trust score and ShareCoins the simulated approval granted. See src/persona-sandbox-reset.ts.

export function parseArgs(argv: string[]): { apply: boolean; before?: Date; error?: string } {
  const apply = argv.includes("--apply");
  const flag = argv.find((a) => a.startsWith("--before="));
  if (!flag) return { apply };
  const before = new Date(flag.slice("--before=".length));
  if (Number.isNaN(before.getTime())) return { apply, error: `--before must be an ISO time such as 2026-11-12T09:00:00Z, got "${flag.slice("--before=".length)}"` };
  return { apply, before };
}

async function main() {
  const { apply, before, error } = parseArgs(process.argv.slice(2));
  if (error) throw new Error(error);
  if (apply && !before) throw new Error("Refusing --apply without --before=<ISO time>: without a cutoff a real verification made after the production key went live would be reset too. Run the dry run to see the suggested value.");
  if (apply) assertDestructiveDatabaseAllowed("reset sandbox-approved verifications");
  const candidates = await findSandboxApprovedVerifications({ before });
  console.log(describeResetPlan(candidates, { before }));
  if (!apply) return console.log("\nDRY RUN: nothing was changed. Pass --apply --before=<ISO time> to mark these unverified and notify the members.");
  console.log("\n" + JSON.stringify(await applySandboxReset(candidates), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool.end());
}
