/**
 * Where moderation reports are announced. An address in configuration, never in code: set MODERATION_EMAIL in the
 * environment (Replit Secrets). Unset means reports are still stored and queued, but nobody is emailed.
 */
export function moderationEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.MODERATION_EMAIL?.trim();
  return value && /^[^\s@]+@[^\s@]+$/.test(value) ? value : null;
}

/** A report open longer than this is flagged in the queue; Apple expects action within 24 hours. */
export const REPORT_SLA_WARN_HOURS = 20;
