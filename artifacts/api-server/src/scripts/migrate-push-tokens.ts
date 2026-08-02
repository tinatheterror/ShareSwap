/**
 * One-time migration: copy existing expo_push_token values from the users table
 * into user_push_tokens so that users who haven't relaunched the app since the
 * schema change still receive push notifications.
 *
 * Safe to run multiple times — ON CONFLICT DO NOTHING skips any token that was
 * already registered by the mobile app.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run migrate-push-tokens
 */

import { db } from "@workspace/db";
import { users, userPushTokens } from "@workspace/db";
import { isNotNull, sql } from "drizzle-orm";

async function main() {
  console.log("[migrate-push-tokens] Starting migration…");

  // Fetch all users that still have a legacy expo_push_token
  const rows = await db
    .select({ id: users.id, token: users.expoPushToken })
    .from(users)
    .where(isNotNull(users.expoPushToken));

  console.log(`[migrate-push-tokens] Found ${rows.length} legacy token(s) to migrate.`);

  if (rows.length === 0) {
    console.log("[migrate-push-tokens] Nothing to do.");
    process.exit(0);
  }

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const token = row.token as string;
    // Insert, skipping on duplicate token (unique index on user_push_tokens.token)
    const result = await db
      .insert(userPushTokens)
      .values({ userId: row.id, token })
      .onConflictDoNothing()
      .returning({ id: userPushTokens.id });

    if (result.length > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }

  console.log(
    `[migrate-push-tokens] Done. Inserted: ${inserted}, skipped (already existed): ${skipped}.`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate-push-tokens] Fatal error:", err);
  process.exit(1);
});
