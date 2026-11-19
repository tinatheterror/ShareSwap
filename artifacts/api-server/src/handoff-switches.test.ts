import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db, itemRequests, items, messages, notifications, pool, requestLifecycleEvents, users } from "@workspace/db";
import app from "./app.js";
import { hashPassword } from "./auth.js";
import { registerRoutes } from "./routes/routes.js";
import { ensureJobSwitchesTable, ensureScheduledJobRunsTable } from "./startup-migrations.js";
import { processHandoffDeadlines } from "./handoff-deadline-service.js";
import { sendBorrowerHandoffReminders } from "./handoff-reminders.js";
import * as flags from "./handoff-flags.js";

// The one-sided extras (auto-confirm, 2h/12h reminders, deny wait, post-auto-confirm window, HANDOFF_FLAGGED) are OFF unless
// explicitly on; the code-only behaviours are ON unless explicitly off. This file never sets the extras globally: each test
// passes the option or sets the variable for its own duration.

const UNIQUE = `handoff-switches-${Date.now()}`;
const PASSWORD = "HandoffSwitches!42";
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

test("extras are off unless explicitly on; code-only behaviours are on unless explicitly off", () => {
  const extras = [
    flags.handoffAutoConfirmEnabled, flags.handoff2HourReminderEnabled, flags.oneSidedDenyWaitEnabled,
    flags.autoConfirmDisputeWindowEnabled, flags.handoffFlaggedEnabled,
  ];
  const names = ["HANDOFF_AUTO_CONFIRM", "HANDOFF_REMINDER_2H", "HANDOFF_ONE_SIDED_DENY_WAIT", "HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW", "HANDOFF_FLAGGED"];
  extras.forEach((fn, i) => {
    assert.equal(fn({} as NodeJS.ProcessEnv), false, names[i]);
    for (const raw of ["", "off", "typo", "0"]) assert.equal(fn({ [names[i]]: raw } as NodeJS.ProcessEnv), false, `${names[i]}=${raw}`);
    for (const raw of ["on", "TRUE", "1", " yes "]) assert.equal(fn({ [names[i]]: raw } as NodeJS.ProcessEnv), true, `${names[i]}=${raw}`);
  });
  const codeOnly = [
    [flags.handoffReportProblemEnabled, "HANDOFF_REPORT_PROBLEM"], [flags.handoffManualConfirmHidden, "HANDOFF_HIDE_MANUAL_CONFIRM"],
    [flags.handoffOneCodeEnabled, "HANDOFF_ONE_CODE"], [flags.handoffOwnerWarningEnabled, "HANDOFF_OWNER_WARNING"],
  ] as const;
  for (const [fn, name] of codeOnly) {
    assert.equal(fn({} as NodeJS.ProcessEnv), true, name);
    assert.equal(fn({ [name]: "typo" } as NodeJS.ProcessEnv), true, `${name}=typo stays on`);
    for (const raw of ["off", "false", "0", "no", " OFF "]) assert.equal(fn({ [name]: raw } as NodeJS.ProcessEnv), false, `${name}=${raw}`);
  }
  assert.equal(flags.autoConfirmDisputeWindowHours({} as NodeJS.ProcessEnv), 0);
  assert.equal(flags.autoConfirmDisputeWindowHours({ HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW: "on" } as NodeJS.ProcessEnv), 24);
});

test("by default the sweep does not auto-confirm a one-sided handoff; switched on it does", async () => {
  const id = await seed({
    status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true, handoffConfirmDeadline: new Date(Date.now() - HOUR),
  });
  const only = { onlyRequestIds: [id] };
  await withEnv({ HANDOFF_AUTO_CONFIRM: undefined }, async () => {
    const result = await processHandoffDeadlines(deps, only);
    assert.equal(result.autoAdvancedCount, 0);
  });
  assert.equal((await load(id)).status, "AWAITING_HANDOFF_CONFIRM");
  await withEnv({ HANDOFF_AUTO_CONFIRM: "on" }, async () => {
    assert.equal((await processHandoffDeadlines(deps, only)).autoAdvancedCount, 1);
  });
  assert.equal((await load(id)).status, "COMPLETED");
});

test("by default a denial the other person never answers is not flagged; with HANDOFF_FLAGGED on it is", async () => {
  const id = await seed({
    status: "AWAITING_HANDOFF_CONFIRM", ownerDeniedHandoff: true, handoffConfirmDeadline: new Date(Date.now() - HOUR),
  } as any);
  await withEnv({ HANDOFF_FLAGGED: undefined }, async () => {
    assert.equal((await processHandoffDeadlines(deps, { onlyRequestIds: [id] })).flaggedCount, 0);
  });
  assert.equal((await load(id)).status, "AWAITING_HANDOFF_CONFIRM");
  await withEnv({ HANDOFF_FLAGGED: "on" }, async () => {
    assert.equal((await processHandoffDeadlines(deps, { onlyRequestIds: [id] })).flaggedCount, 1);
  });
  assert.equal((await load(id)).status, "HANDOFF_FLAGGED");
});

test("the 2 hour reminder is off by default and claims nothing; switched on it is sent", async () => {
  const id = await seed({
    status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true, handoffConfirmDeadline: new Date(Date.now() + HOUR),
  });
  const only = { onlyRequestIds: [id] };
  assert.equal(await sendBorrowerHandoffReminders(new Date(), only), 0, "both reminders off: nobody is reminded");
  assert.equal(await sendBorrowerHandoffReminders(new Date(), { ...only, include2Hour: true }), 1);
});

test("a denial with the deny wait off (the default) opens the dispute at once; with the wait on it waits", async () => {
  const off = await seed({ status: "DEPOSIT_CONFIRMED" });
  await withEnv({ HANDOFF_ONE_SIDED_DENY_WAIT: undefined }, async () => {
    const res = await requester.post(`/api/requests/${off}/deny-handoff`);
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).disputeTriggered, true);
  });
  const dispute = await load(off);
  assert.equal(dispute.status, "HANDOFF_DISPUTED");
  assert.ok(dispute.handoffProofDeadline!.getTime() - Date.now() > 23 * HOUR);

  const on = await seed({ status: "DEPOSIT_CONFIRMED" });
  await withEnv({ HANDOFF_ONE_SIDED_DENY_WAIT: "on" }, async () => {
    const res = await requester.post(`/api/requests/${on}/deny-handoff`);
    assert.equal(((await res.json()) as any).disputeTriggered, false);
  });
  assert.equal((await load(on)).status, "AWAITING_HANDOFF_CONFIRM");
});

test("with the post-auto-confirm window off (the default) an auto-confirmed handoff cannot be disputed; on, it can", async () => {
  const make = () => seed({
    requestType: "BORROW", status: "IN_PROGRESS", handoffAutoAdvanced: true, handoffConfirmedAt: new Date(), borrowPeriodStartedAt: new Date(),
  } as any);
  const closed = await make();
  await withEnv({ HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW: undefined }, async () => {
    const res = await owner.post(`/api/requests/${closed}/deny-handoff`);
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as any).code, "DISPUTE_WINDOW_CLOSED");
  });
  assert.equal((await load(closed)).status, "IN_PROGRESS");
  const open = await make();
  await withEnv({ HANDOFF_AUTO_CONFIRM_DISPUTE_WINDOW: "on" }, async () => {
    assert.equal((await owner.post(`/api/requests/${open}/deny-handoff`)).status, 200);
  });
  assert.equal((await load(open)).status, "HANDOFF_DISPUTED");
});
