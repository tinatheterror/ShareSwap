import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@workspace/db";

const migrationRelativePath = "lib/db/scripts/0002_deposit_renewal_columns.sql";

async function findMigrationPath() {
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
  const migrationPath = await findMigrationPath();
  const migrationSql = await readFile(migrationPath, "utf8");
  await pool.query(migrationSql);
}