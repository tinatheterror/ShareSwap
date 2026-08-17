/**
 * Migration: add request_id column to reputation_activities
 *
 * Adds a nullable FK to item_requests so that borrow-return trust awards
 * can be looked up by (userId, requestId) for idempotency checks.
 *
 * Run once:
 *   pnpm --filter @workspace/api-server tsx src/scripts/migrate-reputation-request-id.ts
 *
 * Safe to re-run (IF NOT EXISTS guard).
 */

import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE reputation_activities
        ADD COLUMN IF NOT EXISTS request_id INTEGER
          REFERENCES item_requests(id)
    `);
    console.log("✅ reputation_activities.request_id column ensured");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
