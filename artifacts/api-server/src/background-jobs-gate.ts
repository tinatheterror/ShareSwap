export interface BackgroundJobsDecision {
  enabled: boolean;
  /** Why, for the boot log. */
  reason: string;
}

const isSet = (raw: string | undefined) => {
  const value = raw?.trim().toLowerCase();
  return Boolean(value) && value !== "0" && value !== "false";
};

/**
 * The in-process timers (return recovery, overdue reminders, handoff sweep, request-expiry timer,
 * rate-limit cleanup) act on whatever database DATABASE_URL names, so they run only in a deployment
 * (REPLIT_DEPLOYMENT set) or when someone opts in with BACKGROUND_JOBS=on. BACKGROUND_JOBS=off wins
 * over everything, deployment included. Any other BACKGROUND_JOBS value is ignored.
 */
export function backgroundJobsDecision(env: NodeJS.ProcessEnv = process.env): BackgroundJobsDecision {
  const explicit = env.BACKGROUND_JOBS?.trim().toLowerCase();
  if (explicit === "off") return { enabled: false, reason: "BACKGROUND_JOBS=off" };
  if (explicit === "on") return { enabled: true, reason: "BACKGROUND_JOBS=on" };
  if (isSet(env.REPLIT_DEPLOYMENT)) return { enabled: true, reason: "REPLIT_DEPLOYMENT is set" };
  const ignored = explicit ? ` (ignoring unrecognized BACKGROUND_JOBS=${JSON.stringify(explicit)})` : "";
  return { enabled: false, reason: `not a deployment and BACKGROUND_JOBS is not on${ignored}` };
}

export function shouldRunBackgroundJobs(env: NodeJS.ProcessEnv = process.env): boolean {
  return backgroundJobsDecision(env).enabled;
}

/** The one boot line saying whether the timers run, and why. */
export function backgroundJobsBootLine(env: NodeJS.ProcessEnv = process.env): string {
  const decision = backgroundJobsDecision(env);
  return decision.enabled
    ? `[background-jobs] ON (${decision.reason})`
    : `[background-jobs] OFF (${decision.reason}; set BACKGROUND_JOBS=on to opt in)`;
}
