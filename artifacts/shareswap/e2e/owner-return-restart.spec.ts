import { test, expect, type APIRequestContext } from "@playwright/test";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  cleanupOwnerReturnFixture, completeReturnWithReview, countFixtureRecords,
  emptyFixtureRecords, expectPostReturnActivity, suppressReturnReminderChecks,
  type OwnerReturnFixture,
} from "./owner-return-helpers";
import { findUnexpectedServerOutput } from "./server-output";

const exec = promisify(execFile);
const logPath = resolve("test-results/restart-api-server.log");

class RestartableApi {
  child?: ChildProcess;

  async start(request: APIRequestContext) {
    this.child = spawn(process.execPath, ["e2e/run-api-server.mjs"], {
      env: {
        ...process.env,
        PORT: "4182",
        NODE_ENV: "development",
        E2E_TEST_MODE: "true",
        E2E_API_SERVER_LOG: logPath,
        E2E_API_SERVER_LOG_APPEND: "true",
        // Spawn the actual API executable, not pnpm's multi-process dev tree.
        E2E_API_SERVER_COMMAND: process.execPath,
        E2E_API_SERVER_ARGS: JSON.stringify([
          "--enable-source-maps", resolve("../api-server/dist/index.mjs"),
        ]),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const child = this.child;
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    await expect.poll(async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Restart API exited before readiness: ${stderr}`);
      }
      try {
        return (await request.get("http://127.0.0.1:4182/api/csrf-token", {
          timeout: 1_000,
        })).ok();
      } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
  }

  async stop() {
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
    try {
      await exited;
    } finally {
      clearTimeout(timeout);
      this.child = undefined;
    }
  }
}

async function renameControl(action: "preserve" | "restore", fixture: OwnerReturnFixture) {
  await exec("pnpm", ["exec", "tsx", "e2e/restart-control.ts", action, fixture.fixtureId], {
    cwd: resolve("../api-server"),
    env: { ...process.env, E2E_TEST_MODE: "true" },
    timeout: 30_000,
  });
}

test("a real API restart clears an abandoned completed return but preserves unrelated rewards", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const api = new RestartableApi();
  let abandoned: OwnerReturnFixture | undefined;
  let control: OwnerReturnFixture | undefined;
  let controlPreserved = false;
  let replacement: OwnerReturnFixture | undefined;
  const setup = async () => {
    const response = await page.request.post("/api/e2e/owner-return-fixture");
    expect(response.ok()).toBe(true);
    return await response.json() as OwnerReturnFixture;
  };

  await rm(logPath, { force: true });
  try {
    await api.start(page.request);
    await suppressReturnReminderChecks(page);
    abandoned = await setup(); // Registered normally; restart must lose the registry.
    control = await setup();
    await completeReturnWithReview(page, abandoned);
    await completeReturnWithReview(page, control);
    const abandonedBefore = await countFixtureRecords(page.request, abandoned);
    const controlBefore = await countFixtureRecords(page.request, control);
    expectPostReturnActivity(abandonedBefore);
    expectPostReturnActivity(controlBefore);
    await renameControl("preserve", control);
    controlPreserved = true;

    // Quiesce browser polling while the API is deliberately offline.
    await page.goto("about:blank");
    const firstPid = api.child!.pid;
    await api.stop();
    await expect(page.request.get("http://127.0.0.1:4182/api/csrf-token", {
      timeout: 1_000,
    })).rejects.toThrow();
    await api.start(page.request);
    expect(api.child!.pid).not.toBe(firstPid);

    // Data survives the restart itself. It is the next setup that recovers it.
    expect(await countFixtureRecords(page.request, abandoned)).toEqual(abandonedBefore);
    expect(await countFixtureRecords(page.request, control)).toEqual(controlBefore);
    const lostRegistry = await page.request.post("/api/e2e/owner-return-fixture/cleanup", {
      data: { fixtureId: abandoned.fixtureId },
    });
    expect(lostRegistry.status()).toBe(204);
    expect(await countFixtureRecords(page.request, abandoned)).toEqual(abandonedBefore);

    replacement = await setup();
    expect(await countFixtureRecords(page.request, abandoned)).toEqual(emptyFixtureRecords);
    expect(await countFixtureRecords(page.request, control)).toEqual(controlBefore);
    for (const credentials of [abandoned.owner, abandoned.borrower]) {
      expect((await page.request.post("/api/login", { data: credentials })).status()).toBe(401);
    }
  } finally {
    // Recover by persistent usernames, not a registry that restart destroyed.
    // This also handles assertions failing before or after the stop.
    try {
      await page.goto("about:blank");
      await api.stop();
      if (controlPreserved && control) await renameControl("restore", control);
      await api.start(page.request);
      const recovery = await setup();
      await cleanupOwnerReturnFixture(page.request, recovery.fixtureId);
      for (const fixture of [abandoned, control, replacement]) {
        if (fixture) {
          expect(await countFixtureRecords(page.request, fixture)).toEqual(emptyFixtureRecords);
        }
      }
    } finally {
      await api.stop();
      const output = await readFile(logPath, "utf8");
      expect(findUnexpectedServerOutput(output), `API output: ${logPath}`).toEqual([]);
    }
  }
});