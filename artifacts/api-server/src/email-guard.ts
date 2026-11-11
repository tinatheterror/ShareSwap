import { isTestProcess } from "@workspace/db/test-database-guard";
import { isProductionRuntime } from "./non-production-gate";

/**
 * Where outgoing email goes. Same idea as the database and storage guards.
 *
 *   - Test process (node:test child, e2e API server, a *.test.ts run directly, NODE_ENV=test): "fake". Messages are recorded in
 *     memory (see sentMail in mail.ts) and Resend is never called. EMAIL_MODE=live in a test process is refused, not honoured.
 *   - Production (NODE_ENV=production or a Replit deployment): "live" unless EMAIL_MODE=log.
 *   - Everywhere else (the workspace, local dev): "log" unless EMAIL_MODE=live. A log-mode message is printed to the console
 *     (recipient masked) and nothing is sent.
 */
export class EmailGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailGuardError";
  }
}

export type EmailMode = "fake" | "log" | "live";
type Env = Record<string, string | undefined>;

export function chooseEmailMode(env: Env = process.env, testProcess: boolean = isTestProcess(env as NodeJS.ProcessEnv), production: boolean = isProductionRuntime(env as NodeJS.ProcessEnv)): EmailMode {
  const requested = env.EMAIL_MODE?.trim().toLowerCase() || undefined;
  if (requested !== undefined && requested !== "log" && requested !== "live") {
    throw new EmailGuardError(`EMAIL_MODE must be "log" or "live" (got "${requested}").`);
  }
  if (testProcess) {
    if (requested === "live") throw new EmailGuardError("Refusing to send real email from a test process: EMAIL_MODE=live is not allowed in tests.");
    return "fake";
  }
  return requested ?? (production ? "live" : "log");
}

/** Called right before the Resend request: a test process must never get this far. */
export function assertRealSendAllowed(env: Env = process.env, testProcess: boolean = isTestProcess(env as NodeJS.ProcessEnv)) {
  if (testProcess) throw new EmailGuardError("Refusing to call Resend from a test process.");
}
