import { defineConfig } from "@playwright/test";
import { enforceTestDatabase } from "../../../lib/db/src/test-database-guard";

// The e2e API server and specs write to the database: refuse to start unless it is approved for tests.
// With TEST_DATABASE_URL set this also points DATABASE_URL at it for every process started below.
enforceTestDatabase(process.env);

// Separate services and one worker: never restart the shared suite's API.
// Run this after the main suite, not concurrently against the same database.
export default defineConfig({
  testDir: ".",
  testMatch: "owner-return-restart.spec.ts",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "line",
  outputDir: "../test-results/restart",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        "/repl/tools/bin/chromium",
    },
  },
  webServer: {
    cwd: "..",
    command: "pnpm --filter @workspace/api-server run build --e2e && PORT=4174 BASE_PATH=/ API_PROXY_TARGET=http://127.0.0.1:4182 pnpm run dev",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});