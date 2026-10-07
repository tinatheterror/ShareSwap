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

export function resolveRemindersEnabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return !(value === "off" || value === "false" || value === "0" || value === "no");
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
