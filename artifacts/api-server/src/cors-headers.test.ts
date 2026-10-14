import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import app from "./app.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

// A browser sends this preflight before every credentialed POST that carries custom headers. If the answer
// leaves a header out, the browser blocks the real request and the app shows "Failed to fetch".
test("the CORS preflight allows every header the clients send, including x-app-version and x-app-build", async () => {
  const sent = ["content-type", "x-csrf-token", "x-app-version", "x-app-build"];
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "OPTIONS",
    headers: {
      origin: "https://shareswap.example.replit.app",
      "access-control-request-method": "POST",
      "access-control-request-headers": sent.join(","),
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://shareswap.example.replit.app");
  const allowed = (response.headers.get("access-control-allow-headers") ?? "").toLowerCase().split(",").map((h) => h.trim());
  for (const header of sent) assert.ok(allowed.includes(header), `${header} must be allowed, got ${allowed.join(",")}`);
});
