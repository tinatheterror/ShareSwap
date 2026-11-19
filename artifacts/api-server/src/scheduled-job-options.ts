import type { RequestExpirySweepOptions } from "./request-expiry-service";

// Settings shared by the scheduled-jobs script and the in-process request-expiry timer. Kept apart
// from scripts/run-scheduled-jobs.ts because that file runs main() when it is the entry point: anything
// the API server imports from it gets bundled into dist/index.mjs, and in a one-file bundle the server
// itself looks like the entry point.

export type JobMode = "off" | "dry-run" | "live";

/** Only requests whose cutoff passed this recently are expired/reminded; older ones are left to the silent cleanup. */
export const EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS = 3 * 24 * 3_600_000;

export function resolveJobMode(raw: string | undefined): JobMode {
  const value = raw?.trim().toLowerCase();
  if (value === "live") return "live";
  if (value === "off") return "off";
  return "dry-run";
}

/**
 * The expiry reminders are OFF unless SCHEDULED_JOBS_EXPIRY_REMINDERS is explicitly on: the 4-hour "hand off soon" reminder for
 * borrows and rentals and the 72-hour and 24-hour reminders for accepted swaps and gifts. Anything else (unset, empty, off,
 * or a value that is not recognised) is off, so a typo never turns notifications on. The reminder code is intact; set
 * SCHEDULED_JOBS_EXPIRY_REMINDERS=on to send them again. Expiry notices themselves are not reminders and are unaffected.
 */
export function resolveRemindersEnabled(raw: string | undefined): boolean {
  return envFlagOn(raw);
}

/** An opt-in flag: on only for an explicit on, true, 1 or yes (any case). Unset, empty, off, or anything unrecognised is off. */
export function envFlagOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "on" || value === "true" || value === "1" || value === "yes";
}

/** Expiry stays a dry run unless explicitly live; reminders are controlled separately. */
export function buildExpirySweepOptions(
  mode: Exclude<JobMode, "off">,
  reminders: boolean,
  now: Date,
): RequestExpirySweepOptions {
  return {
    now,
    expireDryRun: mode !== "live",
    reminders,
    maxCutoffAgeMs: EXPIRY_SWEEP_MAX_CUTOFF_AGE_MS,
  };
}
