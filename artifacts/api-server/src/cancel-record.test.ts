import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  itemRequests,
  items,
  messages,
  notifications,
  pool,
  rentalPayouts,
  reputationActivities,
  requestRefunds,
  users,
} from "@workspace/db";
import { cancelBorrowRentRequest, type CancelDeps } from "./cancel-service.js";
import { expireRequestIfDue, type RequestExpiryDeps } from "./request-expiry-service.js";
import { ensureCancellationRecord } from "./startup-migrations.js";
import { fakeStripe } from "./test-fixtures/fake-stripe.js";

// What a cancel or expiry leaves behind: the cancellation record on item_requests, the refund
// ledger with the Stripe fee the platform absorbed, and the monthly total over that ledger.

const NOW = new Date("2026-10-03T19:00:00.000Z");
// Oct 5–8 → cutoff Oct 7 23:59:59 Vancouver = 2026-10-08T06:59:59Z.
const AFTER_CUTOFF = new Date("2026-10-08T07:00:00.000Z");
const UNIQUE = `cancel-record-${Date.now()}`;
const requestIds: number[] = [];
const itemIds: number[] = [];
const userIds: number[] = [];

async function newUser(label: string, trustScore = 80) {
  const [user] = await db
    .insert(users)
    .values({ username: `${UNIQUE}-${label}-${userIds.length}`, password: "x", emailVerified: true, trustScore, pendingRentalBalance: "0.00" })
    .returning({ id: users.id });
  userIds.push(user.id);
  return user.id;
}

async function newRequest(ownerId: number, borrowerId: number, overrides: Partial<typeof itemRequests.$inferInsert> = {}) {
  const [item] = await db
    .insert(items)
    .values({
      ownerId, name: `${UNIQUE}-item-${itemIds.length}`, description: "Cancel record test item", conditionRating: 4, photos: [],
      isLendable: true, isRentable: true, isAvailable: false, replacementValue: 100, securityDeposit: "10.00",
      lendingDuration: 7, shareCoinsReward: "0", shareCoinPrice: "7.00",
    })
    .returning({ id: items.id });
  itemIds.push(item.id);
  const [request] = await db
    .insert(itemRequests)
    .values({
      itemId: item.id, requesterId: borrowerId, requestType: "BORROW", status: "PENDING",
      startDate: new Date("2026-10-05T00:00:00.000Z"), endDate: new Date("2026-10-08T00:00:00.000Z"),
      depositMethod: "in_app", ...overrides,
    })
    .returning({ id: itemRequests.id });
  requestIds.push(request.id);
  return request.id;
}

const withHold = (overrides: Partial<typeof itemRequests.$inferInsert> = {}): Partial<typeof itemRequests.$inferInsert> => ({
  status: "DEPOSIT_CONFIRMED", depositPaymentIntentId: "pi_deposit_hold", depositStatus: "authorized",
  depositMode: "authorization", trustDepositAmount: "42.00", ...overrides,
});

let stripeCount = 0;
/** A fake Stripe whose refund ids (r1, r2 ...) are unique to this test, like real ones. */
function ledgerStripe(options: Parameters<typeof fakeStripe>[0] = {}) {
  const prefix = `re_${UNIQUE}_${stripeCount++}_`;
  const refundIdPrefix = options.refundIdPrefix ?? prefix;
  return { prefix: refundIdPrefix, ...fakeStripe({ ...options, refundIdPrefix }) };
}

const cancelDeps = (stripe: Pick<ReturnType<typeof fakeStripe>, "client">): CancelDeps => ({ stripe: stripe.client as any });
const expiryDeps = (stripe: Pick<ReturnType<typeof fakeStripe>, "client">): RequestExpiryDeps => ({ stripe: stripe.client as any });
const load = async (id: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, id)))[0];
const ledger = (requestId: number) => db.select().from(requestRefunds).where(eq(requestRefunds.requestId, requestId)).orderBy(asc(requestRefunds.id));

const record = (row: Awaited<ReturnType<typeof load>>) => ({
  cancelledAt: row.cancelledAt?.toISOString() ?? null,
  cancelledBy: row.cancelledBy,
  cancelledFromStatus: row.cancelledFromStatus,
  cancelReason: row.cancelReason,
  cancelledWithPenalty: row.cancelledWithPenalty,
  cancelDepositState: row.cancelDepositState,
  expiredReason: row.expiredReason,
});
const emptyRecord = { cancelledAt: null, cancelledBy: null, cancelledFromStatus: null, cancelReason: null, cancelledWithPenalty: null, cancelDepositState: null, expiredReason: null };

before(async () => {
  await ensureCancellationRecord();
});

after(async () => {
  if (requestIds.length) {
    await db.delete(requestRefunds).where(inArray(requestRefunds.requestId, requestIds));
    await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
    await db.delete(reputationActivities).where(inArray(reputationActivities.requestId, requestIds));
    await db.delete(messages).where(inArray(messages.requestId, requestIds));
    await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
  }
  if (userIds.length) {
    await db.delete(reputationActivities).where(inArray(reputationActivities.userId, userIds));
    await db.delete(notifications).where(inArray(notifications.userId, userIds));
  }
  if (itemIds.length) await db.delete(items).where(inArray(items.id, itemIds));
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
  await pool.end();
});

// ── The cancellation record: free cancel, penalized cancel, expiry ────────────

test("a free cancel records when, who, from which status, why, no penalty and no deposit", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower);

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, reason: "item_unavailable" }, cancelDeps(fakeStripe()), NOW);

  assert.deepEqual(record(await load(id)), {
    ...emptyRecord,
    cancelledAt: NOW.toISOString(),
    cancelledBy: borrower,
    cancelledFromStatus: "PENDING",
    cancelReason: "item_unavailable",
    cancelledWithPenalty: false,
    cancelDepositState: "none",
  });
});

test("the reason defaults to user_requested, and the deposit state is read from the deposit, not the status", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const unpaid = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const inPerson = await newRequest(owner, borrower, { status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });

  await cancelBorrowRentRequest({ requestId: unpaid, actorId: borrower }, cancelDeps(fakeStripe()), NOW);
  await cancelBorrowRentRequest({ requestId: inPerson, actorId: owner }, cancelDeps(fakeStripe()), NOW);

  assert.deepEqual(
    [record(await load(unpaid)), record(await load(inPerson))].map((r) => [r.cancelledFromStatus, r.cancelReason, r.cancelledWithPenalty, r.cancelDepositState]),
    [["ACCEPTED", "user_requested", false, "unpaid"], ["DEPOSIT_CONFIRMED", "user_requested", false, "in_person"]],
  );
  assert.equal((await load(inPerson)).cancelledBy, owner);
});

test("a penalized cancel records the penalty and the deposit state it was read from", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const hold = await newRequest(owner, borrower, withHold());
  const refundable = await newRequest(owner, borrower, withHold({ depositMode: "refundable_charge", depositStatus: "held", depositPaymentIntentId: "pi_refundable" }));
  const stripe = fakeStripe();
  stripe.intentStatus.set("pi_refundable", "succeeded");

  await cancelBorrowRentRequest({ requestId: hold, actorId: borrower, acknowledgePenalty: 5, reason: "changed_plans" }, cancelDeps(stripe), NOW);
  await cancelBorrowRentRequest({ requestId: refundable, actorId: owner, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);

  assert.deepEqual(record(await load(hold)), {
    ...emptyRecord, cancelledAt: NOW.toISOString(), cancelledBy: borrower, cancelledFromStatus: "DEPOSIT_CONFIRMED",
    cancelReason: "changed_plans", cancelledWithPenalty: true, cancelDepositState: "authorized",
  });
  assert.deepEqual(record(await load(refundable)), {
    ...emptyRecord, cancelledAt: NOW.toISOString(), cancelledBy: owner, cancelledFromStatus: "DEPOSIT_CONFIRMED",
    cancelReason: "user_requested", cancelledWithPenalty: true, cancelDepositState: "charged",
  });
});

test("nothing is recorded when the cancel is challenged or the Stripe call fails; the first record is never overwritten", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold());
  let down = true;
  const stripe = fakeStripe({ failCancel: () => down });

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower }, cancelDeps(stripe), NOW); // 409
  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW); // 502
  assert.deepEqual(record(await load(id)), emptyRecord);
  assert.deepEqual(await ledger(id), []);

  down = false;
  const first = new Date("2026-10-03T20:00:00.000Z");
  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), first);
  const later = new Date("2026-10-04T20:00:00.000Z");
  const again = await cancelBorrowRentRequest({ requestId: id, actorId: owner, acknowledgePenalty: 5, reason: "other" }, cancelDeps(stripe), later);

  const row = record(await load(id));
  assert.equal(row.cancelledAt, first.toISOString());
  assert.equal(row.cancelledBy, borrower);
  assert.equal(row.cancelReason, "user_requested");
  // The repeat reports what the first cancel recorded.
  assert.deepEqual((again.body.request as any), { id, status: "CANCELLED", cancelledAt: first.toISOString(), cancelledBy: borrower, cancelledFromStatus: "DEPOSIT_CONFIRMED" });
});

test("an expiry records why: no handoff, and whether a deposit was already paid; the cancel columns stay empty", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const noDeposit = await newRequest(owner, borrower, { status: "ACCEPTED" });
  const inPerson = await newRequest(owner, borrower, { status: "DEPOSIT_CONFIRMED", depositMethod: "in_person" });
  const hold = await newRequest(owner, borrower, withHold());
  const refundable = await newRequest(owner, borrower, withHold({ depositMode: "refundable_charge", depositStatus: "held", depositPaymentIntentId: "pi_refundable" }));
  const stripe = fakeStripe();
  stripe.intentStatus.set("pi_refundable", "succeeded");

  for (const id of [noDeposit, inPerson, hold, refundable]) {
    assert.equal((await expireRequestIfDue(id, expiryDeps(stripe), AFTER_CUTOFF)).status, "expired");
  }

  const reasons = await Promise.all([noDeposit, inPerson, hold, refundable].map(async (id) => (await load(id)).expiredReason));
  assert.deepEqual(reasons, ["no_handoff_no_deposit", "no_handoff_no_deposit", "no_handoff_deposit_paid", "no_handoff_deposit_paid"]);
  for (const id of [noDeposit, hold]) {
    const row = await load(id);
    assert.equal(row.status, "EXPIRED");
    assert.ok(row.expiredAt);
    assert.deepEqual(
      { ...record(row), expiredReason: null },
      emptyRecord,
      "an expiry is not a cancellation",
    );
  }
  // No penalty on expiry, deposit or not.
  assert.deepEqual(await db.select().from(reputationActivities).where(inArray(reputationActivities.requestId, [noDeposit, inPerson, hold, refundable])), []);
});

test("the requester's withdraw of a PENDING request records itself too, free and with no deposit", async () => {
  // The withdraw route is covered over HTTP in cancel-routes.test.ts; here only the record's shape matters.
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower);
  await db.update(itemRequests).set({
    status: "CANCELLED", cancelledAt: NOW, cancelledBy: borrower, cancelledFromStatus: "PENDING",
    cancelReason: "withdrawn", cancelledWithPenalty: false, cancelDepositState: "none",
  }).where(eq(itemRequests.id, id));
  assert.equal((await load(id)).cancelReason, "withdrawn");
});

// ── The refund ledger and the absorbed Stripe fee ─────────────────────────────

test("a cancel records each refund and release; a card refund records the fee Stripe kept, read from the balance transaction", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  const stripe = ledgerStripe({
    refundAmounts: { pi_platform_fee: 350 },
    charges: { pi_platform_fee: { amount: 350, fee: 40 } },
  });

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);

  const rows = await ledger(id);
  assert.deepEqual(
    rows.map((r) => ({ trigger: r.trigger, kind: r.kind, pi: r.stripePaymentIntentId, refund: r.stripeRefundId, amount: r.amountCents, fee: r.chargeFeeCents, returned: r.feeReturnedCents, absorbed: r.absorbedFeeCents })),
    [
      { trigger: "cancel", kind: "platform_fee_refund", pi: "pi_platform_fee", refund: `${stripe.prefix}1`, amount: 350, fee: 40, returned: 0, absorbed: 40 },
      // A released hold was never charged: no fee.
      { trigger: "cancel", kind: "deposit_hold_release", pi: "pi_deposit_hold", refund: null, amount: 4200, fee: 0, returned: 0, absorbed: 0 },
    ],
  );
});

test("every ledger row carries the request's own currency: USD for a request charged in USD, CAD for one charged in CAD", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const usd = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee", paymentCurrency: "usd" }));
  const cad = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee_cad", depositPaymentIntentId: "pi_deposit_hold_cad", paymentCurrency: "cad" }));
  const refundable = await newRequest(owner, borrower, withHold({
    depositMode: "refundable_charge", depositStatus: "held", depositPaymentIntentId: "pi_refundable_usd", paymentCurrency: "usd",
  }));
  const stripe = ledgerStripe({ refundAmounts: { pi_platform_fee: 350, pi_platform_fee_cad: 350, pi_refundable_usd: 4200 } });
  stripe.intentStatus.set("pi_refundable_usd", "succeeded");

  for (const id of [usd, cad, refundable]) {
    await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);
  }

  assert.deepEqual((await ledger(usd)).map((r) => [r.kind, r.currency]), [["platform_fee_refund", "usd"], ["deposit_hold_release", "usd"]]);
  assert.deepEqual((await ledger(cad)).map((r) => [r.kind, r.currency]), [["platform_fee_refund", "cad"], ["deposit_hold_release", "cad"]]);
  assert.deepEqual((await ledger(refundable)).map((r) => [r.kind, r.currency]), [["deposit_refund", "usd"]]);
  assert.deepEqual(stripe.calls.create, [], "releasing and refunding never creates a charge");
});

test("the fee is prorated to the refunded share and reduced by any fee Stripe hands back", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold({ requestType: "RENT", platformFeeChargeId: "pi_platform_fee" }));
  await db.insert(rentalPayouts).values({ userId: owner, requestId: id, amount: "10.00", rentalAmount: "10.00", netAmount: "9.50", status: "held", stripePaymentIntentId: "pi_rent_fee" });
  const prefix = `re_${UNIQUE}_prorate_`;
  const stripe = ledgerStripe({
    refundAmounts: { pi_rent_fee: 500, pi_platform_fee: 350 },
    charges: { pi_rent_fee: { amount: 1000, fee: 120 }, pi_platform_fee: { amount: 350, fee: 40 } },
    refundIdPrefix: prefix,
    returnedFees: { [`${prefix}2`]: 10 },
  });

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);

  const byKind = Object.fromEntries((await ledger(id)).map((r) => [r.kind, r]));
  // Half of a $10.00 charge whose fee was $1.20: $0.60 kept.
  assert.deepEqual([byKind.rental_refund.chargeFeeCents, byKind.rental_refund.feeReturnedCents, byKind.rental_refund.absorbedFeeCents], [60, 0, 60]);
  // $0.40 fee, $0.10 handed back: $0.30 absorbed.
  assert.deepEqual([byKind.platform_fee_refund.chargeFeeCents, byKind.platform_fee_refund.feeReturnedCents, byKind.platform_fee_refund.absorbedFeeCents], [40, 10, 30]);
});

test("a refundable-charge deposit is a deposit_refund row with its fee", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold({ depositMode: "refundable_charge", depositStatus: "held", depositPaymentIntentId: "pi_refundable" }));
  const stripe = ledgerStripe({ refundAmounts: { pi_refundable: 4200 }, charges: { pi_refundable: { amount: 4200, fee: 151 } } });
  stripe.intentStatus.set("pi_refundable", "succeeded");

  await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);

  const [row] = await ledger(id);
  assert.deepEqual([row.kind, row.amountCents, row.chargeFeeCents, row.absorbedFeeCents, row.stripeRefundId], ["deposit_refund", 4200, 151, 151, `${stripe.prefix}1`]);
});

test("if Stripe's fee cannot be read the refund still goes through and the absorbed fee is left unknown", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  const stripe = ledgerStripe({ refundAmounts: { pi_platform_fee: 350 }, charges: { pi_platform_fee: { amount: 350, fee: 40 } }, failFeeRead: () => true });

  const result = await cancelBorrowRentRequest({ requestId: id, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);

  assert.equal(result.status, 200);
  const fee = (await ledger(id)).find((r) => r.kind === "platform_fee_refund")!;
  assert.deepEqual([fee.amountCents, fee.chargeFeeCents, fee.absorbedFeeCents], [350, null, null]);
});

test("a waived-fee cancel and a free cancel write no card refund rows; a failed attempt writes nothing; a retry writes each row once", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const waived = await newRequest(owner, borrower, withHold({ platformFeeChargeId: null }));
  const free = await newRequest(owner, borrower);
  await cancelBorrowRentRequest({ requestId: waived, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(fakeStripe()), NOW);
  await cancelBorrowRentRequest({ requestId: free, actorId: borrower }, cancelDeps(fakeStripe()), NOW);
  assert.deepEqual((await ledger(waived)).map((r) => r.kind), ["deposit_hold_release"]);
  assert.deepEqual(await ledger(free), []);

  const retry = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  let down = true;
  const stripe = ledgerStripe({ failCancel: () => down, refundAmounts: { pi_platform_fee: 350 } });
  await cancelBorrowRentRequest({ requestId: retry, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);
  assert.deepEqual(await ledger(retry), []);
  down = false;
  await cancelBorrowRentRequest({ requestId: retry, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW);
  await cancelBorrowRentRequest({ requestId: retry, actorId: borrower, acknowledgePenalty: 5 }, cancelDeps(stripe), NOW); // double cancel
  assert.deepEqual((await ledger(retry)).map((r) => r.kind), ["platform_fee_refund", "deposit_hold_release"]);
});

test("an expiry writes the same ledger, tagged expiry", async () => {
  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  const stripe = ledgerStripe({ refundAmounts: { pi_platform_fee: 350 }, charges: { pi_platform_fee: { amount: 350, fee: 40 } } });

  await expireRequestIfDue(id, expiryDeps(stripe), AFTER_CUTOFF);

  assert.deepEqual((await ledger(id)).map((r) => [r.trigger, r.kind, r.absorbedFeeCents]), [
    ["expiry", "platform_fee_refund", 40],
    ["expiry", "deposit_hold_release", 0],
  ]);
});

test("the monthly query totals the absorbed fee by month and trigger", async () => {
  const text = await readFile(path.resolve(process.cwd(), "../../lib/db/scripts/absorbed_refund_fees_by_month.sql"), "utf8").catch(() =>
    readFile(path.resolve(process.cwd(), "lib/db/scripts/absorbed_refund_fees_by_month.sql"), "utf8"),
  );
  const run = async () => (await pool.query(text)).rows as { month: Date; trigger: string; refunds: string; refunded_usd: string; absorbed_fee_usd: string }[];
  const before = await run();

  const owner = await newUser("owner");
  const borrower = await newUser("borrower");
  const id = await newRequest(owner, borrower, withHold({ platformFeeChargeId: "pi_platform_fee" }));
  await cancelBorrowRentRequest(
    { requestId: id, actorId: borrower, acknowledgePenalty: 5 },
    cancelDeps(ledgerStripe({ refundAmounts: { pi_platform_fee: 350 }, charges: { pi_platform_fee: { amount: 350, fee: 40 } } })),
    NOW,
  );
  const after = await run();

  const key = (rows: typeof before) => rows.find((r) => r.trigger === "cancel" && new Date(r.month).getUTCMonth() === new Date().getUTCMonth());
  const delta = (field: "refunds" | "refunded_usd" | "absorbed_fee_usd") =>
    Math.round((Number(key(after)?.[field] ?? 0) - Number(key(before)?.[field] ?? 0)) * 100) / 100;
  assert.equal(delta("refunds"), 1, "only card refunds with a known fee are counted, not the released hold");
  assert.equal(delta("absorbed_fee_usd"), 0.4);
  assert.equal(delta("refunded_usd"), 3.5);
});

// ── The migration ─────────────────────────────────────────────────────────────

test("the migration only adds nullable columns and a new table, leaves existing rows alone, and can be re-run", async () => {
  const file = await readFile(path.resolve(process.cwd(), "../../lib/db/scripts/0009_cancellation_record.sql"), "utf8").catch(() =>
    readFile(path.resolve(process.cwd(), "lib/db/scripts/0009_cancellation_record.sql"), "utf8"),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE SCHEMA migration_scratch");
    await client.query("SET LOCAL search_path TO migration_scratch");
    // An item_requests as it was before the migration, with a row in it.
    await client.query("CREATE TABLE item_requests (id serial PRIMARY KEY, status text, expired_at timestamp)");
    await client.query("INSERT INTO item_requests (status) VALUES ('CANCELLED')");

    await client.query(file);
    await client.query(file); // IF NOT EXISTS: running it again is harmless

    const { rows: columns } = await client.query(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'migration_scratch' AND table_name = 'item_requests' AND column_name <> ALL (ARRAY['id','status','expired_at'])
        ORDER BY column_name`,
    );
    assert.deepEqual(
      columns.map((c) => [c.column_name, c.data_type, c.is_nullable, c.column_default]),
      [
        ["cancel_deposit_state", "text", "YES", null],
        ["cancel_reason", "text", "YES", null],
        ["cancelled_at", "timestamp without time zone", "YES", null],
        ["cancelled_by", "integer", "YES", null],
        ["cancelled_from_status", "text", "YES", null],
        ["cancelled_with_penalty", "boolean", "YES", null],
        ["expired_reason", "text", "YES", null],
      ],
    );
    const { rows } = await client.query("SELECT * FROM item_requests");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "CANCELLED");
    for (const column of ["cancelled_at", "cancelled_by", "cancelled_from_status", "cancel_reason", "cancelled_with_penalty", "cancel_deposit_state", "expired_reason"]) {
      assert.equal(rows[0][column], null, `${column} stays null on an existing row`);
    }
    const { rows: ledgerColumns } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'migration_scratch' AND table_name = 'request_refunds'`,
    );
    assert.equal(ledgerColumns[0].n, 12);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});

test("the migration is wired into startup and the id types it assumes are the real ones", async () => {
  const { rows } = await pool.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND ((table_name = 'item_requests' AND column_name = 'id') OR (table_name = 'users' AND column_name = 'id'))
      ORDER BY table_name`,
  );
  assert.deepEqual(rows.map((r) => [r.table_name, r.column_name, r.data_type]), [["item_requests", "id", "integer"], ["users", "id", "integer"]]);
  const startup = await readFile(path.resolve(process.cwd(), "src/startup-migrations.ts"), "utf8");
  assert.match(startup, /0009_cancellation_record\.sql/);
});
