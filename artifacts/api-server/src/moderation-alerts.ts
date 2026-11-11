import { pool } from "@workspace/db";
import { ensureRateLimitTable } from "./auth";
import { sendAlertSummaryEmail, sendDeletionBlockedAlertEmail, sendModerationAlertEmail } from "./mail";
import { moderationEmail } from "./moderation-config";

/**
 * Emails to the admin inbox (MODERATION_EMAIL) are limited so a burst cannot use up the email quota (Resend's free plan allows
 * 100 a day): at most one email per kind per window, 15 minutes unless MODERATION_ALERT_MINUTES says otherwise. Two kinds:
 * a new report, and an account deletion that is blocked.
 *
 * No alert is dropped. Each one is queued first (admin_alert_queue). If the window is open (no email in the last N minutes) the
 * queued alerts go out at once: one alert as its own email, several as a summary. Otherwise they wait, and the sweep
 * (sweepAdminAlerts, once a minute from the server timers) sends one summary when the window ends. The window lives in Postgres
 * (rate_limit_store, key "alert:<kind>"), claimed by one atomic upsert, so it holds across restarts and several instances. Unsent
 * alerts are claimed with UPDATE ... RETURNING, so two senders never email the same alert twice; a failed send puts them back.
 */
export const DEFAULT_ALERT_MINUTES = 15;
export const SUMMARY_LINE_LIMIT = 20;
export const SENT_ROW_KEEP_DAYS = 7;

export type ReportAlert = { id: number; targetType: string; reason: string; details: string | null };
export type DeletionAlert = { userId: number; cause: string; blockers: { code: string; message: string; count?: number; amount?: string }[] };
export type AlertKind = "report" | "deletion_blocked";
export const ALERT_KINDS: AlertKind[] = ["report", "deletion_blocked"];
export const windowKey = (kind: AlertKind) => `alert:${kind}`;
/** The key the first version of the limit used for reports. */
export const ALERT_KEY = windowKey("report");

export function alertWindowMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MODERATION_ALERT_MINUTES);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_ALERT_MINUTES;
}

/** True for the caller that may send the next email of this kind; false while the window from the last one is still open. */
export async function claimAlertSlot(kind: AlertKind = "report", minutes: number = alertWindowMinutes()): Promise<boolean> {
  await ensureRateLimitTable();
  const { rowCount } = await pool.query(
    `INSERT INTO rate_limit_store (key, hits, reset_time) VALUES ($1, 1, NOW() + make_interval(mins => $2))
     ON CONFLICT (key) DO UPDATE SET hits = 1, reset_time = EXCLUDED.reset_time
     WHERE rate_limit_store.reset_time <= NOW()`,
    [windowKey(kind), minutes],
  );
  return (rowCount ?? 0) > 0;
}

const releaseAlertSlot = async (kind: AlertKind) => {
  await pool.query("DELETE FROM rate_limit_store WHERE key = $1", [windowKey(kind)]);
};

async function enqueue(kind: AlertKind, payload: object) {
  await pool.query("INSERT INTO admin_alert_queue (kind, payload) VALUES ($1, $2::jsonb)", [kind, JSON.stringify(payload)]);
}

const hasUnsent = async (kind: AlertKind) => ((await pool.query("SELECT 1 FROM admin_alert_queue WHERE kind = $1 AND sent_at IS NULL LIMIT 1", [kind])).rowCount ?? 0) > 0;

async function takeUnsent(kind: AlertKind): Promise<{ id: number; payload: any }[]> {
  const { rows } = await pool.query(
    `UPDATE admin_alert_queue SET sent_at = now() WHERE kind = $1 AND sent_at IS NULL RETURNING id, payload`,
    [kind],
  );
  return rows.sort((a, b) => a.id - b.id);
}

const putBack = async (ids: number[]) => {
  if (ids.length) await pool.query("UPDATE admin_alert_queue SET sent_at = NULL WHERE id = ANY($1)", [ids]);
};

const more = (shown: number, total: number) => (total > shown ? [`...and ${total - shown} more. They are all in the queue.`] : []);

async function sendReports(to: string, items: ReportAlert[]): Promise<boolean> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM content_reports WHERE status = 'open'`);
  const open = rows[0]?.n as number | undefined;
  if (items.length === 1) return sendModerationAlertEmail(to, items[0], open);
  const shown = items.slice(0, SUMMARY_LINE_LIMIT);
  return sendAlertSummaryEmail(to, {
    subject: `ShareSwap: ${items.length} new reports since the last alert`,
    heading: "New reports",
    lines: [`${items.length} new reports since the last alert:`, ...shown.map((r) => `#${r.id}: ${r.targetType} (${r.reason})`), ...more(shown.length, items.length)],
    footer: [...(open ? [`${open} reports are open in the queue in all.`] : []), "Review them in the queue. Reports should be acted on within 24 hours."],
  });
}

async function sendDeletions(to: string, items: DeletionAlert[]): Promise<boolean> {
  if (items.length === 1) return sendDeletionBlockedAlertEmail(to, items[0]);
  const shown = items.slice(0, SUMMARY_LINE_LIMIT);
  return sendAlertSummaryEmail(to, {
    subject: `ShareSwap: ${items.length} account deletions blocked since the last alert`,
    heading: "Account deletions blocked",
    lines: [
      `${items.length} account deletions were recorded but cannot finish yet:`,
      ...shown.map((a) => `user #${a.userId} (${a.cause}): ${a.blockers.map((b) => b.code + (b.count ? " x" + b.count : "") + (b.amount ? " ($" + b.amount + ")" : "")).join(", ")}`),
      ...more(shown.length, items.length),
    ],
    footer: ["The daily deletion job retries and completes each deletion once its blockers clear; someone may need to resolve them."],
  });
}

/**
 * Emails the queued alerts of this kind if the window is open. Returns how many alerts went out (0 when the window is closed,
 * nothing is waiting, no inbox is set, or the send failed; a failed send keeps the alerts queued and frees the window).
 */
export async function dispatchAlerts(kind: AlertKind, minutes: number = alertWindowMinutes()): Promise<number> {
  const to = moderationEmail();
  if (!to) return 0;
  if (!(await hasUnsent(kind))) return 0;
  if (!(await claimAlertSlot(kind, minutes))) return 0;
  const taken = await takeUnsent(kind);
  if (taken.length === 0) return 0;
  let ok = false;
  try {
    const payloads = taken.map((t) => t.payload);
    ok = kind === "report" ? await sendReports(to, payloads) : await sendDeletions(to, payloads);
  } catch (err) {
    console.error(`[moderation] could not send the ${kind} alert email`, err);
  }
  if (!ok) {
    await putBack(taken.map((t) => t.id));
    await releaseAlertSlot(kind);
    return 0;
  }
  return taken.length;
}

/** A new report: queued, and emailed now unless a window is open (then the sweep sends the summary). */
export async function announceReport(report: ReportAlert): Promise<void> {
  if (!moderationEmail()) return;
  await enqueue("report", report);
  if ((await dispatchAlerts("report")) === 0) console.log(`[moderation] Report #${report.id} queued; it goes out with the next alert email (one per ${alertWindowMinutes()} minutes)`);
}

/** An account deletion recorded but blocked: same limit and summary as reports. */
export async function announceBlockedDeletion(alert: DeletionAlert): Promise<void> {
  if (!moderationEmail()) return;
  await enqueue("deletion_blocked", alert);
  if ((await dispatchAlerts("deletion_blocked")) === 0) console.log(`[moderation] Blocked deletion of user ${alert.userId} queued; it goes out with the next alert email (one per ${alertWindowMinutes()} minutes)`);
}

/** The sweep: sends the summary of whatever waited out a window, and removes old sent rows. Returns how many alerts it emailed. */
export async function sweepAdminAlerts(): Promise<{ sent: number }> {
  let sent = 0;
  for (const kind of ALERT_KINDS) sent += await dispatchAlerts(kind);
  await pool.query(`DELETE FROM admin_alert_queue WHERE sent_at IS NOT NULL AND sent_at < now() - make_interval(days => $1)`, [SENT_ROW_KEEP_DAYS]);
  return { sent };
}
