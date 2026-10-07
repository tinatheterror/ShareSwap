import { backgroundJobs, type BackgroundJobRegistry } from "./background-jobs-registry";

export interface OverlapGuardOptions {
  /** Where runs are tracked so a shutdown can wait for them. Defaults to the process-wide registry. */
  registry?: Pick<BackgroundJobRegistry, "isStopping" | "trackRun">;
  /**
   * Off by default (a run that never settles keeps the timer skipping). When set, a run still going
   * after this many ms is abandoned: the next tick starts a new run beside it. The old run is not
   * cancelled (nothing can cancel a pending query or Stripe call), so only use this where overlapping
   * runs are safe, and only one abandoned run is allowed at a time.
   */
  staleAfterMs?: number;
  /** Clock in ms, for tests. Defaults to Date.now. */
  now?: () => number;
  /** Where abandon/cap messages go. Defaults to console.error. */
  logError?: (line: string) => void;
}

export interface OverlapGuarded<A extends unknown[], R> {
  (...args: A): Promise<R | undefined>;
  /** True while a (non-abandoned) call is in flight. */
  isRunning(): boolean;
  /** Ticks skipped because the previous call had not finished. */
  skippedCount(): number;
  /** Runs abandoned for being stale, in total. */
  abandonedCount(): number;
}

interface RunState {
  startedAt: number;
  abandoned: boolean;
}

/**
 * In-flight flag for a timer: while the previous call is still running, a new call is skipped
 * (logged, resolves undefined) instead of starting a second run beside it. The flag is cleared
 * when the call settles, including when it throws (the error still reaches the caller).
 *
 * With `staleAfterMs`, a call that finds the previous run older than that abandons it and starts a
 * new run. At most one abandoned run may still be unfinished: if the new run also goes stale while
 * the abandoned one is still going, ticks are skipped again (and logged as errors), so a hung
 * dependency cannot pile up runs or exhaust the pool. A late-settling abandoned run never clears
 * the newer run's flag.
 *
 * Once the registry is stopping (shutdown), calls are ignored silently, and runs are tracked so the
 * shutdown can wait for them.
 */
export function withOverlapGuard<A extends unknown[], R>(
  name: string,
  run: (...args: A) => Promise<R> | R,
  log: (line: string) => void = console.warn,
  options: OverlapGuardOptions = {},
): OverlapGuarded<A, R> {
  const registry = options.registry ?? backgroundJobs;
  const now = options.now ?? Date.now;
  const logError = options.logError ?? console.error;
  const staleAfterMs = options.staleAfterMs;
  let current: RunState | null = null;
  let abandonedOutstanding = 0;
  let abandonedTotal = 0;
  let skipped = 0;

  const guarded = (async (...args: A) => {
    if (registry.isStopping()) return undefined;
    const startedAt = now();
    if (current) {
      const age = startedAt - current.startedAt;
      if (staleAfterMs === undefined || age < staleAfterMs) {
        skipped++;
        log(`[${name}] previous run still in progress; skipping this tick (${skipped} skipped so far)`);
        return undefined;
      }
      if (abandonedOutstanding >= 1) {
        skipped++;
        logError(
          `[${name}] run has been going for ${age}ms (staleAfterMs=${staleAfterMs}) and an earlier abandoned run has not finished either; skipping this tick (${skipped} skipped so far)`,
        );
        return undefined;
      }
      current.abandoned = true;
      abandonedOutstanding++;
      abandonedTotal++;
      logError(
        `[${name}] previous run still going after ${age}ms (staleAfterMs=${staleAfterMs}); abandoning it and starting a new run`,
      );
      current = null;
    }
    const state: RunState = { startedAt, abandoned: false };
    current = state;
    const work = (async () => run(...args))(); // starts synchronously; a sync throw becomes a rejection
    registry.trackRun(name, work.then(() => undefined, () => undefined));
    try {
      return await work;
    } finally {
      if (state.abandoned) abandonedOutstanding--;
      else if (current === state) current = null;
    }
  }) as OverlapGuarded<A, R>;
  guarded.isRunning = () => current !== null;
  guarded.skippedCount = () => skipped;
  guarded.abandonedCount = () => abandonedTotal;
  return guarded;
}
