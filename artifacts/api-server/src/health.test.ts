import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import healthRouter from "./routes/health.js";

test("/healthz reports status and the build identity", async () => {
  const app = express();
  app.use("/api", healthRouter);
  const server = createServer(app).listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api/healthz`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; build: { sha: string; builtAt: string | null } };
    assert.equal(body.status, "ok");
    assert.equal(typeof body.build.sha, "string");
    assert.ok(body.build.sha.length > 0);
  } finally {
    server.close();
  }
});
