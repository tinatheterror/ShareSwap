import { envFlagOn } from "./scheduled-job-options";
import { AUTO_CONFIRM_DISPUTE_WINDOW_HOURS } from "./handoff-confirm-copy";

// The switches of the code-only handoff. All are read from the environment at the moment they are used, so an operator can
// change one without a code change and the code behind every one of them stays in place.
//
// Two kinds:
//   - the one-sided extras are OFF unless explicitly on (on, true, 1 or yes; a typo is off): they are the machinery that
//     lets one person's confirmation, or one person's silence, move a request on;
//   - the code-only behaviours are ON unless explicitly off (off, false, 0 or no; a typo is on): reporting a problem,
//     one code per request with a timed lockout, the owner's 24-hour warning, and hiding "Confirm without code".

/** An opt-out flag: on unless explicitly off. Unset, empty or unrecognised is on. */
export function envFlagNotOff(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return !(value === "off" || value === "false" || value === "0" || value === "no");
}

type Env = NodeJS.ProcessEnv;

// ── One-sided extras: off by default ────────────────────────────────────────────

/** HANDOFF_AUTO_CONFIRM: the sweep confirms a handoff for the silent person once the other confirmed and 24 hours passed. */
export const handoffAutoConfirmEnabled = (env: Env = process.env) => envFlagOn(env.HANDOFF_AUTO_CONFIRM);

/** HANDOFF_REMINDER_2H: the 2-hour handoff reminder. (HANDOFF_REMINDER_12H, the 12-hour one, lives in handoff-reminders.ts.) */
export const handoff2HourReminderEnabled = (env: Env = process.env) => envFlagOn(env.HANDOFF_REMINDER_2H);

/** HANDOFF_ONE_SIDED_DENY_WAIT: a denial while the other person is silent waits 24 hours for them. Off: it opens the dispute at once. */
export const oneSidedDenyWaitEnabled = (env: Env = process.env) => envFlagOn(env.HANDOFF_ONE_SIDED_DENY_WAIT);

/**
 * HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW: after an auto-confirm either person may still dispute for 24 hours, and a borrow's
 * ShareCoins stay held until that window closes. Off: there is no window and the coins settle with the auto-confirm.
 */
export const autoConfirmDisputeWindowEnabled = (env: Env = process.env) => envFlagOn(env.HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW);

/** HANDOFF_FLAGGED: a request where one person denied and the other stayed silent is moved to HANDOFF_FLAGGED for admin review. */
export const handoffFlaggedEnabled = (env: Env = process.env) => envFlagOn(env.HANDOFF_FLAGGED);

/** How long a person may still dispute an auto-confirmed handoff: 24 hours with the window switched on, none without it. */
export function autoConfirmDisputeWindowHours(env: Env = process.env): number {
  return autoConfirmDisputeWindowEnabled(env) ? AUTO_CONFIRM_DISPUTE_WINDOW_HOURS : 0;
}

// ── Code-only behaviours: on by default ─────────────────────────────────────────

/** HANDOFF_REPORT_PROBLEM: either person can report a problem from ACCEPTED or DEPOSIT_CONFIRMED; it opens the dispute at once. */
export const handoffReportProblemEnabled = (env: Env = process.env) => envFlagNotOff(env.HANDOFF_REPORT_PROBLEM);

/** HANDOFF_HIDE_MANUAL_CONFIRM: both apps hide "Confirm without code". The route itself is untouched. */
export const handoffManualConfirmHidden = (env: Env = process.env) => envFlagNotOff(env.HANDOFF_HIDE_MANUAL_CONFIRM);

/**
 * HANDOFF_ONE_CODE: the code stays the same for the whole request, and 5 wrong tries lock entry for 15 minutes (then the same
 * code works again). Off: the old rules (a new code each time the request is accepted, a permanent lock after 5 wrong tries).
 */
export const handoffOneCodeEnabled = (env: Env = process.env) => envFlagNotOff(env.HANDOFF_ONE_CODE);

/** HANDOFF_OWNER_WARNING: the owner is warned 24 hours before the handoff cutoff when the code has not been entered. */
export const handoffOwnerWarningEnabled = (env: Env = process.env) => envFlagNotOff(env.HANDOFF_OWNER_WARNING);

/** What the apps need to know to draw the handoff screens. */
export function handoffClientFlags(env: Env = process.env) {
  return {
    hideManualConfirm: handoffManualConfirmHidden(env),
    reportProblem: handoffReportProblemEnabled(env),
    oneCode: handoffOneCodeEnabled(env),
    /** Whether the sweep still confirms for a silent person: the apps only promise "we'll complete this automatically" when it does. */
    autoConfirm: handoffAutoConfirmEnabled(env),
  };
}

export const HANDOFF_CODE_MAX_TRIES = 5;
export const HANDOFF_CODE_LOCKOUT_MINUTES = 15;
