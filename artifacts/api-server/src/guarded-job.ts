import {
  resolveJobSwitch,
  timerRunRecorder,
  type SwitchDecision,
  type TimerRunRecorder,
} from "./job-switches";
import { withOverlapGuard, type OverlapGuarded, type OverlapGuardOptions } from "./overlap-guard";
import type { JobMode } from "./scheduled-job-options";

// One wrapper for every in-process timer: read the job's kill switch on each tick, run the work only
// when the switch says to, and record the run. Runs inside withOverlapGuard, so a slow tick (a slow
// switch read included) makes the next one skip instead of overlapping.
//
//   - A switch row wins over envMode; no row means envMode; a switch that cannot be read skips the tick
//     (logged at most once a minute) and never runs anything.
//   - off skips the tick. dry-run runs the work in dry-run when the job has one (supportsDryRun), and
//     otherwise skips the tick and says so once, until the mode changes.
//   - Runs are recorded in scheduled_job_runs as timer:<name> (see timerRunName), with throttled writes.

export interface GuardedJobOptions {
  /** The job's plain name: the job_switches row, the overlap-guard name and the log prefix. */
  name: string;
  /** What no row falls back to. */
  envMode: JobMode;
  supportsDryRun: boolean;
  /** The work. Throw to fail the run (it is logged and recorded as failed); return a short summary to record. */
  run: (mode: Exclude<JobMode, "off">) => Promise<string | void> | string | void;
  /** Defaults to reading job_switches. */
  resolveSwitch?: (envMode: JobMode) => Promise<SwitchDecision>;
  /** Defaults to the process-wide timer:<name> recorder. */
  recordRun?: TimerRunRecorder;
  log?: (line: string) => void;
  logError?: (line: string, error?: unknown) => void;
  /** For tests; defaults to Date.now. */
  nowMs?: () => number;
  overlap?: OverlapGuardOptions;
}

const LOG_UNREADABLE_EVERY_MS = 60_000;

export function guardedJob(options: GuardedJobOptions): OverlapGuarded<[], void> {
  const { name, envMode, supportsDryRun } = options;
  const resolveSwitch = options.resolveSwitch ?? ((mode: JobMode) => resolveJobSwitch(name, mode));
  const log = options.log ?? console.log;
  const logError = options.logError ?? ((line: string, error?: unknown) => console.error(line, error ?? ""));
  const nowMs = options.nowMs ?? Date.now;
  let lastUnreadableLogAt = -Infinity;
  let dryRunSkipLogged = false;

  return withOverlapGuard(
    name,
    async () => {
      let decision: SwitchDecision;
      try {
        decision = await resolveSwitch(envMode);
      } catch (error) {
        decision = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      if (!decision.ok) {
        const now = nowMs();
        if (now - lastUnreadableLogAt >= LOG_UNREADABLE_EVERY_MS) {
          lastUnreadableLogAt = now;
          logError(`[${name}] tick skipped: could not read the ${name} switch (${decision.error}); nothing was run`);
        }
        return;
      }
      if (decision.mode === "off") {
        dryRunSkipLogged = false;
        return;
      }
      if (decision.mode === "dry-run" && !supportsDryRun) {
        if (!dryRunSkipLogged) {
          dryRunSkipLogged = true;
          log(`[${name}] switch is dry-run but this job has no dry-run; skipping its ticks until the switch changes`);
        }
        return;
      }
      dryRunSkipLogged = false;

      const mode = decision.mode;
      const record = options.recordRun ?? timerRunRecorder();
      try {
        const summary = await options.run(mode);
        await record(name, { ok: true, mode, summary: summary || undefined }).catch(() => {});
      } catch (error) {
        logError(`[${name}] run failed:`, error);
        await record(name, {
          ok: false,
          mode,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => {});
      }
    },
    log,
    options.overlap,
  );
}
