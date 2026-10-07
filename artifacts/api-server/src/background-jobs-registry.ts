export interface StopResult {
  /** Names of runs that were still in flight when the wait ran out. */
  timedOut: string[];
  /** How many runs were in flight when stopping began. */
  waitedFor: number;
}

/**
 * Every in-process timer registers its handle here, and every guarded run registers its promise,
 * so a shutdown can stop new ticks, clear what is scheduled, and wait for what is running.
 */
export class BackgroundJobRegistry {
  private clears = new Set<() => void>();
  private inFlight = new Map<Promise<unknown>, string>();
  private stopping = false;
  private stopResult: Promise<StopResult> | null = null;

  isStopping(): boolean {
    return this.stopping;
  }

  /** Same as setTimeout, but cleared by stop(). Refuses (returns null) once stopping. */
  setTimeout(run: () => void, ms: number): unknown {
    if (this.stopping) return null;
    let clear: () => void;
    const handle = setTimeout(() => {
      this.clears.delete(clear);
      run();
    }, ms);
    clear = () => clearTimeout(handle);
    this.clears.add(clear);
    return handle;
  }

  /** Same as setInterval, but cleared by stop(). Refuses (returns null) once stopping. */
  setInterval(run: () => void, ms: number): unknown {
    if (this.stopping) return null;
    const handle = setInterval(run, ms);
    this.clears.add(() => clearInterval(handle));
    return handle;
  }

  /** Remembers a run until it settles so stop() can wait for it. */
  trackRun<T>(name: string, run: Promise<T>): Promise<T> {
    this.inFlight.set(run, name);
    const forget = () => void this.inFlight.delete(run);
    run.then(forget, forget);
    return run;
  }

  /** Number of runs currently tracked. */
  inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * Stops new ticks, clears every scheduled timer, then waits up to `timeoutMs` for the runs that
   * are already going. Safe to call more than once: later calls return the first call's result.
   */
  stop(options: { timeoutMs: number }): Promise<StopResult> {
    if (this.stopResult) return this.stopResult;
    this.stopping = true;
    for (const clear of this.clears) clear();
    this.clears.clear();
    const running = [...this.inFlight.entries()];
    this.stopResult = (async () => {
      if (running.length === 0) return { timedOut: [], waitedFor: 0 };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), options.timeoutMs);
      });
      const settled = Promise.allSettled(running.map(([promise]) => promise)).then(() => "settled" as const);
      const outcome = await Promise.race([settled, timeout]);
      if (timer) clearTimeout(timer);
      if (outcome === "settled") return { timedOut: [], waitedFor: running.length };
      const stillRunning = running.filter(([promise]) => this.inFlight.has(promise)).map(([, name]) => name);
      return { timedOut: stillRunning, waitedFor: running.length };
    })();
    return this.stopResult;
  }
}

/** The process-wide registry used by the real timers. Tests make their own. */
export const backgroundJobs = new BackgroundJobRegistry();
