import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { enforceTestDatabase, isTestProcess } from "./test-database-guard";

const { Pool } = pg;

// Tests and e2e runs may only use a database approved for them (see test-database-guard.ts).
if (isTestProcess(process.env)) enforceTestDatabase(process.env);

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
