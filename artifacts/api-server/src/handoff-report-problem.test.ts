import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// Either person can report a problem from ACCEPTED or DEPOSIT_CONFIRMED, any time before expiry; it goes straight to
// HANDOFF_DISPUTED with the 24-hour proof window. Behind HANDOFF_REPORT_PROBLEM (on by default).

const UNIQUE = `handoff-report-problem-${Date.now()}`;
const PASSWORD = "ReportProblem!42";
const HOUR = 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let ownerId: number;
let requesterId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;

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
  post(path: string, body: unknown = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body) });
  }
  async signIn(username: string) {
    assert.equal((await this.post("/api/login", { username, password: PASSWORD })).status, 200);
    this.csrfToken = ((await (await this.send("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
    return this;
  }
}
let owner: Client;
let requester: Client;

async function seed(fields: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isAvailable: true, replacementValue: 100, shareCoinsReward: "0", shareCoinPrice: "0",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId, requestType: "SWAP", status: "ACCEPTED", acceptedAt: new Date(),
    ownerConfirmedHandoff: false, borrowerConfirmedHandoff: false,
    ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}
const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const deps = { onSwapAutoConfirmed: async () => {}, onGiftAutoConfirmed: async () => {} };

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  try {
    return await run();
  } finally {
    for (const [k, v] of Object.entries(saved)) (v === undefined ? delete process.env[k] : (process.env[k] = v));
  }
}

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const password = await hashPassword(PASSWORD);
  const [o, r] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, displayName: "Olive Owner", password, emailVerified: true },
    { username: `${UNIQUE}-requester`, displayName: "Remy Requester", password, emailVerified: true },
  ]).returning({ id: users.id });
  ownerId = o.id;
  requesterId = r.id;
  userIds.push(o.id, r.id);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  owner = await new Client().signIn(`${UNIQUE}-owner`);
  requester = await new Client().signIn(`${UNIQUE}-requester`);
});

after(async () => {
  try {
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await pool.query("DELETE FROM reputation_activities WHERE request_id = ANY($1)", [requestIds]);
    }
    if (userIds.length) {
      await pool.query("DELETE FROM user_achievements WHERE user_id = ANY($1)", [userIds]);
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (requestIds.length) await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    await closeServer();
    await pool.end();
  }
});


const ROLES = [["owner", () => owner], ["requester", () => requester]] as const;

for (const type of ["BORROW", "RENT", "SWAP", "GIFT"] as const) {
  for (const status of ["ACCEPTED", "DEPOSIT_CONFIRMED"] as const) {
    for (const [role, client] of ROLES) {
      test(`${type} ${status}: the ${role} reports a problem and it goes straight to HANDOFF_DISPUTED`, async () => {
        const id = await seed({ requestType: type, status });
        const before = Date.now();
        const res = await client().post(`/api/requests/${id}/report-handoff-problem`, { description: "Nobody showed up" });
        assert.equal(res.status, 200);
        assert.equal(((await res.json()) as any).disputeTriggered, true);
        const request = await load(id);
        assert.equal(request.status, "HANDOFF_DISPUTED");
        assert.equal(request.handoffDisputeTriggered, true);
        const left = request.handoffProofDeadline!.getTime() - before;
        assert.ok(left > 23.9 * HOUR && left < 24.1 * HOUR, "a 24 hour proof window");
        assert.equal(role === "owner" ? request.ownerDeniedHandoff : request.borrowerDeniedHandoff, true);
        assert.equal(role === "owner" ? request.handoffProofOwner : request.handoffProofBorrower, "Nobody showed up");
        const notes = (await db.select().from(notifications).where(eq(notifications.requestId, id))).filter((n) => n.type === "handoff_dispute");
        assert.deepEqual(notes.map((n) => n.userId).sort(), [ownerId, requesterId].sort());
      });
    }
  }
}

test("only the two people on the request can report, and only before the handoff is confirmed", async () => {
  const stranger = await (async () => {
    const [u] = await db.insert(users).values({ username: `${UNIQUE}-stranger`, displayName: "Sam Stranger", password: await hashPassword(PASSWORD), emailVerified: true }).returning({ id: users.id });
    userIds.push(u.id);
    return new Client().signIn(`${UNIQUE}-stranger`);
  })();
  const id = await seed({ status: "ACCEPTED" });
  assert.equal((await stranger.post(`/api/requests/${id}/report-handoff-problem`)).status, 403);
  assert.equal((await load(id)).status, "ACCEPTED");

  for (const status of ["AWAITING_HANDOFF_CONFIRM", "IN_PROGRESS", "PENDING"]) {
    const other = await seed({ status });
    assert.equal((await owner.post(`/api/requests/${other}/report-handoff-problem`)).status, 400, status);
    assert.equal((await load(other)).status, status);
  }
  const done = await seed({ status: "ACCEPTED" });
  assert.equal((await owner.post(`/api/requests/${done}/report-handoff-problem`)).status, 200);
  assert.equal((await requester.post(`/api/requests/${done}/report-handoff-problem`)).status, 400, "already disputed");
});

test("after the request has expired a problem cannot be reported", async () => {
  const id = await seed({ requestType: "BORROW", status: "ACCEPTED", startDate: new Date("2020-01-01T12:00:00Z"), endDate: new Date("2020-01-03T12:00:00Z") } as any);
  const res = await requester.post(`/api/requests/${id}/report-handoff-problem`);
  assert.notEqual(res.status, 200);
  assert.notEqual((await load(id)).status, "HANDOFF_DISPUTED");
});

test("HANDOFF_REPORT_PROBLEM=off turns the route off and changes nothing", async () => {
  const id = await seed({ status: "ACCEPTED" });
  await withEnv({ HANDOFF_REPORT_PROBLEM: "off" }, async () => {
    const res = await owner.post(`/api/requests/${id}/report-handoff-problem`);
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as any).code, "HANDOFF_REPORT_DISABLED");
  });
  assert.equal((await load(id)).status, "ACCEPTED");
});
