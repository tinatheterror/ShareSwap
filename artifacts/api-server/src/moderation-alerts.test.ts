import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pool } from "@workspace/db";
import { alertWindowMinutes, ALERT_KEY, announceReport, claimAlertSlot } from "./moderation-alerts.js";
import { ensureRateLimitTable } from "./auth.js";
import { sentMail } from "./mail.js";

const saved = process.env.MODERATION_EMAIL;
const clear = async () => { await ensureRateLimitTable(); await pool.query("DELETE FROM rate_limit_store WHERE key = $1", [ALERT_KEY]); };
const rep = (id: number) => ({ id, targetType: "item", reason: "spam", details: null });

before(async () => {
  process.env.MODERATION_EMAIL = "mods@example.test";
  await clear();
  sentMail.length = 0;
});
after(async () => {
  if (saved === undefined) delete process.env.MODERATION_EMAIL; else process.env.MODERATION_EMAIL = saved;
  await clear();
  sentMail.length = 0;
});

test("the window setting: 15 minutes by default, a whole number of minutes from the environment", () => {
  assert.equal(alertWindowMinutes({} as NodeJS.ProcessEnv), 15);
  assert.equal(alertWindowMinutes({ MODERATION_ALERT_MINUTES: "30" } as NodeJS.ProcessEnv), 30);
  assert.equal(alertWindowMinutes({ MODERATION_ALERT_MINUTES: "0" } as NodeJS.ProcessEnv), 15);
  assert.equal(alertWindowMinutes({ MODERATION_ALERT_MINUTES: "x" } as NodeJS.ProcessEnv), 15);
});

test("a burst of reports sends one email; the next window sends another", async () => {
  await Promise.all([1, 2, 3, 4, 5].map((n) => announceReport(rep(n))));
  assert.equal(sentMail.length, 1, "one email for five simultaneous reports");
  await announceReport(rep(6));
  assert.equal(sentMail.length, 1);
  await pool.query("UPDATE rate_limit_store SET reset_time = NOW() - interval '1 second' WHERE key = $1", [ALERT_KEY]);
  await announceReport(rep(7));
  assert.equal(sentMail.length, 2, "the window has passed");
  assert.match(String(sentMail[1].subject), /report #7/);
});

test("no inbox configured: nothing is sent and no window is used up", async () => {
  await clear();
  sentMail.length = 0;
  delete process.env.MODERATION_EMAIL;
  await announceReport(rep(8));
  assert.equal(sentMail.length, 0);
  assert.equal(await claimAlertSlot(), true);
  process.env.MODERATION_EMAIL = "mods@example.test";
});
