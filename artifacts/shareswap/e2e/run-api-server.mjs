import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

const logPath = process.env.E2E_API_SERVER_LOG;

if (!logPath) {
  throw new Error("E2E_API_SERVER_LOG is required");
}

mkdirSync(dirname(logPath), { recursive: true });
const log = createWriteStream(logPath, { flags: "w" });
const command = process.env.E2E_API_SERVER_COMMAND ?? "pnpm";
const args = process.env.E2E_API_SERVER_ARGS
  ? JSON.parse(process.env.E2E_API_SERVER_ARGS)
  : ["--filter", "@workspace/api-server", "run", "dev"];
const child = spawn(
  command,
  args,
  { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);

for (const [streamName, source, destination] of [
  ["stdout", child.stdout, process.stdout],
  ["stderr", child.stderr, process.stderr],
]) {
  let buffered = "";
  source.on("data", (chunk) => {
    destination.write(chunk);
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      log.write(`${JSON.stringify({ stream: streamName, message: line })}\n`);
    }
  });
  source.on("end", () => {
    if (buffered) {
      log.write(`${JSON.stringify({ stream: streamName, message: buffered })}\n`);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  log.end(`${JSON.stringify({ stream: "process", message: error.stack ?? error.message })}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  log.end(() => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
});