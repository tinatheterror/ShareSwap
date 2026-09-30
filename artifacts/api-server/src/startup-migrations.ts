import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

const migrationRelativePaths = [
  "lib/db/scripts/0002_deposit_renewal_columns.sql",
  "lib/db/scripts/0003_hybrid_security_deposit.sql",
  "lib/db/scripts/0004_overdue_claim_settlement.sql",
  "lib/db/scripts/0005_unique_review_submission.sql",
  "lib/db/scripts/0006_unique_user_achievements.sql",
];

async function findMigrationPath(migrationRelativePath: string) {
  const candidates = [
    path.resolve(process.cwd(), migrationRelativePath),
    path.resolve(process.cwd(), "../..", migrationRelativePath),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known workspace/package working directory.
    }
  }
  throw new Error(`Required startup migration not found: ${migrationRelativePath}`);
}

export async function applyStartupMigrations() {
  for (const relativePath of migrationRelativePaths) {
    const migrationPath = await findMigrationPath(relativePath);
    const migrationSql = await readFile(migrationPath, "utf8");
    await pool.query(migrationSql);
  }
}