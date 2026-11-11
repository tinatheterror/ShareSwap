import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { pool } from "@workspace/db";
import { ensureRateLimitTable } from "./auth.js";
import { ensureAdminAlertQueueTable } from "./startup-migrations.js";
import { alertWindowMinutes, announceBlockedDeletion, announceReport, claimAlertSlot, dispatchAlerts, sweepAdminAlerts, windowKey } from "./moderation-alerts.js";
import { fakeMailFailure, sentMail } from "./mail.js";

// Report and blocked-deletion emails go out at most once per window per kind, and nothing queued is ever left without an email:
// what waited is sent as one summary when the window ends.

const saved = process.env.MODERATION_EMAIL;
const keys = [windowKey("report"), windowKey("deletion_blocked")];
const clear = async () => {
  await pool.query("DELETE FROM rate_limit_store WHERE key = ANY($1)", [keys]);
  await pool.query("DELETE FROM admin_alert_queue");
};
const endWindow = (kind: "report" | "deletion_blocked") => pool.query("UPDATE rate_limit_store SET reset_time = NOW() - interval '1 second' WHERE key = $1", [windowKey(kind)]);
const unsent = async (kind: string) => (await pool.query("SELECT count(*)::int AS n FROM admin_alert_queue WHERE kind = $1 AND sent_at IS NULL", [kind])).rows[0].n as number;
const rep = (id: number, reason = "spam") => ({ id, targetType: "item", reason, details: null });
const blocked = (userId: number) => ({ userId, cause: "apple", blockers: [{ code: "open_booking", message: "A booking is open", count: 2 }] });
const subjects = () => sentMail.map((m) => String(m.subject));
const body = (i: number) => String(sentMail[i].text);

before(async () => {
  await ensureRateLimitTable();
  await ensureAdminAlertQueueTable();
});
beforeEach(async () => {
  process.env.MODERATION_EMAIL = "mods@example.test";
  await clear();
  sentMail.length = 0;
});
after(async () => {
  if (saved === undefined) delete process.env.MODERATION_EMAIL; else process.env.MODERATION_EMAIL = saved;
  fakeMailFailure.error = null;
  await clear();
  sentMail.length = 0;
});

test("the window setting: 15 minutes by default, a whole number of minutes from the environment", () => {
  assert.equal(alertWindowMinutes({} as NodeJS.ProcessEnv), 15);
  assert.equal(alertWindowMinutes({ MODERATION_ALERT_MINUTES: "30" } as NodeJS.ProcessEnv), 30);
  assert.equal(alertWindowMinutes({ MODERATION_ALERT_MINUTES: "0" } as NodeJS.ProcessEnv), 15);
  assert.equal(alertWindowMinutes({ MODERATION_ALERT_MINUTES: "x" } as NodeJS.ProcessEnv), 15);
});

test("the first report is emailed at once; reports in the same window wait and go out as ONE summary when it ends", async () => {
  await announceReport(rep(1));
  assert.deepEqual(subjects().map((s) => /report #1:/.test(s)), [true]);
  await announceReport(rep(2));
  await announceReport(rep(3, "scam"));
  await announceReport(rep(4, "hate"));
  assert.equal(sentMail.length, 1, "nothing more while the window is open");
  assert.equal(await unsent("report"), 3);
  assert.deepEqual(await sweepAdminAlerts(), { sent: 0 }, "the sweep leaves them while the window is open");
  assert.equal(sentMail.length, 1);

  await endWindow("report");
  assert.deepEqual(await sweepAdminAlerts(), { sent: 3 });
  assert.equal(sentMail.length, 2);
  assert.equal(subjects()[1], "ShareSwap: 3 new reports since the last alert");
  for (const needle of ["#2: item (spam)", "#3: item (scam)", "#4: item (hate)"]) assert.ok(body(1).includes(needle), needle);
  assert.equal(await unsent("report"), 0, "every report has had its email");

  assert.deepEqual(await sweepAdminAlerts(), { sent: 0 }, "nothing is sent twice");
  assert.equal(sentMail.length, 2);
});

test("one waiting report is sent as its own email, not a summary of one", async () => {
  await announceReport(rep(1));
  await announceReport(rep(2));
  await endWindow("report");
  await sweepAdminAlerts();
  assert.match(subjects()[1], /^ShareSwap report #2: item \(spam\)$/);
});

test("a long wait lists the first 20 and says how many more", async () => {
  await announceReport(rep(1));
  for (let n = 2; n <= 26; n++) await announceReport(rep(n));
  await endWindow("report");
  await sweepAdminAlerts();
  assert.equal(subjects()[1], "ShareSwap: 25 new reports since the last alert");
  assert.ok(body(1).includes("#21: item (spam)") && !body(1).includes("#22: item"));
  assert.ok(body(1).includes("...and 5 more"));
});

test("a failed send loses nothing: the alerts stay queued, the window is freed, the next sweep sends them", async () => {
  fakeMailFailure.error = new Error("Resend rejected the email");
  await announceReport(rep(1));
  assert.equal(sentMail.length, 0);
  assert.equal(await unsent("report"), 1);
  fakeMailFailure.error = null;
  assert.deepEqual(await sweepAdminAlerts(), { sent: 1 });
  assert.match(subjects()[0], /report #1:/);
  assert.equal(await unsent("report"), 0);
});

test("two sweeps at once send the summary once", async () => {
  await announceReport(rep(1));
  await announceReport(rep(2));
  await announceReport(rep(3));
  await endWindow("report");
  const results = await Promise.all([sweepAdminAlerts(), sweepAdminAlerts(), sweepAdminAlerts()]);
  assert.equal(results.reduce((n, r) => n + r.sent, 0), 2);
  assert.equal(sentMail.length, 2);
});

test("no inbox configured: nothing is queued or sent", async () => {
  delete process.env.MODERATION_EMAIL;
  await announceReport(rep(8));
  await announceBlockedDeletion(blocked(5));
  assert.equal(sentMail.length, 0);
  assert.equal(await unsent("report") + await unsent("deletion_blocked"), 0);
  assert.equal(await claimAlertSlot("report"), true, "no window was used up");
});

test("blocked deletions have their own window and the same trailing summary", async () => {
  await announceReport(rep(1));
  await announceBlockedDeletion(blocked(11));
  assert.equal(sentMail.length, 2, "a report window does not hold back a deletion alert");
  assert.match(subjects()[1], /^ShareSwap: deletion of user #11 is blocked$/);
  await announceBlockedDeletion(blocked(12));
  await announceBlockedDeletion(blocked(13));
  assert.equal(sentMail.length, 2);
  assert.equal(await unsent("deletion_blocked"), 2);
  await endWindow("deletion_blocked");
  assert.deepEqual(await sweepAdminAlerts(), { sent: 2 });
  assert.equal(subjects()[2], "ShareSwap: 2 account deletions blocked since the last alert");
  assert.ok(body(2).includes("user #12 (apple): open_booking x2") && body(2).includes("user #13 (apple)"));
  assert.equal(await unsent("deletion_blocked"), 0);
  assert.equal(sentMail.length, 3, "the report kind sent nothing extra");
});

test("the sweep removes sent rows after 7 days and keeps newer ones", async () => {
  await announceReport(rep(1));
  await pool.query("UPDATE admin_alert_queue SET sent_at = now() - interval '8 days'");
  await announceReport(rep(2)); // window open: stays queued, unsent
  await sweepAdminAlerts();
  const rows = (await pool.query("SELECT payload->>'id' AS id FROM admin_alert_queue")).rows;
  assert.deepEqual(rows.map((r) => r.id), ["2"]);
});

test("dispatchAlerts with an empty queue sends nothing and keeps the window free", async () => {
  assert.equal(await dispatchAlerts("report"), 0);
  assert.equal(await claimAlertSlot("report"), true);
});
