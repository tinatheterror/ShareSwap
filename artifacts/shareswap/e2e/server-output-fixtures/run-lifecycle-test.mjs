import { spawnSync } from "node:child_process";

const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "--config", "e2e/server-output.lifecycle.config.ts"],
  { cwd: process.cwd(), encoding: "utf8" },
);
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

if (result.status === 0) {
  console.error(output);
  throw new Error("Expected the lifecycle fixture Playwright command to fail");
}

for (const expected of [
  "startup database relation does not exist",
  "request database column does not exist",
]) {
  if (!output.includes(expected)) {
    console.error(output);
    throw new Error(`Lifecycle failure output did not include: ${expected}`);
  }
}

console.log("Lifecycle fixture correctly failed on startup and request database errors.");