import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { WebSocket } from "ws";
import { db, itemRequests, items, moderationActions, pool, userPushTokens, users } from "@workspace/db";
import { accountIsBlocked, hashPassword } from "./auth.js";
import { HIDDEN_ACCOUNT_STATUSES, accountIsPubliclyVisible, itemIsPubliclyVisible } from "./content-visibility.js";
import { Client, startApp } from "./auth-test-client.js";

// A moderator's removal and a ban must take effect everywhere other people look: browse, nearby, the item page,
// the dates endpoint, requests, profiles and their sub-pages. A ban also has to end sessions, the open socket and pushes.

const UNIQUE = `vis-${Date.now()}`;
const PASSWORD = "Visible!42";
const userIds: number[] = [];
const itemIds: number[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
let counter = 0;

async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const n = ++counter;
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}`, password: await hashPassword(PASSWORD), emailVerified: true, handle: `${UNIQUE}h${n}`, displayName: `Name ${label}`, referralCode: `${UNIQUE}r${n}`, ...extra })
    .returning();
  userIds.push(row.id);
  return row;
}

async function makeItem(ownerId: number, extra: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item-${++counter}`, description: "A description", conditionRating: 3, photos: ["/uploads/item-photo.jpg"], shareCoinsReward: "0", isLendable: true, latitude: 45.5, longitude: -73.5, address: "1 Home St", ...extra } as any)
    .returning();
  itemIds.push(row.id);
  return row;
}

async function signIn(user: { username: string }) {
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  return client;
}

const browseIds = async (client: Client) => ((await (await client.get("/api/items")).json()) as { id: number }[]).map((i) => i.id);
const nearbyIds = async (client: Client) =>
  ((await (await client.get("/api/items/nearby?latitude=45.5&longitude=-73.5&radius=5")).json()) as { id: number }[]).map((i) => i.id);

let admin: Awaited<ReturnType<typeof makeUser>>;
let viewer: Awaited<ReturnType<typeof makeUser>>;
let viewerClient: Client;
let adminClient: Client;

before(async () => {
  ({ baseUrl, close: closeServer } = await startApp());
  admin = await makeUser("admin", { isAdmin: true });
  viewer = await makeUser("viewer");
  viewerClient = await signIn(viewer);
  adminClient = await signIn(admin);
});

after(async () => {
  try {
    await pool.query("DELETE FROM moderation_actions WHERE admin_id = ANY($1)", [userIds]);
    if (itemIds.length) {
      await db.delete(itemRequests).where(inArray(itemRequests.itemId, itemIds));
      await db.delete(items).where(inArray(items.id, itemIds));
    }
    if (userIds.length) {
      await db.delete(userPushTokens).where(inArray(userPushTokens.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("the hidden account statuses are exactly the ones that cannot sign in", () => {
  for (const status of ["active", "banned", "deactivated", "deleted", "pending_deletion", null]) {
    assert.equal(accountIsPubliclyVisible({ accountStatus: status }), !accountIsBlocked({ accountStatus: status }), String(status));
  }
  assert.deepEqual([...HIDDEN_ACCOUNT_STATUSES].sort(), ["banned", "deactivated", "deleted"]);
  assert.equal(itemIsPubliclyVisible({ moderationStatus: "removed" }, { accountStatus: "active" }), false);
  assert.equal(itemIsPubliclyVisible({ moderationStatus: "visible" }, { accountStatus: "banned" }), false);
  assert.equal(itemIsPubliclyVisible({}, {}), true);
});

test("a removed listing disappears from browse, nearby, its page, its dates and new requests, and the owner cannot relist or edit it", async () => {
  const owner = await makeUser("owner-removed");
  const ownerClient = await signIn(owner);
  const item = await makeItem(owner.id);
  assert.ok((await browseIds(viewerClient)).includes(item.id), "visible before the removal");
  assert.ok((await nearbyIds(viewerClient)).includes(item.id), "nearby before the removal");

  const removed = await adminClient.post(`/api/admin/items/${item.id}/remove`, { note: "Not allowed" });
  assert.equal(removed.status, 200);

  assert.ok(!(await browseIds(viewerClient)).includes(item.id), "browse");
  assert.ok(!(await nearbyIds(viewerClient)).includes(item.id), "nearby");
  assert.equal((await viewerClient.get(`/api/items/${item.id}`)).status, 404, "item page");
  assert.equal((await viewerClient.get(`/api/items/${item.id}/booked-dates`)).status, 404, "booked dates");
  const request = await viewerClient.post(`/api/items/${item.id}/request`, { requestType: "BORROW", startDate: "2030-01-01", endDate: "2030-01-03" });
  assert.ok(request.status >= 400, `a request for a removed listing is refused (got ${request.status})`);
  assert.equal((await ownerClient.get(`/api/items/${item.id}`)).status, 200, "the owner can still see it");
  assert.equal((await ownerClient.post(`/api/items/${item.id}/relist`, {})).status, 403, "relist");
  assert.equal((await ownerClient.patch(`/api/items/${item.id}`, { name: "Renamed" })).status, 403, "edit");

  const [row] = await db.select().from(items).where(eq(items.id, item.id));
  assert.equal(row.moderationStatus, "removed");
  assert.equal(row.moderationNote, "Not allowed");
  assert.equal(row.isAvailable, false);

  const audit = await pool.query("SELECT action, admin_id, note FROM moderation_actions WHERE target_type = 'item' AND target_id = $1", [item.id]);
  assert.deepEqual(audit.rows, [{ action: "remove_item", admin_id: admin.id, note: "Not allowed" }]);
});

test("a removed listing that is out on loan is still hidden, which the old availability flag could not do", async () => {
  const owner = await makeUser("owner-out");
  const borrower = await makeUser("borrower-out");
  const item = await makeItem(owner.id);
  await db.insert(itemRequests).values({ itemId: item.id, requesterId: borrower.id, requestType: "BORROW", status: "IN_PROGRESS" } as any);
  await db.update(items).set({ isAvailable: false }).where(eq(items.id, item.id));
  assert.ok((await browseIds(viewerClient)).includes(item.id), "an item out on loan still shows");

  assert.equal((await adminClient.post(`/api/admin/items/${item.id}/remove`, {})).status, 200);
  assert.ok(!(await browseIds(viewerClient)).includes(item.id), "gone once removed");
});

test("restoring lifts the removal but leaves the listing unavailable until the owner relists it", async () => {
  const owner = await makeUser("owner-restore");
  const ownerClient = await signIn(owner);
  const item = await makeItem(owner.id);
  await adminClient.post(`/api/admin/items/${item.id}/remove`, {});
  assert.equal((await adminClient.post(`/api/admin/items/${item.id}/restore`, { note: "Mistake" })).status, 200);

  const [row] = await db.select().from(items).where(eq(items.id, item.id));
  assert.equal(row.moderationStatus, "visible");
  assert.equal(row.isAvailable, false);
  assert.equal((await viewerClient.get(`/api/items/${item.id}`)).status, 200);
  assert.equal((await ownerClient.post(`/api/items/${item.id}/relist`, {})).status, 200);
  assert.ok((await browseIds(viewerClient)).includes(item.id));

  assert.equal((await adminClient.post(`/api/admin/items/${item.id}/restore`, {})).status, 404, "restoring a visible item");
  assert.equal((await adminClient.post("/api/admin/items/999999999/remove", {})).status, 404, "removing a missing item");
});

test("only an admin can remove, restore, ban or unban", async () => {
  const item = await makeItem(viewer.id);
  for (const path of [`/api/admin/items/${item.id}/remove`, `/api/admin/items/${item.id}/restore`, `/api/admin/users/${viewer.id}/ban`, `/api/admin/users/${viewer.id}/unban`]) {
    const response = await viewerClient.post(path, {});
    assert.ok([401, 403].includes(response.status), `${path} -> ${response.status}`);
  }
  assert.equal((await db.select().from(users).where(eq(users.id, viewer.id)))[0].accountStatus, "active");
});

test("a ban ends the person's sessions, socket and pushes, hides their listings and profile everywhere, and is audited; an unban brings the profile back", async () => {
  const target = await makeUser("banned-target");
  const item = await makeItem(target.id);
  await db.insert(userPushTokens).values({ userId: target.id, token: `ExponentPushToken[${UNIQUE}]` } as any);
  const targetClient = await signIn(target);

  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/chat`, { headers: { cookie: targetClient.cookieHeader() } });
  const frames: { type: string }[] = [];
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once("open", () => resolve()); socket.once("error", reject); });
  for (let i = 0; i < 100 && !frames.some((f) => f.type === "auth_success"); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(frames.some((f) => f.type === "auth_success"), "the socket authenticated");
  const closed = new Promise<number>((resolve) => socket.once("close", (code) => resolve(code)));

  // Everything is visible before the ban.
  assert.ok((await browseIds(viewerClient)).includes(item.id));
  assert.equal((await viewerClient.get(`/api/users/${target.id}/public-profile`)).status, 200);
  assert.equal((await viewerClient.get(`/api/users/username/${encodeURIComponent(target.username)}`)).status, 200);
  const sessionsBefore = await pool.query("SELECT count(*)::int AS n FROM session WHERE (sess::jsonb) -> 'passport' ->> 'user' = $1", [String(target.id)]);
  assert.ok(sessionsBefore.rows[0].n >= 1);

  assert.equal((await adminClient.post(`/api/admin/users/${target.id}/ban`, { reason: "Harassment" })).status, 200);

  assert.equal(await closed, 1008, "the open socket was closed");
  assert.equal((await targetClient.get("/api/user")).status, 401, "the session is dead");
  const sessionsAfter = await pool.query("SELECT count(*)::int AS n FROM session WHERE (sess::jsonb) -> 'passport' ->> 'user' = $1", [String(target.id)]);
  assert.equal(sessionsAfter.rows[0].n, 0, "the session rows are gone");
  assert.equal((await db.select().from(userPushTokens).where(eq(userPushTokens.userId, target.id))).length, 0, "no push tokens");

  assert.ok(!(await browseIds(viewerClient)).includes(item.id), "browse");
  assert.ok(!(await nearbyIds(viewerClient)).includes(item.id), "nearby");
  assert.equal((await viewerClient.get(`/api/items/${item.id}`)).status, 404, "item page");
  assert.equal((await viewerClient.get(`/api/items/${item.id}/booked-dates`)).status, 404, "booked dates");
  for (const path of [
    `/api/users/${target.id}/public-profile`,
    `/api/users/${target.id}/reputation`,
    `/api/users/username/${encodeURIComponent(target.username)}`,
    `/api/users/username/${encodeURIComponent(target.username)}/items`,
    `/api/users/username/${encodeURIComponent(target.username)}/reviews`,
    `/api/users/username/${encodeURIComponent(target.username)}/achievements`,
    `/api/users/username/${target.handle}`,
  ]) {
    assert.equal((await viewerClient.get(path)).status, 404, path);
  }

  const audit = await pool.query("SELECT action, admin_id, note FROM moderation_actions WHERE target_type = 'user' AND target_id = $1", [target.id]);
  assert.deepEqual(audit.rows, [{ action: "ban_user", admin_id: admin.id, note: "Harassment" }]);

  assert.equal((await adminClient.post(`/api/admin/users/${target.id}/unban`, {})).status, 200);
  assert.equal((await viewerClient.get(`/api/users/${target.id}/public-profile`)).status, 200, "the profile is back");
  assert.equal((await viewerClient.get(`/api/items/${item.id}`)).status, 200, "and so is the listing");
  assert.equal((await targetClient.get("/api/user")).status, 401, "but the old session stays dead");
  const actions = (await pool.query("SELECT action FROM moderation_actions WHERE target_type = 'user' AND target_id = $1 ORDER BY id", [target.id])).rows.map((r) => r.action);
  assert.deepEqual(actions, ["ban_user", "unban_user"]);
});

test("a banned account cannot open the chat socket even if a session row survived", async () => {
  const target = await makeUser("banned-socket");
  const targetClient = await signIn(target);
  // Ban directly in the database so the session row is left behind, as it would be after a crash between steps.
  await db.update(users).set({ accountStatus: "banned" }).where(eq(users.id, target.id));
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/ws/chat`, { headers: { cookie: targetClient.cookieHeader() } });
  const frames: { type: string }[] = [];
  socket.on("message", (data) => frames.push(JSON.parse(data.toString())));
  const code = await new Promise<number>((resolve, reject) => { socket.once("close", (c) => resolve(c)); socket.once("error", reject); });
  assert.equal(code, 1008);
  assert.ok(!frames.some((f) => f.type === "auth_success"));
});

test("an admin cannot ban themselves, and banning or unbanning someone who does not exist or is not banned is a 404", async () => {
  assert.equal((await adminClient.post(`/api/admin/users/${admin.id}/ban`, {})).status, 400);
  assert.equal((await db.select().from(users).where(eq(users.id, admin.id)))[0].accountStatus, "active");
  assert.equal((await adminClient.post("/api/admin/users/999999999/ban", {})).status, 404);
  assert.equal((await adminClient.post(`/api/admin/users/${viewer.id}/unban`, {})).status, 404, "not banned");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM moderation_actions WHERE target_id = $1 AND target_type = 'user'", [admin.id])).rows[0].n, 0, "nothing audited for refused actions");
});

test("an unbanned user who had asked for deletion goes back to waiting for it", async () => {
  const target = await makeUser("unban-pending", { accountStatus: "banned", bannedAt: new Date(), deletionRequestedAt: new Date() });
  assert.equal((await adminClient.post(`/api/admin/users/${target.id}/unban`, {})).status, 200);
  assert.equal((await db.select().from(users).where(eq(users.id, target.id)))[0].accountStatus, "pending_deletion");
});

test("the audit log keeps who did what", async () => {
  const rows = await db.select().from(moderationActions).where(eq(moderationActions.adminId, admin.id));
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((r) => r.createdAt));
});
