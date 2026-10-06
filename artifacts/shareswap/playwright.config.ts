import { defineConfig } from "@playwright/test";
import { enforceTestDatabase } from "../../lib/db/src/test-database-guard";

// The e2e API server and specs write to the database: refuse to start unless it is approved for tests.
// With TEST_DATABASE_URL set this also points DATABASE_URL at it for every process started below.
enforceTestDatabase(process.env);

const apiServerLogPath = "test-results/api-server.log";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["server-output-fixtures/**", "owner-return-restart.spec.ts"],
  globalTeardown: "./e2e/server-output.global-teardown.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        "/repl/tools/bin/chromium",
    },
  },
  webServer: [
    {
      command:
        `PORT=4180 E2E_TEST_MODE=true E2E_API_SERVER_LOG=${apiServerLogPath} node e2e/run-api-server.mjs`,
      url: "http://127.0.0.1:4180/api/csrf-token",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        "PORT=4173 BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:4180 pnpm --filter @workspace/shareswap run dev",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});