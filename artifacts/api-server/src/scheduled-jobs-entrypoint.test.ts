import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { isScheduledJobsEntryPoint } from "./scripts/run-scheduled-jobs";

// scripts/run-scheduled-jobs.ts runs main() when it is the entry point. Bundled into the API server
// (one file, so import.meta.url === process.argv[1]) it used to run inside the server at boot and
// then process.exit(). No database here.

const srcDir = path.dirname(fileURLToPath(import.meta.url));
// Bundles go under the package (git-ignored .cache) so their external imports resolve from its node_modules.
const scratchRoot = path.join(srcDir, "..", ".cache");
const scratchDir = () => {
  mkdirSync(scratchRoot, { recursive: true });
  return mkdtempSync(path.join(scratchRoot, "entrypoint-"));
};

test("the entry-point check needs both the script's name and a matching URL", () => {
  const script = "/app/dist/run-scheduled-jobs.mjs";
  assert.equal(isScheduledJobsEntryPoint(pathToFileURL(script).href, script), true);
  const ts = "/app/src/scripts/run-scheduled-jobs.ts";
  assert.equal(isScheduledJobsEntryPoint(pathToFileURL(ts).href, ts), true);
  // The API server bundle: URL equals argv[1], but it is not the script.
  const server = "/app/dist/index.mjs";
  assert.equal(isScheduledJobsEntryPoint(pathToFileURL(server).href, server), false);
  // Right name, but this module was loaded from somewhere else.
  assert.equal(isScheduledJobsEntryPoint(pathToFileURL("/app/dist/index.mjs").href, script), false);
  assert.equal(isScheduledJobsEntryPoint("file:///x/run-scheduled-jobs.mjs", undefined), false);
  assert.equal(isScheduledJobsEntryPoint("file:///x/not-run-scheduled-jobs.mjs", "/x/not-run-scheduled-jobs.mjs"), false);
});

async function bundle(entry: string, outName: string, outDir: string) {
  const outfile = path.join(outDir, outName);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    // Like build.mjs: everything is bundled (a one-file server) except a few optional native packages.
    external: ["pg-native", "*.node", "bufferutil", "utf-8-validate", "sharp", "nodemailer", "@aws-sdk/*", "stripe-replit-sync", "@replit/object-storage", "handlebars", "@google-cloud/*", "@google/*", "googleapis", "playwright", "puppeteer", "puppeteer-core"],
    banner: { js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);" },
  });
  return outfile;
}

function run(file: string, args: string[] = []) {
  return spawnSync(process.execPath, [file, ...args], {
    // A DATABASE_URL that nothing listens on (importing the db module needs one); no other secrets.
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: "postgresql://nobody@127.0.0.1:1/none" },
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("the expiry timer's bundle does not contain the scheduled-jobs script at all", async () => {
  const dir = scratchDir();
  try {
    const entry = path.join(dir, "server-entry.ts");
    writeFileSync(entry, `import ${JSON.stringify(path.join(srcDir, "request-expiry-timer.ts"))};\nconsole.log("SERVER_LOADED");\n`);
    const out = await bundle(entry, "index.mjs", dir);
    const code = readFileSync(out, "utf8");
    assert.ok(!code.includes("[scheduled-jobs]"), "the server must not pull in scripts/run-scheduled-jobs.ts");
    const result = run(out);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /SERVER_LOADED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("even a server-style bundle that does include the script (named like the server) does not run its main()", async () => {
  const dir = scratchDir();
  try {
    const entry = path.join(dir, "server-entry.ts");
    writeFileSync(
      entry,
      `import ${JSON.stringify(path.join(srcDir, "scripts", "run-scheduled-jobs.ts"))};\nconsole.log("SERVER_LOADED");\n`,
    );
    const out = await bundle(entry, "index.mjs", dir); // argv[1] is the bundle itself, so its import.meta.url matches
    assert.ok(readFileSync(out, "utf8").includes("[scheduled-jobs]"), "this bundle really contains the script");
    const result = run(out);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /SERVER_LOADED/);
    assert.doesNotMatch(result.stdout + result.stderr, /scheduled-jobs\] (FATAL|DRY)|missing required secret/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the script itself, started directly, still runs main()", () => {
  // argv[1] is the script, so the entry-point check passes; with no DATABASE_URL it stops at the secrets check.
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(srcDir, "scripts", "run-scheduled-jobs.ts"), "--dry-run"], {
    cwd: path.join(srcDir, ".."),
    env: { PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /\[scheduled-jobs\] FATAL: missing required secret\(s\): DATABASE_URL/);
});
