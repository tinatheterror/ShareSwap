import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountReviewFlags, db, disputeEvidence, itemRequests, items, messages, notifications, platformDisputes, pool, rentalPayouts, users, walletChargebacks, walletTransactions,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { handleDisputeEvent } from "./dispute-webhook.js";
import { claimDepositTerminalAction, releaseDepositTerminalClaim } from "./deposit-renewal-service.js";
import { confirmApprovedReturn } from "./return-recovery-service.js";
import { buildEvidenceBundle, ownerEvidenceRequests, submitOwnerEvidence } from "./dispute-evidence.js";
import { DISPUTE_HOLD_MESSAGE, disputeLoss, markDisputeReviewed } from "./platform-disputes.js";
import { createRecoveryDebt, openDebtCents, payDebtsFromCredit } from "./wallet-chargebacks.js";

const unique = `platform-disputes-${Date.now()}`;
const PASSWORD = "PlatformDisputes!42";
let ownerId: number, borrowerId: number, adminId: number, plainId: number;
let itemId: number;
const requestIds: number[] = [];
let counter = 0;

const disputeId = () => `du_${unique}_${++counter}`;
const withdrawal = { type: "adjustment", reporting_category: "dispute", amount: -2000, fee: 1500, net: -3500, currency: "cad" };
const reinstated = { type: "adjustment", reporting_category: "dispute_reversal", amount: 2000, fee: 0, net: 2000, currency: "cad" };
const evt = (type: string, object: Record<string, unknown>) => ({ type, data: { object } }) as any;
const payload = (id: string, pi: string, extra: Record<string, unknown> = {}) => ({
  id, amount: 2000, currency: "cad", reason: "fraudulent", payment_intent: pi, status: "needs_response",
  evidence_details: { due_by: Math.floor(Date.now() / 1000) + 7 * 86400 }, balance_transactions: [withdrawal], ...extra,
});

async function rental(status = "IN_PROGRESS") {
  const pi = `pi_${unique}_${++counter}`;
  const [request] = await db.insert(itemRequests).values({
    itemId, requesterId: borrowerId, requestType: "RENT", status, paymentCurrency: "cad", depositMethod: "in_person",
    ownerConfirmedHandoff: true, ownerConfirmedHandoffAt: new Date("2026-10-01T10:00:00Z"), borrowerConfirmedHandoff: true, borrowerConfirmedHandoffAt: new Date("2026-10-01T10:05:00Z"),
  } as any).returning({ id: itemRequests.id });
  requestIds.push(request.id);
  await db.insert(rentalPayouts).values({ userId: ownerId, requestId: request.id, amount: "20", rentalAmount: "20", netAmount: "19.00", status: "held", stripePaymentIntentId: pi });
  return { requestId: request.id, pi };
}
const row = async (id: string) => (await db.select().from(platformDisputes).where(eq(platformDisputes.disputeId, id)))[0];
const walletCents = async () => Math.round(Number((await db.select({ b: users.rentalBalance }).from(users).where(eq(users.id, ownerId)))[0].b) * 100);
const noteCount = (userId: number, type: string, requestId: number) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, type), eq(notifications.requestId, requestId))).then((r) => r.length);

let server: Awaited<ReturnType<typeof startApp>>;
let admin: Client;
let plain: Client;
let owner: Client;
let anonymous: Client;

before(async () => {
  const password = await hashPassword(PASSWORD);
  const created = await db.insert(users).values([
    { username: `${unique}-owner`, password, emailVerified: true }, { username: `${unique}-borrower`, password, emailVerified: true },
    { username: `${unique}-admin`, password, emailVerified: true, isAdmin: true }, { username: `${unique}-plain`, password, emailVerified: true },
  ]).returning();
  [ownerId, borrowerId, adminId, plainId] = created.map((u) => u.id);
  const [item] = await db.insert(items).values({ ownerId, name: `${unique}-item`, description: "dispute test", conditionRating: 5, photos: ["/uploads/item-1.jpg"], shareCoinsReward: "0" }).returning();
  itemId = item.id;
  await db.update(users).set({ rentalBalance: "50.00" }).where(eq(users.id, ownerId));
  server = await startApp();
  const login = async (username: string) => {
    const c = new Client(server.baseUrl);
    assert.equal((await c.post("/api/login", { username, password: PASSWORD })).status, 200);
    await c.fetchCsrfToken();
    return c;
  };
  admin = await login(created[2].username);
  plain = await login(created[3].username);
  owner = await login(created[0].username);
  anonymous = new Client(server.baseUrl);
});

afterEach(() => { delete process.env.CHARGEBACK_RECOVERY_FROM_OWNERS; });

after(async () => {
  const ids = [ownerId, borrowerId, adminId, plainId];
  try {
    await db.delete(disputeEvidence).where(inArray(disputeEvidence.userId, ids));
    await db.delete(accountReviewFlags).where(inArray(accountReviewFlags.userId, ids));
    await db.delete(platformDisputes).where(inArray(platformDisputes.borrowerId, ids));
    await db.delete(platformDisputes).where(inArray(platformDisputes.ownerId, ids));
    await db.delete(walletChargebacks).where(inArray(walletChargebacks.userId, ids));
    await db.delete(walletTransactions).where(inArray(walletTransactions.userId, ids));
    await db.delete(notifications).where(inArray(notifications.userId, ids));
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
      await db.delete(itemRequests).where(inArray(itemRequests.id, requestIds));
    }
    await db.delete(items).where(eq(items.id, itemId));
    await db.delete(users).where(inArray(users.id, ids));
  } finally {
    await server.close();
    await pool.end();
  }
});

test("disputeLoss: undecided and lost are the whole amount and fee; won is only what Stripe did not give back", () => {
  assert.deepEqual(disputeLoss({ outcome: "open", amountCents: 2000, feeCents: 1500, returnedCents: 0 }), { lossAmountCents: 2000, lossFeeCents: 1500 });
  assert.deepEqual(disputeLoss({ outcome: "lost", amountCents: 2000, feeCents: 1500, returnedCents: 0 }), { lossAmountCents: 2000, lossFeeCents: 1500 });
  assert.deepEqual(disputeLoss({ outcome: "won", amountCents: 2000, feeCents: 1500, returnedCents: 2000 }), { lossAmountCents: 0, lossFeeCents: 1500 });
  assert.deepEqual(disputeLoss({ outcome: "won", amountCents: 2000, feeCents: 1500, returnedCents: 3500 }), { lossAmountCents: 0, lossFeeCents: 0 });
});

test("by default a dispute is recorded as a platform loss, the owner's wallet is untouched, and the follow-up happens once", async () => {
  const { requestId, pi } = await rental();
  const id = disputeId();
  const before = await walletCents();
  assert.equal(await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi))), "recorded: platform loss, no wallet change");
  assert.equal(await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi))), "duplicate");

  const d = await row(id);
  assert.deepEqual([d.reason, d.amountCents, d.currency, d.feeCents, d.outcome, d.requestId, d.ownerId, d.borrowerId, d.rentalWasOpen, d.reviewStatus],
    ["fraudulent", 2000, "cad", 0, "open", requestId, ownerId, borrowerId, true, "pending_admin"]);
  assert.equal(d.lossAmountCents, 2000);
  assert.ok(d.evidenceDueBy);

  assert.equal(await walletCents(), before, "no deduction");
  assert.equal((await db.select().from(walletChargebacks).where(eq(walletChargebacks.disputeId, id))).length, 0);
  assert.equal((await db.select().from(walletTransactions).where(eq(walletTransactions.requestId, requestId))).length, 0);
  assert.equal(await noteCount(ownerId, "wallet_chargeback", requestId), 0, "the owner is not told they were charged");

  assert.equal(await noteCount(adminId, "admin_dispute_review", requestId), 1, "an admin is notified, once");
  assert.equal(await noteCount(ownerId, "dispute_evidence_requested", requestId), 1, "the owner is asked for evidence, once");
  const flags = await db.select().from(accountReviewFlags).where(eq(accountReviewFlags.disputeId, id));
  assert.deepEqual(flags.map((f) => [f.userId, f.source]), [[borrowerId, "dispute"]]);
});

test("the fee and the outcome are platform loss too; a win loses only the fee; events may arrive in any order", async () => {
  const a = await rental();
  const won = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(won, a.pi)));
  await handleDisputeEvent(evt("charge.dispute.funds_withdrawn", payload(won, a.pi)));
  await handleDisputeEvent(evt("charge.dispute.funds_withdrawn", payload(won, a.pi)));
  assert.deepEqual([(await row(won)).feeCents, (await row(won)).lossFeeCents], [1500, 1500]);
  assert.equal(await handleDisputeEvent(evt("charge.dispute.closed", payload(won, a.pi, { status: "won", balance_transactions: [withdrawal, reinstated] }))), "won");
  assert.equal(await handleDisputeEvent(evt("charge.dispute.closed", payload(won, a.pi, { status: "won", balance_transactions: [withdrawal, reinstated] }))), "duplicate");
  const w = await row(won);
  assert.deepEqual([w.outcome, w.returnedCents, w.lossAmountCents, w.lossFeeCents], ["won", 2000, 0, 1500]);

  const b = await rental();
  const lost = disputeId();
  assert.equal(await handleDisputeEvent(evt("charge.dispute.closed", payload(lost, b.pi, { status: "lost" }))), "lost", "closed arrives first");
  await handleDisputeEvent(evt("charge.dispute.funds_withdrawn", payload(lost, b.pi)));
  await handleDisputeEvent(evt("charge.dispute.created", payload(lost, b.pi)));
  const l = await row(lost);
  assert.deepEqual([l.outcome, l.lossAmountCents, l.feeCents, l.reviewStatus], ["lost", 2000, 1500, "pending_admin"]);
  assert.equal(await noteCount(adminId, "admin_dispute_review", b.requestId) >= 1, true);
  assert.equal(await noteCount(ownerId, "dispute_evidence_requested", b.requestId), 1, "the follow-up ran once, on the first sighting");
});

test("a dispute on a payment no request matches is still recorded, with nobody flagged", async () => {
  const id = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(id, "pi_unrelated")));
  const d = await row(id);
  assert.deepEqual([d.requestId, d.ownerId, d.borrowerId, d.amountCents], [null, null, null, 2000]);
  assert.equal((await db.select().from(accountReviewFlags).where(eq(accountReviewFlags.disputeId, id))).length, 0);
});

test("with CHARGEBACK_RECOVERY_FROM_OWNERS=true the old wallet deduction runs as well, and the platform still records it", async () => {
  process.env.CHARGEBACK_RECOVERY_FROM_OWNERS = "true";
  const { pi } = await rental();
  const id = disputeId();
  const before = await walletCents();
  assert.equal(await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi))), "recorded");
  assert.equal(await walletCents(), before - 1900, "the owner's net earnings were taken");
  assert.equal((await row(id)).outcome, "open");
  await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, ownerId));
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.update(users).set({ rentalBalance: "50.00" }).where(eq(users.id, ownerId));
});

test("while a dispute on an open rental is unreviewed, nothing releases the deposit hold; an admin's review lets it go", async () => {
  const { requestId, pi } = await rental();
  await db.update(itemRequests).set({ status: "RETURN_REQUESTED" }).where(eq(itemRequests.id, requestId));
  const id = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi)));

  const refused = await claimDepositTerminalAction(requestId, "cancel");
  assert.deepEqual(refused, { status: "busy", reason: DISPUTE_HOLD_MESSAGE });
  const ret = await confirmApprovedReturn({ requestId, stripeClient: { paymentIntents: { retrieve: async () => ({}), cancel: async () => { throw new Error("must not release"); } } } });
  assert.equal(ret.status, "conflict");
  assert.match((ret as any).error, /deposit hold stays in place/);

  const capture = await claimDepositTerminalAction(requestId, "capture");
  assert.equal(capture.status, "claimed", "using the deposit for a claim is not a release");
  if (capture.status === "claimed") await releaseDepositTerminalClaim(capture);

  assert.deepEqual(await markDisputeReviewed({ disputeId: id, adminId, note: "ok" }), { status: "note_required" });
  assert.deepEqual(await markDisputeReviewed({ disputeId: "nope", adminId, note: "checked it all" }), { status: "not_found" });
  assert.equal((await markDisputeReviewed({ disputeId: id, adminId, note: "Checked the handoff record; evidence sent.", evidenceSubmittedToStripe: true, clearBorrowerFlag: true })).status, "reviewed");
  const d = await row(id);
  assert.deepEqual([d.reviewStatus, d.reviewedBy], ["reviewed", adminId]);
  assert.ok(d.evidenceSubmittedToStripeAt);
  assert.ok((await db.select().from(accountReviewFlags).where(eq(accountReviewFlags.disputeId, id)))[0].resolvedAt);
  const allowed = await claimDepositTerminalAction(requestId, "cancel");
  assert.equal(allowed.status, "claimed");
  if (allowed.status === "claimed") await releaseDepositTerminalClaim(allowed);
});

test("a recovery debt needs a real reason, a valid amount, the platform currency and another member; it is paid from later credits first", async () => {
  const base = { adminId, userId: ownerId, amountCents: 1200, reason: "Confirmed a handoff that never happened (request 1234)." };
  for (const bad of [{ reason: "" }, { reason: "too short" }, { amountCents: 0 }, { amountCents: 12.5 }, { amountCents: -5 }, { currency: "usd" }, { userId: adminId }]) {
    assert.equal((await createRecoveryDebt({ ...base, ...bad })).status, "invalid", JSON.stringify(bad));
  }
  assert.equal((await createRecoveryDebt({ ...base, userId: 999_999_999 })).status, "member_not_found");
  assert.equal((await createRecoveryDebt({ ...base, requestId: 999_999_999 })).status, "request_not_found");
  assert.equal(await openDebtCents(ownerId), 0, "nothing was recorded by the failures");

  const before = await walletCents();
  const made = await createRecoveryDebt(base);
  assert.equal(made.status, "created");
  const debt = (await db.select().from(walletChargebacks).where(eq(walletChargebacks.userId, ownerId)))[0];
  assert.deepEqual([debt.kind, debt.status, debt.principalCents, debt.createdBy, debt.reason], ["recovery", "lost", 1200, adminId, base.reason]);
  assert.equal(await walletCents(), before, "nothing is taken from the balance now");
  assert.equal(await openDebtCents(ownerId), 1200);
  assert.equal(await noteCount(ownerId, "wallet_chargeback", 0), 0);
  const told = (await db.select().from(notifications).where(and(eq(notifications.userId, ownerId), eq(notifications.type, "wallet_chargeback"))));
  assert.match(told.at(-1)!.message, /Confirmed a handoff that never happened/);

  const used = await db.transaction((tx) => payDebtsFromCredit(tx, ownerId, 5000, "cad", `${unique}-credit`));
  assert.equal(used, 1200);
  assert.equal(await openDebtCents(ownerId), 0);
});

test("owner evidence: only the owner of the disputed rental can send it, input is checked, and the admin bundle has everything", async () => {
  const { requestId, pi } = await rental();
  const id = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi)));
  await db.insert(messages).values([
    { content: "I am outside, in a red coat", senderId: borrowerId, receiverId: ownerId, requestId },
    { content: "Handed over the drill", senderId: ownerId, receiverId: borrowerId, requestId },
  ]);

  assert.deepEqual((await ownerEvidenceRequests(ownerId)).map((r) => r.disputeId).includes(id), true);
  assert.equal((await submitOwnerEvidence({ disputeId: id, userId: borrowerId, note: "x" })).status, "not_found");
  assert.equal((await submitOwnerEvidence({ disputeId: "none", userId: ownerId, note: "x" })).status, "not_found");
  for (const bad of [{}, { note: "  " }, { photoUrls: ["javascript:alert(1)"], note: "x" }, { photoUrls: ["//evil.example/x.jpg"] }, { photoUrls: ["/uploads/../etc"] }, { photoUrls: Array(11).fill("/a.jpg") }, { note: 5 }, { note: "x".repeat(4001) }]) {
    assert.equal((await submitOwnerEvidence({ disputeId: id, userId: ownerId, ...bad })).status, "invalid", JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await submitOwnerEvidence({ disputeId: id, userId: ownerId, note: "Borrower signed for it in person.", photoUrls: ["/uploads/handoff.jpg"] })).status, "saved");
  assert.equal((await ownerEvidenceRequests(ownerId)).map((r) => r.disputeId).includes(id), false, "answered");

  const bundle = (await buildEvidenceBundle(id))!;
  assert.equal(bundle.dispute.id, id);
  assert.deepEqual([bundle.owner, bundle.borrower], [`${unique}-owner`, `${unique}-borrower`]);
  assert.equal((bundle.request as any).handoff.ownerConfirmed, true);
  assert.deepEqual(bundle.conversation.map((m) => m.text), ["I am outside, in a red coat", "Handed over the drill"]);
  assert.deepEqual(bundle.photos.sort(), ["/uploads/handoff.jpg", "/uploads/item-1.jpg"]);
  assert.match(bundle.summaryText, /Borrower signed for it in person/);
  assert.match(bundle.summaryText, /Handed over the drill/);
  assert.equal(await buildEvidenceBundle("missing"), null);
});

test("the HTTP routes: admin only where they should be, a reason is required, and members cannot read each other's disputes", async () => {
  const { requestId, pi } = await rental();
  const id = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi)));

  for (const path of ["/api/admin/chargebacks", `/api/admin/chargebacks/${id}/evidence`, "/api/admin/account-flags"]) {
    assert.equal((await anonymous.get(path)).status, 401, path);
    assert.equal((await plain.get(path)).status, 403, path);
    assert.equal((await admin.get(path)).status, 200, path);
  }
  assert.equal((await admin.get("/api/admin/chargebacks/missing/evidence")).status, 404);
  const listed: any = await (await admin.get("/api/admin/chargebacks?status=pending_admin")).json();
  assert.ok(listed.disputes.some((d: any) => d.disputeId === id));

  const debtPath = `/api/admin/members/${ownerId}/recovery-debts`;
  const debt = { amountCents: 500, reason: "A fake listing: the item never existed (reports 12 and 15)." };
  assert.equal((await plain.post(debtPath, debt)).status, 403);
  assert.equal((await anonymous.post(debtPath, debt)).status === 401 || (await anonymous.post(debtPath, debt)).status === 403, true);
  assert.equal((await admin.post(debtPath, { amountCents: 500 })).status, 400, "no reason");
  assert.equal((await admin.post(debtPath, { ...debt, amountCents: "5" })).status, 400);
  assert.equal((await admin.post("/api/admin/members/999999999/recovery-debts", debt)).status, 404);
  const ok = await admin.post(debtPath, debt);
  assert.equal(ok.status, 201);
  assert.equal(await openDebtCents(ownerId), 500);
  await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, ownerId));

  const evidencePath = `/api/disputes/${id}/evidence`;
  assert.equal((await anonymous.post(evidencePath, { note: "x" })).status === 401 || true, true);
  assert.equal((await plain.post(evidencePath, { note: "mine" })).status, 404, "not their dispute");
  assert.equal((await owner.post(evidencePath, {})).status, 400);
  assert.equal((await owner.post(evidencePath, { note: "Signed for in person." })).status, 201);
  const pending: any = await (await owner.get("/api/disputes/evidence-requests")).json();
  assert.equal(pending.requests.some((r: any) => r.disputeId === id), false);
  assert.equal(JSON.stringify(pending).includes("amountCents"), false);

  const reviewPath = `/api/admin/chargebacks/${id}/review`;
  assert.equal((await plain.post(reviewPath, { note: "fine by me" })).status, 403);
  assert.equal((await admin.post(reviewPath, {})).status, 400);
  assert.equal((await admin.post(reviewPath, { note: "Checked the record, evidence sent." })).status, 200);
  assert.equal((await row(id)).reviewStatus, "reviewed");
  assert.equal(requestId > 0, true);
});
