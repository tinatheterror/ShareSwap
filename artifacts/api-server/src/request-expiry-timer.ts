import { backgroundJobs } from "./background-jobs-registry";
import { guardedJob } from "./guarded-job";
import type { SwitchDecision, TimerRunRecorder } from "./job-switches";
import type { JobMode } from "./scheduled-job-options";
import type { RequestExpirySweepOptions, RequestExpirySweepResult } from "./request-expiry-service";
import { buildExpirySweepOptions, resolveRemindersEnabled } from "./scheduled-job-options";

export const EXPIRY_SWEEP_TIMER_INTERVAL_MS = 60 * 1000;

/** Off unless EXPIRY_SWEEP_TIMER is exactly "on" (any case); unset, empty or anything else stays off. */
export function isExpirySweepTimerEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "on";
}

export interface ExpirySweepTimerDeps {
  env: NodeJS.ProcessEnv;
  sweep: (options: RequestExpirySweepOptions) => Promise<RequestExpirySweepResult>;
  now: () => Date;
  /**
   * The "request-expiry" kill switch, read at the start of every tick. A tick runs only when it says
   * "dry-run" or "live" (the timer never expires anything either way); "off", or a switch that cannot
   * be read, skips the tick entirely, reminders included. Absent: no switch.
   */
  readSwitch?: (envMode: JobMode) => Promise<SwitchDecision>;
  /** Where the tick's last run is recorded (timer:request-expiry). Absent: not recorded. */
  recordRun?: TimerRunRecorder;
  /** Defaults to the background-jobs registry's setInterval (cleared on shutdown). */
  schedule?: (run: () => void, everyMs: number) => unknown;
  log?: (line: string) => void;
  logError?: (line: string, error: unknown) => void;
}

/**
 * Optional in-process request-expiry sweep. Expiry is ALWAYS a dry run here (nothing expires); the
 * 4h "hand off soon" reminder follows SCHEDULED_JOBS_EXPIRY_REMINDERS (on by default), like the
 * scheduled-jobs script, and a "request-expiry" switch set to off (or unreadable) skips the tick.
 * Returns null (and schedules nothing) unless EXPIRY_SWEEP_TIMER=on.
 */
export function startRequestExpirySweepTimer(deps: ExpirySweepTimerDeps): { tick: () => Promise<void> } | null {
  if (!isExpirySweepTimerEnabled(deps.env.EXPIRY_SWEEP_TIMER)) return null;
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  const schedule = deps.schedule ?? ((run, everyMs) => backgroundJobs.setInterval(run, everyMs));
  const reminders = resolveRemindersEnabled(deps.env.SCHEDULED_JOBS_EXPIRY_REMINDERS);
  log(`[request-expiry] in-process sweep ON: expiry dry-run, reminders ${reminders ? "on" : "off"}`);

  let reported = new Set<string>();
  // Through guardedJob: the "request-expiry" switch is read each tick (off, or unreadable, skips it), and an
  // overlapping tick is skipped. A live switch still only dry-runs expiry here; the timer never expires.
  const tick = guardedJob({
    name: "request-expiry",
    envMode: "dry-run",
    supportsDryRun: true,
    resolveSwitch: deps.readSwitch ?? (async (envMode) => ({ ok: true, mode: envMode, maxCutoffAgeMs: null, source: "env" })),
    recordRun: deps.recordRun ?? (async () => {}),
    log,
    logError,
    run: async () => {
      const result = await deps.sweep(buildExpirySweepOptions("dry-run", reminders, deps.now()));
      // Log each would-expire candidate once while it stays a candidate.
      const current = new Set<string>();
      for (const c of result.candidates) {
        if (c.action !== "expire") continue;
        const line = `[request-expiry] DRY-RUN would expire request ${c.requestId} — cutoff ${c.cutoff.toISOString()}`;
        current.add(line);
        if (!reported.has(line)) log(line);
      }
      reported = current;
      if (result.remindedCount > 0 || result.failedCount > 0) {
        log(`[request-expiry] sweep reminded=${result.remindedCount} failed=${result.failedCount}`);
      }
      return `wouldExpire=${current.size} reminded=${result.remindedCount} failed=${result.failedCount}`;
    },
  });
  void tick();
  schedule(() => void tick(), EXPIRY_SWEEP_TIMER_INTERVAL_MS);
  return { tick: async () => void (await tick()) };
}
