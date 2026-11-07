import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "@workspace/db";
import { ensureRentalPayoutHoldUntilDropped } from "./startup-migrations.js";

const columnPresent = async () =>
  (await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'rental_payouts' AND column_name = 'hold_until') AS present`,
  )).rows[0].present as boolean;

after(async () => { await pool.end(); });

test("the startup step drops rental_payouts.hold_until where it still exists, and does nothing once it is gone", async () => {
  await pool.query(`ALTER TABLE rental_payouts ADD COLUMN IF NOT EXISTS hold_until timestamp`);
  assert.equal(await columnPresent(), true);
  await ensureRentalPayoutHoldUntilDropped();
  assert.equal(await columnPresent(), false);
  await ensureRentalPayoutHoldUntilDropped();
  assert.equal(await columnPresent(), false);
});
