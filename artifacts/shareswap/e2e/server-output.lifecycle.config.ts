import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./server-output-fixtures",
  testMatch: "lifecycle.spec.ts",
  outputDir: "/tmp/shareswap-server-output-lifecycle",
  globalTeardown: "./server-output.global-teardown.ts",
  reporter: "line",
  webServer: {
    cwd: "..",
    command:
      'E2E_API_SERVER_LOG=test-results/api-server.log E2E_API_SERVER_COMMAND=node E2E_API_SERVER_ARGS=\'["e2e/server-output-fixtures/failing-api-server.mjs"]\' node e2e/run-api-server.mjs',
    url: "http://127.0.0.1:4191",
    reuseExistingServer: false,
  },
});