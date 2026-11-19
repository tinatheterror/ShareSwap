// An optional dead-man's-switch ping for the scheduled job: when HEARTBEAT_URL is set, the job requests it once at the end of
// each run that actually did its work and finished without a failed step. Point an external monitor at it (Healthchecks.io,
// Better Stack, Cronitor, ...) and alert when the pings stop. That catches what nothing inside the app can: the Scheduled
// Deployment not firing, the build broken, or the whole API and database down.
//
//   - Unset or blank: no ping, no log line.
//   - Pinged only after a real run that finished cleanly. Not after a report-only (--dry-run) run, not after a run skipped
//     because another run held the lock (that run reports for itself, and a hung one is killed by the 5-minute timeout), and
//     not after a run with a failed step, so the monitor goes quiet when something is wrong.
//   - A failed ping never fails the run. The URL is a secret (monitors put the token in it), so it is never logged: only the
//     host and the outcome are.

export const HEARTBEAT_TIMEOUT_MS = 5_000;

export interface HeartbeatReport {
  skipped: boolean;
  exitCode: 0 | 1;
}

export interface HeartbeatDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

/** The URL to ping, or null when it is unset, blank, or not http(s). */
export function heartbeatUrl(raw: string | undefined): URL | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Requests the URL once. Returns true on a 2xx answer; never throws. */
export async function pingHeartbeat(raw: string | undefined, deps: HeartbeatDeps = {}): Promise<boolean> {
  const url = heartbeatUrl(raw);
  const logError = deps.logError ?? ((line: string) => console.error(line));
  if (!url) {
    if (raw?.trim()) logError("[scheduled-jobs] HEARTBEAT_URL is set but is not an http(s) URL; no heartbeat sent");
    return false;
  }
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, { method: "GET", signal: AbortSignal.timeout(deps.timeoutMs ?? HEARTBEAT_TIMEOUT_MS) });
    if (!response.ok) {
      logError(`[scheduled-jobs] heartbeat to ${url.host} answered ${response.status}`);
      return false;
    }
    (deps.log ?? ((line: string) => console.log(line)))(`[scheduled-jobs] heartbeat sent to ${url.host}`);
    return true;
  } catch (error) {
    logError(`[scheduled-jobs] heartbeat to ${url.host} failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** The end-of-run hook: pings only after a real run that finished cleanly. */
export async function heartbeatAfterRun(
  report: HeartbeatReport,
  options: { reportOnly: boolean; env: NodeJS.ProcessEnv },
  deps: HeartbeatDeps = {},
): Promise<boolean> {
  if (options.reportOnly || report.skipped || report.exitCode !== 0) return false;
  return pingHeartbeat(options.env.HEARTBEAT_URL, deps);
}
