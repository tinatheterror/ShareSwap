import type { BackgroundJobRegistry, StopResult } from "./background-jobs-registry";

export interface ShutdownDeps {
  registry: Pick<BackgroundJobRegistry, "stop">;
  /** Stop accepting connections and resolve when the server has closed. */
  closeServer: () => Promise<void>;
  /** End the database pool (releases session advisory locks). */
  closePool: () => Promise<void>;
  exit: (code: number) => void;
  log?: (line: string) => void;
  /** Wait for in-flight timer runs. */
  jobsTimeoutMs?: number;
  /** Wait for the HTTP server to close. */
  serverTimeoutMs?: number;
  /** Wait for the pool to end. */
  poolTimeoutMs?: number;
  /** Absolute limit for the whole shutdown, after which the process exits 1. */
  hardTimeoutMs?: number;
}

export const SHUTDOWN_DEFAULTS = {
  jobsTimeoutMs: 15_000,
  serverTimeoutMs: 8_000,
  poolTimeoutMs: 4_000,
  hardTimeoutMs: 30_000,
} as const;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<{ timedOut: boolean; value?: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([work.then((value) => ({ timedOut: false as const, value })), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Returns the handler for SIGTERM/SIGINT. First signal: stop the timers and wait for runs in flight,
 * close the HTTP server, end the pool, exit 0. A second signal, or the hard timeout, exits 1 at once.
 * Each step is bounded and a failing step never stops the later ones.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const log = deps.log ?? console.log;
  const jobsTimeoutMs = deps.jobsTimeoutMs ?? SHUTDOWN_DEFAULTS.jobsTimeoutMs;
  const serverTimeoutMs = deps.serverTimeoutMs ?? SHUTDOWN_DEFAULTS.serverTimeoutMs;
  const poolTimeoutMs = deps.poolTimeoutMs ?? SHUTDOWN_DEFAULTS.poolTimeoutMs;
  const hardTimeoutMs = deps.hardTimeoutMs ?? SHUTDOWN_DEFAULTS.hardTimeoutMs;
  let started = false;

  return async (signal: string) => {
    if (started) {
      log(`[shutdown] ${signal} received again; exiting immediately`);
      deps.exit(1);
      return;
    }
    started = true;
    log(`[shutdown] ${signal} received; stopping background jobs, then the server, then the database pool`);
    const hard = setTimeout(() => {
      log(`[shutdown] still not finished after ${hardTimeoutMs}ms; exiting`);
      deps.exit(1);
    }, hardTimeoutMs);
    hard.unref?.();

    try {
      const jobs = await withTimeout<StopResult>(deps.registry.stop({ timeoutMs: jobsTimeoutMs }), jobsTimeoutMs + 500);
      const result = jobs.value;
      if (jobs.timedOut || (result && result.timedOut.length > 0)) {
        log(`[shutdown] background jobs still running after ${jobsTimeoutMs}ms: ${(result?.timedOut ?? ["unknown"]).join(", ")}; continuing`);
      } else {
        log(`[shutdown] background jobs stopped (${result?.waitedFor ?? 0} run(s) finished)`);
      }
    } catch (error) {
      log(`[shutdown] stopping background jobs failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const server = await withTimeout(deps.closeServer(), serverTimeoutMs);
      log(server.timedOut ? `[shutdown] HTTP server still open after ${serverTimeoutMs}ms; continuing` : "[shutdown] HTTP server closed");
    } catch (error) {
      log(`[shutdown] closing the HTTP server failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const pool = await withTimeout(deps.closePool(), poolTimeoutMs);
      log(pool.timedOut ? `[shutdown] database pool still open after ${poolTimeoutMs}ms; continuing` : "[shutdown] database pool closed");
    } catch (error) {
      log(`[shutdown] closing the database pool failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    clearTimeout(hard);
    log("[shutdown] complete");
    deps.exit(0);
  };
}

/** Registers the handler for SIGTERM and SIGINT on `proc`. */
export function installShutdownHandlers(
  proc: Pick<NodeJS.Process, "on">,
  deps: ShutdownDeps,
): (signal: string) => Promise<void> {
  const shutdown = createShutdown(deps);
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    proc.on(signal, () => void shutdown(signal));
  }
  return shutdown;
}
