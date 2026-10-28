import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, shareCoinsTransactions, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";

// POST /api/requests/check-handoff-deadlines reads the same job switch as the server timer
// ("handoff-deadlines": a job_switches row, else HANDOFF_DEADLINE_SWEEP_MODE, else dry-run) and only
// ever acts on BORROW and RENT. Only live changes anything; a SWAP is untouched in every mode.

const UNIQUE = `handoff-route-${Date.now()}`;
const PASSWORD = "HandoffRoute!42";
const HOUR = 3_600_000;
const userIds: number[] = [];
const itemIds: number[] = [];
const requestIds: number[] = [];
let ownerId: number;
let borrowerId: number;
let baseUrl: string;
let closeServer: () => Promise<void>;
let accountCount = 0;
const previousEnv = process.env.HANDOFF_DEADLINE_SWEEP_MODE;

// The seeded requests, by scenario and type.
const ids = {} as Record<"late" | "silent" | "nudge", Record<"BORROW" | "SWAP", number>>;

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

  post(path: string, body: unknown = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.csrfToken) headers["x-csrf-token"] = this.csrfToken;
    return this.send(path, { method: "POST", headers, body: JSON.stringify(body) });
  }

  async fetchCsrfToken() {
    this.csrfToken = ((await (await this.get("/api/csrf-token")).json()) as { csrfToken: string }).csrfToken;
  }
}

/** The endpoint allows one call a minute per user, so each call signs in as a new user. */
async function callEndpoint() {
  const username = `${UNIQUE}-caller-${accountCount++}`;
  const [user] = await db.insert(users).values({ username, password: await hashPassword(PASSWORD), emailVerified: true }).returning({ id: users.id });
  userIds.push(user.id);
  const client = new Client();
  assert.equal((await client.post("/api/login", { username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  const response = await client.post("/api/requests/check-handoff-deadlines");
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

async function setSwitch(mode: "live" | "dry-run" | "off" | null) {
  await pool.query("DELETE FROM job_switches WHERE job_name = 'handoff-deadlines'");
  if (mode) {
    await pool.query("INSERT INTO job_switches (job_name, mode, updated_by, note) VALUES ('handoff-deadlines', $1, $2, $3)", [mode, mode === "live" ? "test" : null, mode === "live" ? "test fixture" : null]);
  }
}

const state = async (id: number) =>
  (await db.select({ status: itemRequests.status, level: itemRequests.handoffRemindersLevel }).from(itemRequests).where(eq(itemRequests.id, id)))[0];
const systemMessages = async (id: number) => (await db.select().from(messages).where(eq(messages.requestId, id))).length;

async function seedRequest(requestType: "BORROW" | "SWAP", fields: Partial<typeof itemRequests.$inferInsert>) {
  const [item] = await db.insert(items).values({
    ownerId, name: `${UNIQUE}-${requestType}-${itemIds.length}`, description: "x", conditionRating: 4, photos: [],
    isLendable: true, isSwappable: true, isAvailable: true, replacementValue: 100, securityDeposit: "10.00",
    lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
  }).returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db.insert(itemRequests).values({
    itemId: item.id, requesterId: borrowerId, requestType, status: "AWAITING_HANDOFF_CONFIRM",
    startDate: new Date(Date.now() - 24 * HOUR), endDate: new Date(Date.now() + 6 * 24 * HOUR),
    ownerConfirmedHandoff: false, borrowerConfirmedHandoff: false,
    ...fields,
  } as typeof itemRequests.$inferInsert).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

async function seedAll() {
  for (const type of ["BORROW", "SWAP"] as const) {
    // Owner confirmed, borrower silent, deadline an hour ago: the sweep would auto-confirm it.
    const late = await seedRequest(type, {
      ownerConfirmedHandoff: true, ownerConfirmedHandoffAt: new Date(Date.now() - 30 * HOUR), handoffConfirmDeadline: new Date(Date.now() - HOUR),
    });
    // Neither side confirmed and the start date 5 days ago: the both-silent timeout would cancel it.
    const silent = await seedRequest(type, { startDate: new Date(Date.now() - 5 * 24 * HOUR) });
    // Owner confirmed 15 minutes ago, deadline ahead: the first reminder is due.
    const nudge = await seedRequest(type, {
      ownerConfirmedHandoff: true, ownerConfirmedHandoffAt: new Date(Date.now() - 15 * 60_000), handoffConfirmDeadline: new Date(Date.now() + 12 * HOUR),
    });
    (ids.late ??= {} as any)[type] = late;
    (ids.silent ??= {} as any)[type] = silent;
    (ids.nudge ??= {} as any)[type] = nudge;
  }
}

async function untouched(type: "BORROW" | "SWAP") {
  assert.deepEqual(await state(ids.late[type]), { status: "AWAITING_HANDOFF_CONFIRM", level: 0 }, `${type} past its deadline`);
  assert.deepEqual(await state(ids.silent[type]), { status: "AWAITING_HANDOFF_CONFIRM", level: 0 }, `${type} both silent`);
  assert.deepEqual(await state(ids.nudge[type]), { status: "AWAITING_HANDOFF_CONFIRM", level: 0 }, `${type} due a reminder`);
  for (const scenario of ["late", "silent", "nudge"] as const) assert.equal(await systemMessages(ids[scenario][type]), 0, `${type} ${scenario}: no message`);
}

before(async () => {
  await ensureScheduledJobRunsTable();
  await ensureJobSwitchesTable();
  const [owner, borrower] = await db.insert(users).values([
    { username: `${UNIQUE}-owner`, password: "x", emailVerified: true },
    { username: `${UNIQUE}-borrower`, password: "x", emailVerified: true, shareCoins: "50.00" },
  ]).returning({ id: users.id });
  ownerId = owner.id;
  borrowerId = borrower.id;
  userIds.push(owner.id, borrower.id);
  const server = registerRoutes(app, { startBackgroundJobs: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  closeServer = () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

beforeEach(async () => {
  delete process.env.HANDOFF_DEADLINE_SWEEP_MODE;
  await setSwitch(null);
  if (requestIds.length) {
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    requestIds.length = 0;
  }
  await seedAll();
});

after(async () => {
  try {
    await setSwitch(null);
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds));
    if (userIds.length) await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, userIds));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  } finally {
    if (previousEnv === undefined) delete process.env.HANDOFF_DEADLINE_SWEEP_MODE;
    else process.env.HANDOFF_DEADLINE_SWEEP_MODE = previousEnv;
    await closeServer?.();
    await pool.end();
  }
});

test("with no switch row and no environment mode the endpoint is a dry run: it reports, and changes nothing", async () => {
  const body = await callEndpoint();
  assert.equal(body.mode, "dry-run");
  assert.deepEqual([body.autoAdvancedCount, body.flaggedCount, body.depositExpiredCount, body.bothSilentCount], [0, 0, 0, 0]);
  assert.ok((body.wouldChangeCount as number) >= 1, "the BORROW past its deadline is reported");
  await untouched("BORROW");
  await untouched("SWAP");
});

test("a dry-run switch row is a dry run even when the environment says live", async () => {
  process.env.HANDOFF_DEADLINE_SWEEP_MODE = "live";
  await setSwitch("dry-run");
  assert.equal((await callEndpoint()).mode, "dry-run");
  await untouched("BORROW");
  await untouched("SWAP");
});

test("an off switch row (or an off environment mode) makes the endpoint do nothing at all", async () => {
  await setSwitch("off");
  const body = await callEndpoint();
  assert.equal(body.mode, "off");
  assert.equal("wouldChangeCount" in body, false);
  await untouched("BORROW");
  await untouched("SWAP");

  await setSwitch(null);
  process.env.HANDOFF_DEADLINE_SWEEP_MODE = "off";
  assert.equal((await callEndpoint()).mode, "off");
  await untouched("BORROW");
});

test("live: BORROW handoffs advance, are cancelled when both are silent and get their reminder; the SWAP beside each is untouched", async () => {
  await setSwitch("live");
  const body = await callEndpoint();
  assert.equal(body.mode, "live");
  assert.ok((body.autoAdvancedCount as number) >= 1);
  assert.ok((body.bothSilentCount as number) >= 1);

  assert.equal((await state(ids.late.BORROW)).status, "IN_PROGRESS");
  assert.equal((await state(ids.silent.BORROW)).status, "CANCELLED");
  assert.deepEqual(await state(ids.nudge.BORROW), { status: "AWAITING_HANDOFF_CONFIRM", level: 1 });
  assert.equal(await systemMessages(ids.nudge.BORROW), 1);

  await untouched("SWAP");
});

test("an environment live mode applies when there is no switch row", async () => {
  process.env.HANDOFF_DEADLINE_SWEEP_MODE = "live";
  assert.equal((await callEndpoint()).mode, "live");
  assert.equal((await state(ids.late.BORROW)).status, "IN_PROGRESS");
  await untouched("SWAP");
});
