export type ServerOutputFinding = {
  stream: string;
  message: string;
};

// Keep this list narrow: these are expected test/startup conditions, not broad
// error classes. Add an entry only when the condition is intentionally harmless.
export const API_SERVER_ERROR_ALLOWLIST: RegExp[] = [
  /E2E simulated owner-return fixture setup failure/i,
];

const DATABASE_ERROR =
  /\b(database|postgres|postgresql|drizzle|relation|column|constraint|SQLSTATE|ECONNREFUSED|connection terminated)\b/i;
const ERROR_INDICATOR =
  /\b(error|failed|failure|fatal|exception|does not exist|violat(?:e|es|ed|ion)|timeout)\b/i;
const UNHANDLED_ERROR =
  /\b(unhandledRejection|uncaughtException|UnhandledPromiseRejection|Server error|Failed to apply startup database migrations)\b/i;

function isStructuredServerError(message: string): boolean {
  try {
    const record = JSON.parse(message) as { level?: number; msg?: string };
    if (
      typeof record.level === "number" &&
      record.level >= 50 &&
      !API_SERVER_ERROR_ALLOWLIST.some((pattern) =>
        pattern.test(`${record.msg ?? ""} ${message}`),
      )
    ) {
      return true;
    }
  } catch {
    // Most development output is pretty-printed rather than JSON.
  }
  return false;
}

export function findUnexpectedServerOutput(logContents: string): ServerOutputFinding[] {
  const findings: ServerOutputFinding[] = [];

  for (const line of logContents.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let entry: ServerOutputFinding;
    try {
      entry = JSON.parse(line) as ServerOutputFinding;
    } catch {
      entry = { stream: "unknown", message: line };
    }

    const message = entry.message ?? "";
    if (API_SERVER_ERROR_ALLOWLIST.some((pattern) => pattern.test(message))) {
      continue;
    }

    if (
      isStructuredServerError(message) ||
      UNHANDLED_ERROR.test(message) ||
      (DATABASE_ERROR.test(message) && ERROR_INDICATOR.test(message))
    ) {
      findings.push(entry);
    }
  }

  return findings;
}