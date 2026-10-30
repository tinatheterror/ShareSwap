import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq, inArray, or } from "drizzle-orm";
import passport from "passport";
import {
  bannedEmailHashes, connectCleanupFailures, db, deliveryArrangements, itemRequests, items, messages, notifications, platformCommissions, pool,
  rentalPayouts, rentalReturns, requestLifecycleEvents, securityClaims, shareCoinsTransactions, userPushTokens, userReviews,
  userSubscriptions, users, verifications, wishlistOffers, wishlists,
} from "@workspace/db";
import { hashPassword } from "../auth.js";
import { Client, startApp } from "../auth-test-client.js";
import { hashBannedEmail, isBannedEmail } from "./banned-email.js";
import {
  DeletionError, cancelDeletion, finalizeDeletion, finalizeDueDeletions, requestDeletion, retryConnectFailures, scheduledFor,
  type DeletionDeps, type StripeCleanupTarget,
} from "./service.js";

// Account deletion end to end against a real database: request, cancel, finalize (twice), the blocked states, what is
// kept and what is scrubbed, the banned-email block, the finalize job, and that a deleted account cannot sign in.

const UNIQUE = `del-${Date.now()}`;
const PASSWORD = "Delete!42";
const KEY = "test-hash-key";
const userIds: number[] = [];
const itemIds: number[] = [];
const hashes: string[] = [];
let baseUrl: string;
let closeServer: () => Promise<void>;
const sent: { requested: { to: string; deleteOn: Date }[]; deleted: { to: string }[] } = { requested: [], deleted: [] };
const stripeCalls: StripeCleanupTarget[] = [];
const uploadsRemoved: string[] = [];

const deps = (extra: Partial<DeletionDeps> = {}): DeletionDeps => ({
  env: { BANNED_EMAIL_HASH_KEY: KEY },
  sendRequestedEmail: async (to, deleteOn) => void sent.requested.push({ to, deleteOn }),
  sendDeletedEmail: async (to) => void sent.deleted.push({ to }),
  stripeCleanup: async (target) => void stripeCalls.push(target),
  removeUpload: async (p) => void uploadsRemoved.push(p),
  ...extra,
});

let counter = 0;
async function makeUser(label: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const n = ++counter;
  const [row] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}@example.com`, password: await hashPassword(PASSWORD), emailVerified: true, handle: `${UNIQUE}h${n}`, displayName: `Name ${label}`, referralCode: `${UNIQUE}r${n}`, ...extra })
    .returning();
  userIds.push(row.id);
  return row;
}

async function makeItem(ownerId: number, extra: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(items)
    .values({ ownerId, name: `${UNIQUE}-item`, description: "A private description", conditionRating: 3, photos: ["/uploads/item-photo.jpg"], shareCoinsReward: "0", latitude: 45.5, longitude: -73.5, address: "1 Home St", ...extra } as any)
    .returning();
  itemIds.push(row.id);
  return row;
}

const makeRequest = async (itemId: number, requesterId: number, extra: Record<string, unknown> = {}) =>
  (await db.insert(itemRequests).values({ itemId, requesterId, requestType: "BORROW", status: "COMPLETED", ...extra } as any).returning())[0];

const userRow = async (id: number) => (await db.select().from(users).where(eq(users.id, id)))[0];
const requestRow = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const pending = async (id: number) => {
  await db.update(users).set({ accountStatus: "pending_deletion", deletionRequestedAt: new Date(Date.now() - 20 * 24 * 3_600_000) }).where(eq(users.id, id));
};

const previousKey = process.env.BANNED_EMAIL_HASH_KEY;
before(async () => {
  process.env.BANNED_EMAIL_HASH_KEY = KEY;
  ({ baseUrl, close: closeServer } = await startApp({ accountDeletion: deps() }));
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
});

after(async () => {
  try {
    const requestIds = userIds.length
      ? (await db.select({ id: itemRequests.id }).from(itemRequests).where(or(inArray(itemRequests.requesterId, userIds), inArray(itemRequests.itemId, itemIds.length ? itemIds : [0])))).map((r) => r.id)
      : [];
    const ids = userIds.length ? userIds : [0];
    const reqs = requestIds.length ? requestIds : [0];
    await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, reqs));
    await db.delete(securityClaims).where(inArray(securityClaims.requestId, reqs));
    await db.delete(deliveryArrangements).where(inArray(deliveryArrangements.requestId, reqs));
    await db.delete(connectCleanupFailures).where(inArray(connectCleanupFailures.userId, ids));
    await db.delete(rentalReturns).where(inArray(rentalReturns.requestId, reqs));
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.userId, ids));
    await db.delete(messages).where(or(inArray(messages.senderId, ids), inArray(messages.receiverId, ids)));
    await db.delete(notifications).where(inArray(notifications.userId, ids));
    await db.delete(userReviews).where(or(inArray(userReviews.reviewerId, ids), inArray(userReviews.reviewedUserId, ids)));
    await db.delete(platformCommissions).where(inArray(platformCommissions.payerId, ids));
    await db.delete(userSubscriptions).where(inArray(userSubscriptions.userId, ids));
    await db.delete(wishlistOffers).where(inArray(wishlistOffers.userId, ids));
    await db.delete(wishlists).where(inArray(wishlists.userId, ids));
    await db.delete(userPushTokens).where(inArray(userPushTokens.userId, ids));
    await db.delete(shareCoinsTransactions).where(inArray(shareCoinsTransactions.userId, ids));
    await db.delete(verifications).where(inArray(verifications.userId, ids));
    await db.delete(itemRequests).where(inArray(itemRequests.id, reqs));
    if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
    if (hashes.length) await db.delete(bannedEmailHashes).where(inArray(bannedEmailHashes.emailHash, hashes));
    await db.delete(users).where(inArray(users.id, ids));
    await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  } finally {
    if (previousKey === undefined) delete process.env.BANNED_EMAIL_HASH_KEY;
    else process.env.BANNED_EMAIL_HASH_KEY = previousKey;
    await closeServer?.();
    await pool.end();
  }
});

test("requesting a deletion starts the grace period, hides listings, and emails the person's own address", async () => {
  const user = await makeUser("request");
  const item = await makeItem(user.id);
  const before = sent.requested.length;
  const state = await requestDeletion(user.id, { acknowledgeForfeit: false }, deps());
  assert.equal(state.status, "pending_deletion");
  assert.equal(state.scheduledFor?.getTime(), scheduledFor(state.deletionRequestedAt!).getTime());
  assert.equal(Math.round((state.scheduledFor!.getTime() - state.deletionRequestedAt!.getTime()) / 86_400_000), 14);
  const row = await userRow(user.id);
  assert.equal(row.accountStatus, "pending_deletion");
  assert.ok(row.deletionRequestedAt);
  assert.equal((await db.select().from(items).where(eq(items.id, item.id)))[0].isAvailable, false);
  assert.equal(sent.requested.length, before + 1);
  assert.equal(sent.requested.at(-1)!.to, user.username, "the email goes to the account's own address");

  // Requesting again returns the same schedule and does not email again.
  const again = await requestDeletion(user.id, { acknowledgeForfeit: false }, deps());
  assert.equal(again.deletionRequestedAt?.getTime(), state.deletionRequestedAt?.getTime());
  assert.equal(sent.requested.length, before + 1);
});

test("cancelling returns the account to active and lists its items again; cancelling an active account does nothing", async () => {
  const user = await makeUser("cancel");
  const item = await makeItem(user.id);
  await requestDeletion(user.id, { acknowledgeForfeit: false }, deps());
  const state = await cancelDeletion(user.id);
  assert.equal(state.status, "active");
  const row = await userRow(user.id);
  assert.equal(row.accountStatus, "active");
  assert.equal(row.deletionRequestedAt, null);
  assert.equal((await db.select().from(items).where(eq(items.id, item.id)))[0].isAvailable, true);
  assert.equal((await cancelDeletion(user.id)).status, "active");
});

test("a balance that would be forfeited needs the acknowledgement", async () => {
  const user = await makeUser("forfeit", { rentalBalance: "0.50" });
  await assert.rejects(requestDeletion(user.id, { acknowledgeForfeit: false }, deps()), (e: DeletionError) => e.code === "forfeit_acknowledgement_required");
  assert.equal((await userRow(user.id)).accountStatus, "active");
  assert.equal((await requestDeletion(user.id, { acknowledgeForfeit: true }, deps())).status, "pending_deletion");
});

test("blocked states are refused on request and on finalize, and nothing changes", async () => {
  const owner = await makeUser("blk-owner");
  const item = await makeItem(owner.id);
  const cases: { label: string; code: string; prepare: (userId: number) => Promise<void> }[] = [
    { label: "wallet at $10", code: "wallet_available", prepare: async (id) => void (await db.update(users).set({ rentalBalance: "10.00" }).where(eq(users.id, id))) },
    { label: "money held", code: "wallet_pending", prepare: async (id) => void (await db.update(users).set({ pendingRentalBalance: "5.00" }).where(eq(users.id, id))) },
    { label: "open booking with a deposit", code: "open_requests", prepare: async (id) => void (await makeRequest(item.id, id, { status: "ACCEPTED", depositPaymentIntentId: "pi_test_blocked" })) },
    { label: "open claim", code: "open_claims", prepare: async (id) => {
      const request = await makeRequest(item.id, id);
      await db.insert(securityClaims).values({ requestId: request.id, ownerId: owner.id, borrowerId: id, claimType: "DAMAGE", reason: "x", requestedAmount: "10.00", status: "OPEN" } as any);
    } },
    { label: "payout in progress", code: "payout_unsettled", prepare: async (id) => void (await db.insert(rentalPayouts).values({ userId: id, amount: "5.00", rentalAmount: "5.00", netAmount: "5.00", status: "pending_payout" } as any)) },
  ];
  for (const c of cases) {
    const user = await makeUser(`blk-${c.code}`);
    await c.prepare(user.id);
    await assert.rejects(requestDeletion(user.id, { acknowledgeForfeit: true }, deps()), (e: DeletionError) => e.code === "blocked" && !!e.blockers?.some((b) => b.code === c.code), c.label);
    assert.equal((await userRow(user.id)).accountStatus, "active", c.label);

    // Blocked after the request (the booking came later): finalize refuses too and the account is untouched.
    await pending(user.id);
    stripeCalls.length = 0;
    await assert.rejects(finalizeDeletion(user.id, deps()), (e: DeletionError) => e.code === "blocked", c.label);
    const row = await userRow(user.id);
    assert.equal(row.accountStatus, "pending_deletion", c.label);
    assert.equal(row.username, user.username, c.label);
    assert.equal(stripeCalls.length, 0, `${c.label}: Stripe is not touched for a blocked account`);
  }
});

test("finalize anonymises the account, keeps the books, scrubs only the deleting user's side, and keeps evidence", async () => {
  const subject = await makeUser("subject", {
    authProvider: "google", googleId: `${UNIQUE}-gid`, email: `${UNIQUE}-subject@gmail.com`, fullName: "Sam Subject", bio: "my bio", phone: "555", profilePhoto: "/uploads/me.jpg",
    stripeCustomerId: "cus_test_1", rentalBalance: "0.40",
  });
  const other = await makeUser("other");
  const subjectItem = await makeItem(subject.id);
  const otherItem = await makeItem(other.id);

  // S borrowed from O: S's message is scrubbed, O's return notes stay.
  const asBorrower = await makeRequest(otherItem.id, subject.id, { message: "hello from S", returnConditionNotes: "O's notes", handoffPin: "1234", cancelReason: null });
  await db.insert(deliveryArrangements).values({ requestId: asBorrower.id, deliveryType: "delivery", deliveryAddress: "S's door", pickupAddress: "O's door", specialInstructions: "ring twice" } as any);
  // O borrowed from S: O's message stays, S's return notes go; one booking has a dispute, one a claim, one neither.
  const plain = await makeRequest(subjectItem.id, other.id, { message: "O asks", returnConditionNotes: "S's notes", handoffPin: "1111", handoffProofOwner: "S plain proof", returnDisputeReason: "S plain reason" });
  const disputed = await makeRequest(subjectItem.id, other.id, { returnDisputeTriggered: true, returnDisputePhotoUrl: "/uploads/evidence.jpg", returnDisputeReason: "S's reason", handoffPin: "9999", handoffProofOwner: "S dispute proof" });
  const claimed = await makeRequest(subjectItem.id, other.id, { handoffPin: "7777", handoffProofOwner: "S claim proof" });
  await db.insert(securityClaims).values({ requestId: claimed.id, ownerId: subject.id, borrowerId: other.id, claimType: "DAMAGE", reason: "damaged", requestedAmount: "20.00", status: "CLOSED" } as any);
  for (const [request, notes] of [[plain, "plain return notes"], [disputed, "disputed return notes"], [claimed, "claimed return notes"]] as const) {
    await db.insert(rentalReturns).values({ requestId: request.id, itemId: subjectItem.id, renterId: other.id, ownerId: subject.id, notes } as any);
  }
  await db.insert(requestLifecycleEvents).values({ requestId: plain.id, eventType: "request_note", actorId: subject.id, idempotencyKey: `${UNIQUE}-ev`, details: { message: "free text", itemName: "Drill", nested: { note: "n", amount: 5 } } } as any);

  await db.insert(messages).values([
    { content: "S secret", senderId: subject.id, receiverId: other.id, requestId: plain.id },
    { content: "O reply", senderId: other.id, receiverId: subject.id, requestId: plain.id },
    { content: "Booking accepted", senderId: subject.id, receiverId: other.id, requestId: plain.id, messageType: "event" },
  ] as any);
  const [bySubject] = await db.insert(userReviews).values({ reviewerId: subject.id, reviewedUserId: other.id, rating: 5, comment: "S about O", transactionId: asBorrower.id }).returning();
  const [aboutSubject] = await db.insert(userReviews).values({ reviewerId: other.id, reviewedUserId: subject.id, rating: 2, comment: "O about S", transactionId: plain.id }).returning();
  await db.insert(notifications).values({ userId: subject.id, type: "x", title: "t", message: "m" } as any);
  const [list] = await db.insert(wishlists).values({ userId: subject.id, itemName: "wanted" } as any).returning();
  await db.insert(wishlistOffers).values({ userId: other.id, wishlistId: list.id } as any);
  await db.insert(userPushTokens).values({ userId: subject.id, token: `${UNIQUE}-tok` } as any);
  await db.insert(shareCoinsTransactions).values({ userId: subject.id, amount: "5.00", description: "d", transactionType: "earn" } as any);
  await db.insert(verifications).values({ userId: subject.id, fullName: "Sam Subject", idNumber: "ID-1" } as any);
  await db.insert(userSubscriptions).values({ userId: subject.id, endDate: new Date(), status: "active" } as any);
  await db.insert(rentalPayouts).values({ userId: subject.id, requestId: plain.id, amount: "9.00", rentalAmount: "10.00", netAmount: "9.00", status: "paid_out" } as any);
  await db.insert(platformCommissions).values({ payerId: subject.id, amount: "1.00", commissionRate: "0.10", transactionType: "rental" } as any);

  await pending(subject.id);
  stripeCalls.length = 0;
  uploadsRemoved.length = 0;
  const result = await finalizeDeletion(subject.id, deps());
  assert.equal(result.alreadyDeleted, false);
  assert.deepEqual(stripeCalls.map((c) => c.customerId), ["cus_test_1"]);

  // The user row: stays, with unique placeholders and nothing identifying.
  const row = await userRow(subject.id);
  assert.equal(row.accountStatus, "deleted");
  assert.equal(row.username, `deleted-${subject.id}`);
  assert.equal(row.handle, `deleted-${subject.id}`);
  assert.equal(row.referralCode, `deleted-${subject.id}`);
  assert.equal(row.displayName, "Former member");
  for (const column of ["email", "googleId", "password", "fullName", "bio", "phone", "profilePhoto", "stripeCustomerId"] as const) assert.equal(row[column], null, column);
  assert.ok(row.deletionRequestedAt, "the request stays on the record");
  assert.equal(row.rentalBalance, "0.40", "the forfeited balance stays on the books");
  assert.deepEqual([...new Set(uploadsRemoved)].sort(), ["/uploads/item-photo.jpg", "/uploads/me.jpg"]);

  // The user's own rows are gone.
  for (const [table, where] of [
    [notifications, eq(notifications.userId, subject.id)], [wishlists, eq(wishlists.userId, subject.id)], [userPushTokens, eq(userPushTokens.userId, subject.id)],
    [shareCoinsTransactions, eq(shareCoinsTransactions.userId, subject.id)], [verifications, eq(verifications.userId, subject.id)],
  ] as const) assert.equal((await db.select().from(table as any).where(where)).length, 0);
  assert.equal((await db.select().from(wishlistOffers).where(eq(wishlistOffers.wishlistId, list.id))).length, 0, "offers on the deleted wishlist go too");

  // Reviews: those about the user go, those they wrote stay without the comment.
  assert.equal((await db.select().from(userReviews).where(eq(userReviews.id, aboutSubject.id))).length, 0);
  const kept = (await db.select().from(userReviews).where(eq(userReviews.id, bySubject.id)))[0];
  assert.equal(kept.rating, 5);
  assert.equal(kept.comment, null);

  // Messages: the user's text is scrubbed, the other side's and the event stay.
  const msgs = await db.select().from(messages).where(eq(messages.requestId, plain.id));
  assert.deepEqual(msgs.map((m) => m.content).sort(), ["Booking accepted", "O reply", "[Message removed]"]);

  // Bookings: the user's side is scrubbed, the other side's stays, evidence stays.
  const asBorrowerRow = await requestRow(asBorrower.id);
  assert.equal(asBorrowerRow.message, null);
  assert.equal(asBorrowerRow.returnConditionNotes, "O's notes");
  assert.equal(asBorrowerRow.handoffPin, null);
  const delivery = (await db.select().from(deliveryArrangements).where(eq(deliveryArrangements.requestId, asBorrower.id)))[0];
  assert.equal(delivery.deliveryAddress, null);
  assert.equal(delivery.pickupAddress, "O's door", "the owner's address is the owner's");
  assert.equal(delivery.specialInstructions, null);
  const plainRow = await requestRow(plain.id);
  assert.equal(plainRow.message, "O asks");
  assert.equal(plainRow.returnConditionNotes, null);
  assert.equal(plainRow.handoffPin, null);
  assert.equal(plainRow.handoffProofOwner, null);
  for (const [request, pin, proof] of [[disputed, "9999", "S dispute proof"], [claimed, "7777", "S claim proof"]] as const) {
    const evidence = await requestRow(request.id);
    assert.equal(evidence.handoffPin, pin);
    assert.equal(evidence.handoffProofOwner, proof);
  }
  assert.equal((await requestRow(disputed.id)).returnDisputePhotoUrl, "/uploads/evidence.jpg");
  assert.equal((await requestRow(disputed.id)).returnDisputeReason, "S's reason", "the dispute reason is evidence, like the photo");
  assert.equal(plainRow.returnDisputeReason, null, "without a dispute or claim it is just text");
  const returnNotes = async (id: number) => (await db.select().from(rentalReturns).where(eq(rentalReturns.requestId, id)))[0].notes;
  assert.equal(await returnNotes(plain.id), null, "return notes are cleared when nothing is disputed");
  assert.equal(await returnNotes(disputed.id), "disputed return notes", "kept as evidence of a dispute");
  assert.equal(await returnNotes(claimed.id), "claimed return notes", "kept as evidence of a claim");
  assert.ok(!uploadsRemoved.includes("/uploads/evidence.jpg"), "an evidence photo is not deleted from disk");

  // Lifecycle details lose free text; the books stay; the items are soft-deleted and emptied.
  const event = (await db.select().from(requestLifecycleEvents).where(eq(requestLifecycleEvents.idempotencyKey, `${UNIQUE}-ev`)))[0];
  assert.deepEqual(event.details, { itemName: "Drill", nested: { amount: 5 } });
  assert.equal((await db.select().from(rentalPayouts).where(eq(rentalPayouts.userId, subject.id))).length, 1);
  assert.equal((await db.select().from(platformCommissions).where(eq(platformCommissions.payerId, subject.id))).length, 1);
  assert.equal((await db.select().from(userSubscriptions).where(eq(userSubscriptions.userId, subject.id)))[0].status, "cancelled");
  const item = (await db.select().from(items).where(eq(items.id, subjectItem.id)))[0];
  assert.equal(item.isDeleted, true);
  assert.equal(item.isAvailable, false);
  assert.equal(item.description, "");
  assert.deepEqual(item.photos, []);
  assert.equal(item.address, null);
  assert.equal(item.latitude, null);
  assert.equal((await db.select().from(items).where(eq(items.id, otherItem.id)))[0].description, "A private description", "the other member's listing is untouched");

  assert.deepEqual(sent.deleted.at(-1), { to: subject.email! });

  // Running it again does nothing: no second email, no second Stripe call, same row.
  const mailBefore = sent.deleted.length;
  stripeCalls.length = 0;
  const second = await finalizeDeletion(subject.id, deps());
  assert.deepEqual(second, { deleted: true, alreadyDeleted: true, requestsCancelled: 0 });
  assert.equal(sent.deleted.length, mailBefore);
  assert.equal(stripeCalls.length, 0);
  assert.deepEqual(await userRow(subject.id), row);
});

test("two deleted accounts get distinct placeholders, so the unique columns hold", async () => {
  const a = await makeUser("twin-a");
  const b = await makeUser("twin-b");
  for (const u of [a, b]) {
    await pending(u.id);
    await finalizeDeletion(u.id, deps());
  }
  const rows = await db.select().from(users).where(inArray(users.id, [a.id, b.id]));
  assert.equal(new Set(rows.map((r) => r.username)).size, 2);
  assert.equal(new Set(rows.map((r) => r.handle)).size, 2);
});

test("open bookings nothing has moved for are cancelled and the other side is told", async () => {
  const user = await makeUser("autoclose");
  const other = await makeUser("autoclose-other");
  const mine = await makeItem(user.id);
  const theirs = await makeItem(other.id);
  const incoming = await makeRequest(mine.id, other.id, { status: "PENDING" });
  const outgoing = await makeRequest(theirs.id, user.id, { status: "ACCEPTED" });
  await pending(user.id);
  const result = await finalizeDeletion(user.id, deps());
  assert.equal(result.requestsCancelled, 2);
  for (const id of [incoming.id, outgoing.id]) {
    const r = await requestRow(id);
    assert.equal(r.status, "CANCELLED");
    assert.equal(r.cancelledBy, user.id);
    assert.equal(r.cancelReason, "account_deleted");
  }
  const told = await db.select().from(notifications).where(eq(notifications.userId, other.id));
  assert.equal(told.length, 2);
  assert.ok(told.every((n) => !n.message.includes("@")), "no address in what the other side reads");
});

test("Stripe cleanup runs first; when it fails nothing is deleted and a retry succeeds", async () => {
  const user = await makeUser("stripe", { stripeCustomerId: "cus_test_2", stripeSubscriptionId: "sub_test_2", stripeConnectedAccountId: "acct_test_2" });
  await pending(user.id);
  let attempts = 0;
  const flaky = deps({ stripeCleanup: async (t) => { attempts++; stripeCalls.push(t); if (attempts === 1) throw new Error("stripe down"); } });
  await assert.rejects(finalizeDeletion(user.id, flaky), /stripe down/);
  assert.equal((await userRow(user.id)).username, user.username, "an account whose Stripe cleanup failed is untouched");
  await finalizeDeletion(user.id, flaky);
  assert.equal((await userRow(user.id)).accountStatus, "deleted");
  assert.deepEqual(stripeCalls.filter((c) => c.userId === user.id).at(-1), { userId: user.id, customerId: "cus_test_2", subscriptionId: "sub_test_2", connectedAccountId: "acct_test_2" });

  // With no cleanup configured, an account that has Stripe data is not deleted.
  const other = await makeUser("stripe-none", { stripeCustomerId: "cus_test_3" });
  await pending(other.id);
  await assert.rejects(finalizeDeletion(other.id, { ...deps(), stripeCleanup: undefined }), (e: DeletionError) => e.code === "stripe_cleanup_unavailable");
  assert.equal((await userRow(other.id)).accountStatus, "pending_deletion");
});

test("deleting a banned account records a keyed hash of the normalised email, and fails closed without the key", async () => {
  const user = await makeUser("banned", { email: `  ${UNIQUE}-Banned@Example.COM `, accountStatus: "banned", bannedAt: new Date(), deletionRequestedAt: new Date(Date.now() - 20 * 86_400_000) });
  await assert.rejects(finalizeDeletion(user.id, deps({ env: {} })), (e: Error) => e.name === "BannedEmailKeyMissingError");
  assert.equal((await userRow(user.id)).username, user.username, "nothing changed");

  await finalizeDeletion(user.id, deps());
  const expected = hashBannedEmail(`${UNIQUE}-banned@example.com`, { BANNED_EMAIL_HASH_KEY: KEY });
  hashes.push(expected);
  const stored = await db.select().from(bannedEmailHashes).where(eq(bannedEmailHashes.emailHash, expected));
  assert.equal(stored.length, 1);
  assert.ok(!JSON.stringify(stored).includes("example.com"), "no address is stored");
  assert.equal(await isBannedEmail(`${UNIQUE}-BANNED@example.com`, { BANNED_EMAIL_HASH_KEY: KEY }), true);
  assert.equal(await isBannedEmail(`${UNIQUE}-someone-else@example.com`, { BANNED_EMAIL_HASH_KEY: KEY }), false);

  // An account that was not banned leaves no hash behind.
  const before = (await db.select().from(bannedEmailHashes)).length;
  const plain = await makeUser("not-banned");
  await pending(plain.id);
  await finalizeDeletion(plain.id, deps());
  assert.equal((await db.select().from(bannedEmailHashes)).length, before);

  // And the banned address cannot register again.
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const res = await new Client(baseUrl).post("/api/register", { username: `${UNIQUE}-banned@example.com`, password: PASSWORD });
  assert.equal(res.status, 403, await res.clone().text());
});

test("the finalize job leaves recent requests alone, only counts in a dry run, and deletes in live mode", async () => {
  const due = await makeUser("job-due");
  const fresh = await makeUser("job-fresh");
  await pending(due.id);
  await db.update(users).set({ accountStatus: "pending_deletion", deletionRequestedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(users.id, fresh.id));
  const blockedUser = await makeUser("job-blocked", { pendingRentalBalance: "4.00" });
  await pending(blockedUser.id);

  const dry = await finalizeDueDeletions({ ...deps(), dryRun: true, limit: 500 });
  assert.ok(dry.wouldDelete >= 1 && dry.blocked >= 1);
  assert.equal((await userRow(due.id)).accountStatus, "pending_deletion", "a dry run deletes nothing");

  const live = await finalizeDueDeletions({ ...deps(), limit: 500 });
  assert.ok(live.deleted >= 1 && live.blocked >= 1);
  assert.equal((await userRow(due.id)).accountStatus, "deleted");
  assert.equal((await userRow(fresh.id)).accountStatus, "pending_deletion", "inside the grace period");
  assert.equal((await userRow(blockedUser.id)).accountStatus, "pending_deletion", "a blocked account waits");
});

test("a deleted account cannot sign in by password or Google, and its session ends", async () => {
  const user = await makeUser("signin", { authProvider: "google", googleId: `${UNIQUE}-gid-signin`, email: `${UNIQUE}-signin@gmail.com` });
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: user.username, password: PASSWORD })).status, 200);
  assert.equal((await client.get("/api/user")).status, 200);
  await client.fetchCsrfToken();

  // Through the API: request, then confirm. The session ends with the deletion.
  const requested = await client.post("/api/account/deletion/request", {});
  assert.equal(requested.status, 200, await requested.clone().text());
  const status = (await (await client.get("/api/account/status")).json()) as { accountStatus: string; deletionScheduledFor: string };
  assert.equal(status.accountStatus, "pending_deletion");
  assert.ok(status.deletionScheduledFor);
  assert.equal((await client.post("/api/account/deletion/confirm", {})).status, 400, "the final confirmation is required");
  const confirmed = await client.post("/api/account/deletion/confirm", { confirmDeletion: true });
  assert.equal(confirmed.status, 200, await confirmed.clone().text());
  assert.equal((await client.get("/api/user")).status, 401);
  assert.equal((await userRow(user.id)).accountStatus, "deleted");

  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  const login = await new Client(baseUrl).post("/api/login", { username: user.username, password: PASSWORD });
  assert.equal(login.status, 401, "the old username no longer exists");
  await pool.query("DELETE FROM rate_limit_store WHERE key LIKE 'auth:%'");
  assert.equal((await new Client(baseUrl).post("/api/login", { username: `deleted-${user.id}`, password: PASSWORD })).status, 401, "nor does the placeholder accept a password");

  // Google no longer finds the old account: it either refuses or starts a brand-new one, never signs into the deleted row.
  const strategy = (passport as any)._strategy("google");
  const outcome = await new Promise<{ user: { id: number } | false }>((resolve) => {
    const profile = { id: `${UNIQUE}-gid-signin`, emails: [{ value: `${UNIQUE}-signin@gmail.com`, verified: true }], displayName: "Again", _json: { email_verified: true } };
    strategy._verify({ session: {} }, "access", "refresh", profile, (_err: unknown, found: any) => resolve({ user: found }));
  });
  if (outcome.user) {
    userIds.push(outcome.user.id);
    assert.notEqual(outcome.user.id, user.id);
  }
});

test("a signed-out caller and a deleted account's old session get 401 from the deletion routes", async () => {
  const client = new Client(baseUrl);
  await client.fetchCsrfToken();
  for (const route of ["request", "cancel", "confirm"]) assert.equal((await client.post(`/api/account/deletion/${route}`, { confirmDeletion: true })).status, 401, route);
});

test("a deactivated account, or one already deleting, cannot be put through a second request", async () => {
  const user = await makeUser("inactive", { accountStatus: "deactivated" });
  await assert.rejects(requestDeletion(user.id, { acknowledgeForfeit: true }, deps()), (e: DeletionError) => e.code === "account_not_active");
  await assert.rejects(finalizeDeletion(user.id, deps()), (e: DeletionError) => e.code === "deletion_not_requested");
});

test("unbanning someone who had asked to be deleted puts them back to waiting", async () => {
  const admin = await makeUser("unban-admin", { isAdmin: true });
  const user = await makeUser("unban", { accountStatus: "banned", bannedAt: new Date(), deletionRequestedAt: new Date() });
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: admin.username, password: PASSWORD })).status, 200);
  await client.fetchCsrfToken();
  assert.equal((await client.post(`/api/admin/users/${user.id}/unban`, {})).status, 200);
  assert.equal((await userRow(user.id)).accountStatus, "pending_deletion");
  const plain = await makeUser("unban-plain", { accountStatus: "banned", bannedAt: new Date() });
  assert.equal((await client.post(`/api/admin/users/${plain.id}/unban`, {})).status, 200);
  assert.equal((await userRow(plain.id)).accountStatus, "active");
});


test("a Connect account Stripe refuses is recorded for staff, the deletion goes on, and later runs retry until it works", async () => {
  const user = await makeUser("connect", { stripeConnectedAccountId: "acct_test_refused" });
  await pending(user.id);
  await finalizeDeletion(user.id, deps({ stripeCleanup: async () => ({ connectRefused: "account still has a balance" }) }));
  assert.equal((await userRow(user.id)).accountStatus, "deleted");
  const failureRows = () => db.select().from(connectCleanupFailures).where(eq(connectCleanupFailures.userId, user.id));
  const [recorded] = await failureRows();
  assert.deepEqual([recorded.connectedAccountId, recorded.reason, recorded.attempts, recorded.resolvedAt], ["acct_test_refused", "account still has a balance", 1, null]);

  // Admins see it.
  const admin = await makeUser("connect-admin", { isAdmin: true });
  const client = new Client(baseUrl);
  assert.equal((await client.post("/api/login", { username: admin.username, password: PASSWORD })).status, 200);
  const listed = (await (await client.get("/api/admin/connect-cleanup-failures")).json()) as { userId: number; reason: string }[];
  assert.ok(listed.some((f) => f.userId === user.id && f.reason === "account still has a balance"));
  const plain = new Client(baseUrl);
  const regular = await makeUser("connect-regular");
  assert.equal((await plain.post("/api/login", { username: regular.username, password: PASSWORD })).status, 200);
  assert.equal((await plain.get("/api/admin/connect-cleanup-failures")).status, 403);

  // A run in which Stripe still refuses keeps it on the list and counts the attempt.
  const refused = await retryConnectFailures({ deleteConnectAccount: async () => { throw new Error("still has a balance"); } });
  assert.ok(refused.tried >= 1);
  const [again] = await failureRows();
  assert.deepEqual([again.attempts, again.reason, again.resolvedAt], [2, "still has a balance", null]);

  // A later live job run retries it, and Stripe lets go.
  const asked: string[] = [];
  const run = await finalizeDueDeletions({ ...deps(), limit: 0, deleteConnectAccount: async (id) => void asked.push(id) });
  assert.ok(run.connectResolved >= 1);
  assert.ok(asked.includes("acct_test_refused"));
  const [done] = await failureRows();
  assert.ok(done.resolvedAt);
  assert.equal(done.attempts, 3);
  assert.ok(!((await (await client.get("/api/admin/connect-cleanup-failures")).json()) as { userId: number }[]).some((f) => f.userId === user.id));

  // Resolved ones are not tried again, and a dry run retries nothing.
  asked.length = 0;
  await finalizeDueDeletions({ ...deps(), limit: 0, deleteConnectAccount: async (id) => void asked.push(id) });
  assert.ok(!asked.includes("acct_test_refused"));
  const other = await makeUser("connect-dry", { stripeConnectedAccountId: "acct_test_dry" });
  await pending(other.id);
  await finalizeDeletion(other.id, deps({ stripeCleanup: async () => ({ connectRefused: "balance" }) }));
  asked.length = 0;
  await finalizeDueDeletions({ ...deps(), limit: 0, dryRun: true, deleteConnectAccount: async (id) => void asked.push(id) });
  assert.deepEqual(asked, []);
});
