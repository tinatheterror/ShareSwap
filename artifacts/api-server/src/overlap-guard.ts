export interface OverlapGuarded<A extends unknown[], R> {
  (...args: A): Promise<R | undefined>;
  /** True while a call is in flight. */
  isRunning(): boolean;
  /** Ticks skipped because the previous call had not finished. */
  skippedCount(): number;
}

/**
 * In-flight flag for a timer: while the previous call is still running, a new call is skipped
 * (logged, resolves undefined) instead of starting a second run beside it. The flag is cleared
 * when the call settles, including when it throws (the error still reaches the caller).
 * A call that never settles keeps the timer skipping, which the skip log makes visible.
 */
export function withOverlapGuard<A extends unknown[], R>(
  name: string,
  run: (...args: A) => Promise<R> | R,
  log: (line: string) => void = console.warn,
): OverlapGuarded<A, R> {
  let running = false;
  let skipped = 0;
  const guarded = (async (...args: A) => {
    if (running) {
      skipped++;
      log(`[${name}] previous run still in progress; skipping this tick (${skipped} skipped so far)`);
      return undefined;
    }
    running = true;
    try {
      return await run(...args);
    } finally {
      running = false;
    }
  }) as OverlapGuarded<A, R>;
  guarded.isRunning = () => running;
  guarded.skippedCount = () => skipped;
  return guarded;
}
