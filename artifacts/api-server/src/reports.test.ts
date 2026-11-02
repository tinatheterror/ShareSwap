import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { contentReports, db, items, messages, notifications, pool, userReviews, users, wishlists } from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { createReport, MAX_REPORT_DETAILS_LENGTH } from "./reports-service.js";
import { REPORTS_PER_WINDOW } from "./report-limit.js";
import { moderationEmail, REPORT_SLA_WARN_HOURS } from "./moderation-config.js";

// A report stores a copy of what was reported and reaches a queue that moderators work through; resolving it hides the
// content everywhere, tells the people involved, and leaves an audit trail.

const UNIQUE = `rep-${Date.now()}`;
const PASSWORD = "Reported!42";
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

async function makeItem(ownerId: number) {
  const [row] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item-${++counter}`, description: "A questionable description", conditionRating: 3, photos: ["/uploads/item-photo.jpg"], shareCoinsReward: "0", isLendable: true, isGift: true, latitude: 45.5, longitude: -73.5, address: "1 Home St" } as any)
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

const report = (client: Client, body: Record<string, unknown>) => client.post("/api/reports", body);
const reportRow = async (id: number) => (await db.select().from(contentReports).where(eq(contentReports.id, id)))[0];
const noticesFor = (userId: number, type: string) => db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, type)));
const browseIds = async (client: Client) => ((await (await client.get("/api/items")).json()) as { id: number }[]).map((i) => i.id);
const audit = async (targetType: string, targetId: number) =>
  (await pool.query("SELECT action, admin_id, report_id, note FROM moderation_actions WHERE target_type = $1 AND target_id = $2 ORDER BY id", [targetType, targetId])).rows;

let admin: Awaited<ReturnType<typeof makeUser>>;
let adminClient: Client;

before(async () => {
  ({ baseUrl, close: closeServer } = await startApp());
  admin = await makeUser("admin", { isAdmin: true });
  adminClient = await signIn(admin);
});

after(async () => {
  try {
    if (userIds.length) {
      await pool.query("DELETE FROM moderation_actions WHERE admin_id = ANY($1)", [userIds]);
      await db.delete(contentReports).where(or(inArray(contentReports.reporterId, userIds), inArray(contentReports.targetUserId, userIds)));
      await db.delete(messages).where(or(inArray(messages.senderId, userIds), inArray(messages.receiverId, userIds)));
      await db.delete(userReviews).where(or(inArray(userReviews.reviewerId, userIds), inArray(userReviews.reviewedUserId, userIds)));
      await db.delete(wishlists).where(inArray(wishlists.userId, userIds));
      await db.delete(notifications).where(inArray(notifications.userId, userIds));
    }
    if (itemIds.length) {
      await db.delete(notifications).where(inArray(notifications.itemId, itemIds));
      await db.delete(items).where(inArray(items.id, itemIds));
    }
    if (userIds.length) {
      await pool.query("DELETE FROM user_push_tokens WHERE user_id = ANY($1)", [userIds]);
      await db.delete(users).where(inArray(users.id, userIds));
    }
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%' OR key LIKE 'reports:%'");
  } finally {
    await closeServer?.();
    await pool.end();
  }
});

test("the moderation address comes from configuration and must look like an address", () => {
  assert.equal(moderationEmail({ MODERATION_EMAIL: " moderation@shareswap.app " } as NodeJS.ProcessEnv), "moderation@shareswap.app");
  for (const bad of [undefined, "", "   ", "not an address", "a@b c"]) assert.equal(moderationEmail({ MODERATION_EMAIL: bad } as NodeJS.ProcessEnv), null, String(bad));
});

test("a report needs sign-in, a known kind of target, a reason from the list, and sensible details", async () => {
  const author = await makeUser("val-author");
  const reporter = await makeUser("val-reporter");
  const item = await makeItem(author.id);
  const client = await signIn(reporter);
  const anonymous = new Client(baseUrl);
  await anonymous.fetchCsrfToken();
  assert.equal((await report(anonymous, { targetType: "item", targetId: item.id, reason: "spam" })).status, 401);

  for (const [label, body] of [
    ["no target type", { targetId: item.id, reason: "spam" }],
    ["unknown target type", { targetType: "cat", targetId: item.id, reason: "spam" }],
    ["no target id", { targetType: "item", reason: "spam" }],
    ["target id is text", { targetType: "item", targetId: "abc", reason: "spam" }],
    ["target id is zero", { targetType: "item", targetId: 0, reason: "spam" }],
    ["no reason", { targetType: "item", targetId: item.id }],
    ["unknown reason", { targetType: "item", targetId: item.id, reason: "rude" }],
    ["details is a number", { targetType: "item", targetId: item.id, reason: "spam", details: 5 }],
    ["details is too long", { targetType: "item", targetId: item.id, reason: "spam", details: "x".repeat(MAX_REPORT_DETAILS_LENGTH + 1) }],
  ] as const) {
    assert.equal((await report(client, body as Record<string, unknown>)).status, 400, label);
  }
  assert.equal((await report(client, { targetType: "item", targetId: 999999999, reason: "spam" })).status, 404, "missing target");
  assert.equal((await db.select().from(contentReports).where(eq(contentReports.reporterId, reporter.id))).length, 0, "nothing stored");
});

test("a report keeps a copy of what was reported, files once per reporter, and is announced once", async () => {
  const author = await makeUser("copy-author");
  const reporterA = await makeUser("copy-a");
  const reporterB = await makeUser("copy-b");
  const item = await makeItem(author.id);
  const ca = await signIn(reporterA);
  const cb = await signIn(reporterB);

  const first = await report(ca, { targetType: "item", targetId: String(item.id), reason: "scam", details: "  Looks fake  " });
  assert.equal(first.status, 201);
  const { id } = (await first.json()) as { id: number };
  const again = await report(ca, { targetType: "item", targetId: item.id, reason: "spam" });
  assert.equal(again.status, 200, "the same report again is not a new one");
  assert.deepEqual(await again.json(), { id, status: "open", alreadyReported: true });

  const stored = await reportRow(id);
  assert.equal(stored.targetUserId, author.id);
  assert.equal(stored.reason, "scam");
  assert.equal(stored.details, "Looks fake");
  assert.equal(stored.status, "open");
  assert.deepEqual(stored.snapshot, { name: item.name, description: "A questionable description", photos: ["/uploads/item-photo.jpg"] });

  // Editing the listing afterwards does not change what the moderator sees.
  await db.update(items).set({ description: "Edited to look innocent" }).where(eq(items.id, item.id));
  assert.equal(((await reportRow(id)).snapshot as { description: string }).description, "A questionable description");

  const second = await report(cb, { targetType: "item", targetId: item.id, reason: "spam" });
  assert.equal(second.status, 201);
  assert.notEqual(((await second.json()) as { id: number }).id, id, "another reporter files their own");

  const announced: unknown[] = [];
  const direct = await createReport({
    reporterId: reporterB.id, targetType: "user", targetId: author.id, reason: "harassment",
    onCreated: (r) => { announced.push(r); throw new Error("the inbox is down"); },
  });
  assert.equal(direct.ok, true, "an announcement failure does not lose the report");
  assert.equal(announced.length, 1);
});

test("you cannot report yourself or your own content, or a private message that is not yours, or something already gone", async () => {
  const me = await makeUser("own-me");
  const other = await makeUser("own-other");
  const stranger = await makeUser("own-stranger");
  const gone = await makeUser("own-gone", { accountStatus: "banned" });
  const mine = await makeItem(me.id);
  const theirs = await makeItem(other.id);
  const [privateMessage] = await db.insert(messages).values({ senderId: other.id, receiverId: me.id, content: "private" }).returning();
  const [myMessage] = await db.insert(messages).values({ senderId: me.id, receiverId: other.id, content: "mine" }).returning();
  const [goneItem] = [await makeItem(gone.id)];
  const [removed] = [await makeItem(other.id)];
  await db.update(items).set({ moderationStatus: "removed" }).where(eq(items.id, removed.id));
  const cm = await signIn(me);
  const cs = await signIn(stranger);

  assert.equal((await report(cm, { targetType: "user", targetId: me.id, reason: "spam" })).status, 400, "yourself");
  assert.equal((await report(cm, { targetType: "item", targetId: mine.id, reason: "spam" })).status, 400, "your item");
  assert.equal((await report(cm, { targetType: "message", targetId: myMessage.id, reason: "spam" })).status, 400, "your message");
  assert.equal((await report(cs, { targetType: "message", targetId: privateMessage.id, reason: "spam" })).status, 404, "a message between two other people");
  assert.equal((await report(cm, { targetType: "message", targetId: privateMessage.id, reason: "harassment" })).status, 201, "a message sent to you");
  assert.equal((await report(cm, { targetType: "user", targetId: gone.id, reason: "spam" })).status, 404, "a banned account");
  assert.equal((await report(cm, { targetType: "item", targetId: goneItem.id, reason: "spam" })).status, 404, "a banned owner's item");
  assert.equal((await report(cm, { targetType: "item", targetId: removed.id, reason: "spam" })).status, 404, "an item already removed");
  assert.equal((await report(cm, { targetType: "item", targetId: theirs.id, reason: "spam" })).status, 201);
});

test("reporting is limited per user", async () => {
  const author = await makeUser("lim-author");
  const spammer = await makeUser("lim-spammer");
  const item = await makeItem(author.id);
  const client = await signIn(spammer);
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'reports:%'");
  for (let i = 0; i < REPORTS_PER_WINDOW; i++) {
    const status = (await report(client, { targetType: "item", targetId: item.id, reason: "spam" })).status;
    assert.ok(status === 201 || status === 200, `report ${i}: ${status}`);
  }
  const limited = await report(client, { targetType: "item", targetId: item.id, reason: "spam" });
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as { code: string }).code, "REPORT_RATE_LIMITED");
});

test("only an admin can read or work the queue", async () => {
  const user = await makeUser("gate-user");
  const client = await signIn(user);
  for (const response of [await client.get("/api/admin/reports"), await client.post("/api/admin/reports/1/resolve", { action: "dismiss" })]) {
    assert.ok([401, 403].includes(response.status), String(response.status));
  }
});

test("the queue lists open reports oldest first with the author's history, flags the overdue, and reports its oldest age", async () => {
  const author = await makeUser("q-author");
  const r1 = await makeUser("q-r1");
  const r2 = await makeUser("q-r2");
  const itemA = await makeItem(author.id);
  const itemB = await makeItem(author.id);
  const c1 = await signIn(r1);
  const c2 = await signIn(r2);
  const oldId = ((await (await report(c1, { targetType: "item", targetId: itemA.id, reason: "hate", details: "slur in the title" })).json()) as { id: number }).id;
  const newId = ((await (await report(c2, { targetType: "item", targetId: itemB.id, reason: "spam" })).json()) as { id: number }).id;
  await db.update(contentReports).set({ createdAt: new Date(Date.now() - (REPORT_SLA_WARN_HOURS + 2) * 3_600_000) }).where(eq(contentReports.id, oldId));

  const body = (await (await adminClient.get("/api/admin/reports")).json()) as {
    reports: { id: number; overdue: boolean; ageHours: number; otherReportsAgainstAuthor: number; reporter: { id: number } | null; author: { id: number; accountStatus: string }; details: string | null; snapshot: { name: string } }[];
    oldestOpenAgeHours: number;
  };
  const ours = body.reports.filter((r) => [oldId, newId].includes(r.id));
  assert.deepEqual(ours.map((r) => r.id), [oldId, newId], "oldest first");
  assert.equal(ours[0].overdue, true);
  assert.equal(ours[1].overdue, false);
  assert.ok(ours[0].ageHours >= REPORT_SLA_WARN_HOURS);
  assert.equal(ours[0].otherReportsAgainstAuthor, 1, "the other report on the same person");
  assert.equal(ours[0].reporter?.id, r1.id);
  assert.equal(ours[0].author.id, author.id);
  assert.equal(ours[0].author.accountStatus, "active");
  assert.equal(ours[0].details, "slur in the title");
  assert.equal(ours[0].snapshot.name, itemA.name);
  assert.ok(body.oldestOpenAgeHours >= REPORT_SLA_WARN_HOURS);

  const stats = (await (await adminClient.get("/api/admin/stats")).json()) as { openReports: number; oldestOpenReportAgeHours: number };
  assert.ok(stats.openReports >= 2);
  assert.ok(stats.oldestOpenReportAgeHours >= REPORT_SLA_WARN_HOURS);
  assert.equal(((await (await adminClient.get("/api/admin/reports?status=dismissed")).json()) as { reports: { id: number }[] }).reports.some((r) => r.id === oldId), false);
});

test("removing a reported listing hides it everywhere, closes every report on it, tells the owner and each reporter once, and is audited", async () => {
  const author = await makeUser("rm-author");
  const r1 = await makeUser("rm-r1");
  const r2 = await makeUser("rm-r2");
  const bystander = await makeUser("rm-by");
  const item = await makeItem(author.id);
  const c1 = await signIn(r1);
  const c2 = await signIn(r2);
  const cb = await signIn(bystander);
  const id1 = ((await (await report(c1, { targetType: "item", targetId: item.id, reason: "illegal" })).json()) as { id: number }).id;
  const id2 = ((await (await report(c2, { targetType: "item", targetId: item.id, reason: "scam" })).json()) as { id: number }).id;
  assert.ok((await browseIds(cb)).includes(item.id));

  const resolved = await adminClient.post(`/api/admin/reports/${id1}/resolve`, { action: "remove_content", note: "Prohibited item" });
  assert.equal(resolved.status, 200);
  assert.deepEqual(((await resolved.json()) as { resolvedReportIds: number[] }).resolvedReportIds.sort(), [id1, id2].sort());

  assert.ok(!(await browseIds(cb)).includes(item.id), "gone from browse");
  assert.equal((await cb.get(`/api/items/${item.id}`)).status, 404);
  for (const id of [id1, id2]) {
    const row = await reportRow(id);
    assert.equal(row.status, "actioned");
    assert.equal(row.resolvedBy, admin.id);
    assert.equal(row.resolutionNote, "Prohibited item");
  }
  assert.equal((await noticesFor(author.id, "content_removed")).length, 1);
  assert.equal((await noticesFor(r1.id, "report_resolved")).length, 1);
  assert.equal((await noticesFor(r2.id, "report_resolved")).length, 1);
  assert.match((await noticesFor(r1.id, "report_resolved"))[0].message, /took action/);
  assert.ok(!JSON.stringify(await noticesFor(author.id, "content_removed")).includes(r1.username), "the owner is not told who reported");
  assert.deepEqual((await audit("item", item.id)).map((a) => [a.action, a.report_id]), [["remove_item", id1]]);

  assert.equal((await adminClient.post(`/api/admin/reports/${id1}/resolve`, { action: "dismiss" })).status, 409, "already handled");
});

test("hiding a reported review, message or wishlist post removes it from every public read", async () => {
  const author = await makeUser("hide-author");
  const reviewed = await makeUser("hide-reviewed");
  const reader = await makeUser("hide-reader");
  const cr = await signIn(reader);
  const ca = await signIn(author);

  const [review] = await db.insert(userReviews).values({ reviewerId: author.id, reviewedUserId: reviewed.id, rating: 1, comment: "an abusive comment" }).returning();
  const reviewsOf = async () => (await (await cr.get(`/api/users/username/${reviewed.handle}/reviews`)).json()) as { comment: string }[];
  assert.ok((await reviewsOf()).some((r) => r.comment === "an abusive comment"));
  const reviewReport = ((await (await report(cr, { targetType: "review", targetId: review.id, reason: "harassment" })).json()) as { id: number }).id;
  assert.equal((await adminClient.post(`/api/admin/reports/${reviewReport}/resolve`, { action: "remove_content" })).status, 200);
  assert.ok(!(await reviewsOf()).some((r) => r.comment === "an abusive comment"), "review hidden");
  assert.equal((await db.select().from(userReviews).where(eq(userReviews.id, review.id))).length, 1, "kept as evidence");
  assert.deepEqual((await audit("review", review.id)).map((a) => a.action), ["hide_review"]);

  const [message] = await db.insert(messages).values({ senderId: author.id, receiverId: reader.id, content: "an abusive message" }).returning();
  const threadOf = async (client: Client, partner: number) => ((await (await client.get(`/api/messages/${partner}`)).json()) as { content: string }[]).map((m) => m.content);
  assert.ok((await threadOf(cr, author.id)).includes("an abusive message"));
  const messageReport = ((await (await report(cr, { targetType: "message", targetId: message.id, reason: "harassment" })).json()) as { id: number }).id;
  assert.equal((await adminClient.post(`/api/admin/reports/${messageReport}/resolve`, { action: "remove_content" })).status, 200);
  assert.ok(!(await threadOf(cr, author.id)).includes("an abusive message"), "hidden from the recipient");
  assert.ok(!(await threadOf(ca, reader.id)).includes("an abusive message"), "and from the sender");
  const conversations = (await (await cr.get("/api/conversations")).json()) as { userId: number; lastMessage: string }[];
  assert.ok(!conversations.some((c) => c.lastMessage === "an abusive message"));
  assert.equal((await db.select().from(messages).where(eq(messages.id, message.id))).length, 1, "kept as evidence");

  const [wish] = await db.insert(wishlists).values({ userId: author.id, itemName: `${UNIQUE}-offensive-wish` }).returning();
  const wishIds = async () => ((await (await cr.get("/api/wishlists")).json()) as { id: number }[]).map((w) => w.id);
  assert.ok((await wishIds()).includes(wish.id));
  const wishReport = ((await (await report(cr, { targetType: "wishlist", targetId: wish.id, reason: "sexual" })).json()) as { id: number }).id;
  assert.equal((await adminClient.post(`/api/admin/reports/${wishReport}/resolve`, { action: "remove_content" })).status, 200);
  assert.ok(!(await wishIds()).includes(wish.id), "wishlist post hidden");
  assert.equal((await cr.post("/api/wishlist-offers", { wishlistId: wish.id })).status, 404, "and nobody can offer on it");
  assert.equal((await noticesFor(author.id, "content_removed")).length, 3);
});

test("dismissing closes the report, tells the reporter nothing was found, and touches no content", async () => {
  const author = await makeUser("dis-author");
  const reporter = await makeUser("dis-reporter");
  const item = await makeItem(author.id);
  const client = await signIn(reporter);
  const id = ((await (await report(client, { targetType: "item", targetId: item.id, reason: "other", details: "I just don't like it" })).json()) as { id: number }).id;
  assert.equal((await adminClient.post(`/api/admin/reports/${id}/resolve`, { action: "dismiss", note: "Fine" })).status, 200);
  assert.equal((await reportRow(id)).status, "dismissed");
  assert.ok((await browseIds(client)).includes(item.id), "the listing is untouched");
  assert.match((await noticesFor(reporter.id, "report_resolved"))[0].message, /didn't find a violation/);
  assert.equal((await noticesFor(author.id, "content_removed")).length, 0);
  assert.deepEqual((await audit("item", item.id)).map((a) => a.action), ["dismiss_report"]);
});

test("a warning notifies the author and closes the report; a profile can't be 'removed'", async () => {
  const author = await makeUser("warn-author");
  const reporter = await makeUser("warn-reporter");
  const client = await signIn(reporter);
  const id = ((await (await report(client, { targetType: "user", targetId: author.id, reason: "harassment" })).json()) as { id: number }).id;
  assert.equal((await adminClient.post(`/api/admin/reports/${id}/resolve`, { action: "remove_content" })).status, 400);
  assert.equal((await reportRow(id)).status, "open", "a refused action leaves it open");
  assert.equal((await adminClient.post(`/api/admin/reports/${id}/resolve`, { action: "explode" })).status, 400);
  assert.equal((await adminClient.post(`/api/admin/reports/${id}/resolve`, { action: "warn_user" })).status, 200);
  assert.equal((await noticesFor(author.id, "moderation_warning")).length, 1);
  assert.equal((await db.select().from(users).where(eq(users.id, author.id)))[0].accountStatus, "active");
  assert.deepEqual((await audit("user", author.id)).map((a) => a.action), ["warn_user"]);
});

test("banning from a report bans the author, ends their sessions, and closes every open report about them", async () => {
  const author = await makeUser("ban-author");
  const r1 = await makeUser("ban-r1");
  const r2 = await makeUser("ban-r2");
  const itemX = await makeItem(author.id);
  const itemY = await makeItem(author.id);
  const authorClient = await signIn(author);
  const c1 = await signIn(r1);
  const c2 = await signIn(r2);
  const id1 = ((await (await report(c1, { targetType: "user", targetId: author.id, reason: "hate" })).json()) as { id: number }).id;
  const id2 = ((await (await report(c2, { targetType: "item", targetId: itemY.id, reason: "hate" })).json()) as { id: number }).id;
  assert.equal((await authorClient.get("/api/user")).status, 200);

  const resolved = await adminClient.post(`/api/admin/reports/${id1}/resolve`, { action: "ban_user", note: "Hate speech" });
  assert.equal(resolved.status, 200);
  assert.deepEqual(((await resolved.json()) as { resolvedReportIds: number[] }).resolvedReportIds.sort(), [id1, id2].sort());

  const banned = (await db.select().from(users).where(eq(users.id, author.id)))[0];
  assert.equal(banned.accountStatus, "banned");
  assert.equal(banned.banReason, "Hate speech");
  assert.equal((await authorClient.get("/api/user")).status, 401);
  assert.ok(!(await browseIds(c1)).includes(itemX.id), "their listings are gone");
  assert.equal((await reportRow(id2)).status, "actioned");
  assert.equal((await noticesFor(r1.id, "report_resolved")).length, 1);
  assert.equal((await noticesFor(r2.id, "report_resolved")).length, 1);
  assert.deepEqual((await audit("user", author.id)).map((a) => [a.action, a.report_id]), [["ban_user", id1]]);
});
