import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { inArray } from "drizzle-orm";
import { db, pool, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// Auth is set up exactly once by registerRoutes (setupAuth), ahead of every route that reads req.user.
// These run against the full app (app.ts + registerRoutes) the way production does.

const UNIQUE = `auth-wiring-${Date.now()}`;
const PASSWORD = "AuthWiring!42";
const userIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
const previousGoogle = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };

class Client {
  private cookies = new Map<string, string>();
  private csrfToken = "";

  private async send(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("x-forwarded-proto", "https");
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";", 1);
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return response;
  }

  get(path: string) {
    return this.send(path);
  }

  async post(path: string, body: unknown = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  async fetchCsrfToken() {
    this.csrfToken = ((await (await this.get("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
  }
}

before(async () => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const [user] = await db
    .insert(users)
    .values({ username: UNIQUE, password: await hashPassword(PASSWORD), emailVerified: true })
    .returning({ id: users.id });
  userIds.push(user.id);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

after(async () => {
  try {
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    for (const [name, value] of [["GOOGLE_CLIENT_ID", previousGoogle.id], ["GOOGLE_CLIENT_SECRET", previousGoogle.secret]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await closeServer?.();
    await pool.end();
  }
});

test("signed out, protected routes answer 401 (reads and writes)", async () => {
  const client = new Client();
  await client.fetchCsrfToken();
  for (const path of [
    "/api/user",
    "/api/requests",
    "/api/inbox",
    "/api/conversations",
    "/api/notifications",
    "/api/extensions/active",
    "/api/subscription/status",
    "/api/payment-method",
  ]) {
    const response = await client.get(path);
    assert.equal(response.status, 401, `GET ${path}`);
  }
  for (const path of ["/api/subscription/portal", "/api/subscription/checkout", "/api/notifications/check-return-reminders", "/api/requests/check-handoff-deadlines"]) {
    const response = await client.post(path, { tier: "pro" });
    assert.equal(response.status, 401, `POST ${path}`);
  }
});

test("login with a wrong password is refused, with the right one it signs in; logout signs out", async () => {
  const client = new Client();
  assert.equal((await client.post("/api/login", { username: UNIQUE, password: "nope" })).status, 401);
  assert.equal((await client.get("/api/user")).status, 401);

  const login = await client.post("/api/login", { username: UNIQUE, password: PASSWORD });
  assert.equal(login.status, 200);
  const me = await client.get("/api/user");
  assert.equal(me.status, 200);
  assert.equal(((await me.json()) as { username: string }).username, UNIQUE);

  await client.fetchCsrfToken();
  const logout = await client.post("/api/logout");
  assert.equal(logout.status, 200);
  assert.equal((await client.get("/api/user")).status, 401);
  assert.equal((await client.get("/api/requests")).status, 401);
});

test("Google sign-in sends the browser to Google, and the callback without a code does not sign anyone in", async () => {
  const client = new Client();
  const start = await client.get("/api/auth/google");
  assert.equal(start.status, 302);
  const location = new URL(start.headers.get("location") ?? "");
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("client_id"), process.env.GOOGLE_CLIENT_ID);

  const callback = await client.get("/api/auth/google/callback");
  assert.ok(callback.status >= 300 && callback.status < 400, `callback status ${callback.status}`);
  assert.equal((await client.get("/api/user")).status, 401);
});

test("the session and passport middleware are each registered once", () => {
  const names = ((app as unknown as { router: { stack: { name: string }[] } }).router.stack).map((layer) => layer.name);
  for (const name of ["session", "initialize", "authenticate"]) {
    assert.equal(names.filter((n) => n === name).length, 1, `${name} middleware`);
  }
});

test("the handoff-deadline sweep needs sign-in and runs once a minute per user", async () => {
  const signedOut = new Client();
  await signedOut.fetchCsrfToken();
  assert.equal((await signedOut.post("/api/requests/check-handoff-deadlines")).status, 401);
  // A refused signed-out call does not use up anyone's allowance.
  const client = new Client();
  assert.equal((await client.post("/api/login", { username: UNIQUE, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  const first = await client.post("/api/requests/check-handoff-deadlines");
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys((await first.json()) as object).sort(), ["autoAdvancedCount", "bothSilentCount", "depositExpiredCount", "flaggedCount", "mode", "success", "wouldChangeCount"]);
  const second = await client.post("/api/requests/check-handoff-deadlines");
  assert.equal(second.status, 429);
  assert.match(((await second.json()) as { error: string }).error, /try again/i);
});
