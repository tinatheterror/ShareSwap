import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The API server and the scheduled-jobs script are two bundles from one build. The script ends with an
// entry-point check that runs its main(); if that code ever ends up in dist/index.mjs, the server runs a
// scheduled-jobs pass at boot (see scheduled-jobs-entrypoint.test.ts for how that happened). This builds
// the real thing with build.mjs, into a scratch directory, and looks inside. No database here.

const packageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_MARKERS = [/isScheduledJobsEntryPoint/, /\[scheduled-jobs\]/, /shareswap:scheduled-jobs/, /run-scheduled-jobs\\\.\(ts\|mjs\|js\)/];

test("the real server bundle contains none of the scheduled-jobs script or its entry check", () => {
  const cache = path.join(packageDir, ".cache");
  mkdirSync(cache, { recursive: true });
  const outDir = mkdtempSync(path.join(cache, "server-bundle-"));
  try {
    const build = spawnSync(process.execPath, ["build.mjs", `--outdir=${outDir}`], {
      cwd: packageDir,
      encoding: "utf8",
      timeout: 240_000,
      env: { ...process.env, BUILD_SHA: "bundle-test" },
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const server = readFileSync(path.join(outDir, "index.mjs"), "utf8");
    const script = readFileSync(path.join(outDir, "run-scheduled-jobs.mjs"), "utf8");

    // The control: the script's own bundle really does contain them, so the markers can find them.
    for (const marker of SCRIPT_MARKERS) assert.ok(marker.test(script), `control: ${marker} is in the script bundle`);
    // The server: none of it.
    for (const marker of SCRIPT_MARKERS) assert.ok(!marker.test(server), `${marker} must not be in dist/index.mjs`);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
