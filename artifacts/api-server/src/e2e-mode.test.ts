import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Client, startApp } from "./auth-test-client.js";
import { e2eTestModeEnabled } from "./e2e-mode.js";

test("e2e mode needs E2E_TEST_MODE=true and is never on in production", () => {
  assert.equal(e2eTestModeEnabled({ E2E_TEST_MODE: "true", NODE_ENV: "development" }), true);
  assert.equal(e2eTestModeEnabled({ E2E_TEST_MODE: "true" }), true);
  assert.equal(e2eTestModeEnabled({ E2E_TEST_MODE: "true", NODE_ENV: "production" }), false);
  assert.equal(e2eTestModeEnabled({ NODE_ENV: "development" }), false);
  assert.equal(e2eTestModeEnabled({ E2E_TEST_MODE: "false" }), false);
});

const saved = { mode: process.env.E2E_TEST_MODE, env: process.env.NODE_ENV };
let closeServer: (() => Promise<void>) | undefined;
after(async () => {
  await closeServer?.();
  if (saved.mode === undefined) delete process.env.E2E_TEST_MODE; else process.env.E2E_TEST_MODE = saved.mode;
  if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
});

test("the /api/e2e routes 404 in production even when E2E_TEST_MODE is set", async () => {
  process.env.E2E_TEST_MODE = "true";
  process.env.NODE_ENV = "production";
  const { baseUrl, close } = await startApp();
  closeServer = close;
  const client = new Client(baseUrl);
  await client.fetchCsrfToken();
  for (const path of ["", "/cleanup", "/records", "/setup-barrier"]) {
    const res = await client.post(`/api/e2e/owner-return-fixture${path}`, {});
    assert.equal(res.status, 404, `POST /api/e2e/owner-return-fixture${path}`);
  }
});
