import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, notifications, pool, users, verifications } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { isProductionRuntime, nonProductionOnly } from "./non-production-gate.js";
import { registerRoutes } from "./routes/routes.js";

const UNIQUE = `verify-approve-gate-${Date.now()}`;
const PASSWORD = "VerifyApproveGate!42";
const userIds: number[] = [];

let baseUrl: string;
let closeServer: () => Promise<void>;
let userId: number;
const cookies = new Map<string, string>();
let csrfToken = "";

async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("x-forwarded-proto", "https");
  if (cookies.size) {
    headers.set("cookie", [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
  }
  if (csrfToken && init.method && init.method !== "GET") headers.set("x-csrf-token", csrfToken);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  return response;
}

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function verificationStatus() {
  const [row] = await db.select({ status: verifications.status }).from(verifications).where(eq(verifications.userId, userId));
  return row.status;
}

before(async () => {
  const [user] = await db
    .insert(users)
    .values({ username: UNIQUE, password: await hashPassword(PASSWORD), emailVerified: true })
    .returning({ id: users.id, username: users.username });
  userId = user.id;
  userIds.push(user.id);
  await db.insert(verifications).values({ userId: user.id, status: "pending" });

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  const login = await call("/api/login", { method: "POST", body: JSON.stringify({ username: user.username, password: PASSWORD }) });
  assert.equal(login.status, 200);
  const csrf = await call("/api/csrf-token");
  csrfToken = ((await csrf.json()) as { csrfToken: string }).csrfToken;
});

after(async () => {
  if (userIds.length) {
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
    await db.delete(verifications).where(inArray(verifications.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
  }
  if (closeServer) await closeServer();
  await pool.end();
});

test("isProductionRuntime fails closed on NODE_ENV=production or a Replit deployment", () => {
  assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: "development", REPLIT_DEPLOYMENT: "1" }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: "development" }), false);
  assert.equal(isProductionRuntime({}), false);
});

test("POST /api/verify/approve is a 404 in production and leaves the verification untouched", async () => {
  for (const env of [{ NODE_ENV: "production", REPLIT_DEPLOYMENT: undefined }, { NODE_ENV: "development", REPLIT_DEPLOYMENT: "1" }]) {
    const response = await withEnv(env, () => call("/api/verify/approve", { method: "POST", body: "{}" }));
    assert.equal(response.status, 404);
    assert.equal(await verificationStatus(), "pending");
  }
});

test("nonProductionOnly lets the request through outside production", async () => {
  let passed = false;
  let status: number | undefined;
  const res = { sendStatus: (code: number) => { status = code; } } as any;
  await withEnv({ NODE_ENV: "development", REPLIT_DEPLOYMENT: undefined }, async () => {
    nonProductionOnly({} as any, res, () => { passed = true; });
  });
  assert.equal(passed, true);
  assert.equal(status, undefined);
});
