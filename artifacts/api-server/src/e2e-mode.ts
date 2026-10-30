/** E2E-only routes and hooks: on only with E2E_TEST_MODE=true, and never in a production process. */
export const e2eTestModeEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.E2E_TEST_MODE === "true" && env.NODE_ENV !== "production";
