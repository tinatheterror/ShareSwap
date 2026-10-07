// Child process for shutdown-process.test.ts: one real timer tick, the real signal installer, fake server/pool.
import http from "node:http";
import { BackgroundJobRegistry } from "../background-jobs-registry";
import { withOverlapGuard } from "../overlap-guard";
import { installShutdownHandlers } from "../shutdown";

const mode = process.argv[2] ?? "finish"; // "finish": a tick takes 400ms; "hang": a tick never ends
const registry = new BackgroundJobRegistry();
const server = http.createServer().listen(0, "127.0.0.1");
let ticks = 0;

const tick = withOverlapGuard(
  "demo-tick",
  async () => {
    ticks++;
    console.log(`TICK_STARTED ${ticks}`);
    if (mode === "hang") await new Promise(() => {});
    else await new Promise((resolve) => setTimeout(resolve, 400));
    console.log(`TICK_FINISHED ${ticks}`);
  },
  () => {},
  { registry },
);
registry.setInterval(() => void tick(), 100);

installShutdownHandlers(process, {
  registry,
  closeServer: () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections?.();
    }),
  closePool: async () => {
    console.log("POOL_CLOSED");
  },
  exit: (code) => process.exit(code),
  log: (line) => console.log(line),
  jobsTimeoutMs: Number(process.env.JOBS_TIMEOUT_MS ?? 3000),
  hardTimeoutMs: 8000,
});
console.log("READY");
