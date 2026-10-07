import type { RequestExpirySweepOptions, RequestExpirySweepResult } from "./request-expiry-service";
import { buildExpirySweepOptions, resolveRemindersEnabled } from "./scripts/run-scheduled-jobs";

export const EXPIRY_SWEEP_TIMER_INTERVAL_MS = 60 * 1000;

/** Off unless EXPIRY_SWEEP_TIMER is exactly "on" (any case); unset, empty or anything else stays off. */
export function isExpirySweepTimerEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "on";
}

export interface ExpirySweepTimerDeps {
  env: NodeJS.ProcessEnv;
  sweep: (options: RequestExpirySweepOptions) => Promise<RequestExpirySweepResult>;
  now: () => Date;
  /** Defaults to setInterval. */
  schedule?: (run: () => void, everyMs: number) => unknown;
  log?: (line: string) => void;
  logError?: (line: string, error: unknown) => void;
}

/**
 * Optional in-process request-expiry sweep. Expiry is ALWAYS a dry run here (nothing expires); the
 * 4h "hand off soon" reminder follows SCHEDULED_JOBS_EXPIRY_REMINDERS (on by default), like the
 * scheduled-jobs script. Returns null (and schedules nothing) unless EXPIRY_SWEEP_TIMER=on.
 */
export function startRequestExpirySweepTimer(deps: ExpirySweepTimerDeps): { tick: () => Promise<void> } | null {
  if (!isExpirySweepTimerEnabled(deps.env.EXPIRY_SWEEP_TIMER)) return null;
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  const schedule = deps.schedule ?? ((run, everyMs) => setInterval(run, everyMs));
  const reminders = resolveRemindersEnabled(deps.env.SCHEDULED_JOBS_EXPIRY_REMINDERS);
  log(`[request-expiry] in-process sweep ON: expiry dry-run, reminders ${reminders ? "on" : "off"}`);

  let reported = new Set<string>();
  const tick = async () => {
    try {
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
    } catch (error) {
      logError("[request-expiry] sweep failed:", error);
    }
  };
  void tick();
  schedule(() => void tick(), EXPIRY_SWEEP_TIMER_INTERVAL_MS);
  return { tick };
}
