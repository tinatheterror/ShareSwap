import { pool } from "@workspace/db";
import { ensureRateLimitTable } from "./auth";
import { sendModerationAlertEmail } from "./mail";
import { moderationEmail } from "./moderation-config";

/**
 * Report emails to the moderation inbox are limited so a burst of reports cannot use up the email quota (Resend's free
 * plan allows 100 a day): at most one email per window, 15 minutes unless MODERATION_ALERT_MINUTES says otherwise. The first
 * report in a window is announced with the number of reports open in the queue; the rest wait in the queue (admin
 * reports page, and the 20-hour overdue flag) without their own email.
 *
 * The window lives in Postgres (rate_limit_store, key "alert:moderation-report"), claimed with one atomic upsert, so it holds
 * across restarts and across several server instances.
 */
export const ALERT_KEY = "alert:moderation-report";
export const DEFAULT_ALERT_MINUTES = 15;

export function alertWindowMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MODERATION_ALERT_MINUTES);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_ALERT_MINUTES;
}

/** True for the caller that may send the next email; false while the window from the last one is still open. */
export async function claimAlertSlot(minutes: number = alertWindowMinutes()): Promise<boolean> {
  await ensureRateLimitTable();
  const { rowCount } = await pool.query(
    `INSERT INTO rate_limit_store (key, hits, reset_time) VALUES ($1, 1, NOW() + make_interval(mins => $2))
     ON CONFLICT (key) DO UPDATE SET hits = 1, reset_time = EXCLUDED.reset_time
     WHERE rate_limit_store.reset_time <= NOW()`,
    [ALERT_KEY, minutes],
  );
  return (rowCount ?? 0) > 0;
}

export async function announceReport(report: { id: number; targetType: string; reason: string; details: string | null }): Promise<void> {
  const to = moderationEmail();
  if (!to) return;
  if (!(await claimAlertSlot())) {
    console.log(`[moderation] Report #${report.id} queued; email suppressed (one alert per ${alertWindowMinutes()} minutes)`);
    return;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM content_reports WHERE status = 'open'`);
  await sendModerationAlertEmail(to, report, rows[0]?.n);
}
