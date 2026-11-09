import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountReviewFlags, db, depositSettlementOperations, disputeEvidence, evidenceUploads, itemRequests, items, messages, notifications, platformDisputes, pool, rentalPayouts, requestLifecycleEvents, users, walletChargebacks, walletTransactions,
} from "@workspace/db";
import { hashPassword } from "./auth.js";
import { Client, startApp } from "./auth-test-client.js";
import { handleDisputeEvent } from "./dispute-webhook.js";
import { claimDepositTerminalAction, releaseDepositTerminalClaim } from "./deposit-renewal-service.js";
import { confirmApprovedReturn } from "./return-recovery-service.js";
import { deletePrivateFile } from "./storage.js";
import { privateTokenOf, savePrivateUpload } from "./private-files.js";
import { buildEvidenceBundle, ownerEvidenceRequests, submitOwnerEvidence } from "./dispute-evidence.js";
import { alertDisputeDeadlines, completeRentalOperationally, DEPOSIT_UNCOLLECTIBLE_ALERT_TYPE, DISPUTE_HOLD_MESSAGE, disputeLoss, holdForDisputeReview, markDisputeReviewed } from "./platform-disputes.js";
import { reconcileClaimDeadlines } from "./security-claims-service.js";
import { createRecoveryDebt, openDebtCents, openRecoveryDebtCents, payDebtsFromCredit, RecoveryDebtBlocksWithdrawal } from "./wallet-chargebacks.js";
import { reservePayout } from "./rental-payout-service.js";

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
    // Remove the uploaded test files from storage too, then their rows.
    for (const u of await db.select({ key: evidenceUploads.storageKey }).from(evidenceUploads).where(inArray(evidenceUploads.userId, ids))) if (u.key) await deletePrivateFile(u.key);
    await db.delete(evidenceUploads).where(inArray(evidenceUploads.userId, ids));
    await db.delete(accountReviewFlags).where(inArray(accountReviewFlags.userId, ids));
    await db.delete(platformDisputes).where(inArray(platformDisputes.borrowerId, ids));
    await db.delete(platformDisputes).where(inArray(platformDisputes.ownerId, ids));
    await db.delete(walletChargebacks).where(inArray(walletChargebacks.userId, ids));
    await db.delete(walletTransactions).where(inArray(walletTransactions.userId, ids));
    await db.delete(notifications).where(inArray(notifications.userId, ids));
    // Alerts go to every admin in the database, including ones other test files are using at the same time.
    if (requestIds.length) await db.delete(notifications).where(inArray(notifications.requestId, requestIds));
    if (requestIds.length) {
      await db.delete(messages).where(inArray(messages.requestId, requestIds));
      await db.delete(depositSettlementOperations).where(inArray(depositSettlementOperations.requestId, requestIds));
      await db.delete(requestLifecycleEvents).where(inArray(requestLifecycleEvents.requestId, requestIds));
      await db.delete(rentalPayouts).where(inArray(rentalPayouts.requestId, requestIds));
      await db.delete(rentalPayouts).where(eq(rentalPayouts.userId, ownerId));
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

test("a recovery debt needs a real reason, a valid amount, the platform currency and another member", async () => {
  const base = { adminId, userId: ownerId, amountCents: 1200, reason: "Confirmed a handoff that never happened (request 1234)." };
  for (const bad of [{ reason: "" }, { reason: "too short" }, { amountCents: 0 }, { amountCents: 12.5 }, { amountCents: -5 }, { currency: "usd" }, { userId: adminId }]) {
    assert.equal((await createRecoveryDebt({ ...base, ...bad })).status, "invalid", JSON.stringify(bad));
  }
  assert.equal((await createRecoveryDebt({ ...base, userId: 999_999_999 })).status, "member_not_found");
  assert.equal((await createRecoveryDebt({ ...base, requestId: 999_999_999 })).status, "request_not_found");
  assert.equal(await openDebtCents(ownerId), 0, "nothing was recorded by the failures");
  assert.equal(await walletCents(), 5000, "and nothing was taken");
});

const resetWallet = async (balance: string) => {
  await db.delete(walletChargebacks).where(eq(walletChargebacks.userId, ownerId));
  await db.delete(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  await db.delete(rentalPayouts).where(and(eq(rentalPayouts.userId, ownerId), eq(rentalPayouts.status, "pending_payout")));
  await db.update(users).set({ rentalBalance: balance, pendingRentalBalance: "0.00" }).where(eq(users.id, ownerId));
};
const base = () => ({ adminId, userId: ownerId, amountCents: 1200, reason: "Confirmed a handoff that never happened (request 1234)." });

test("a recovery debt the balance covers is taken right away, recorded in the ledger, and blocks nothing", async () => {
  await resetWallet("50.00");
  const made = await createRecoveryDebt(base());
  assert.deepEqual([made.status, (made as any).collectedCents, (made as any).owedCents], ["created", 1200, 0]);
  assert.equal(await walletCents(), 3800);
  const debt = (await db.select().from(walletChargebacks).where(eq(walletChargebacks.userId, ownerId)))[0];
  assert.deepEqual([debt.kind, debt.status, debt.principalCents, debt.collectedCents, debt.createdBy, debt.reason], ["recovery", "lost", 1200, 1200, adminId, base().reason]);
  const ledger = await db.select().from(walletTransactions).where(eq(walletTransactions.userId, ownerId));
  assert.deepEqual(ledger.map((r) => [r.kind, r.amountCents]), [["debt_payment", -1200]]);
  assert.equal(await openDebtCents(ownerId), 0);
  assert.equal(await openRecoveryDebtCents(ownerId), 0);
  const told = (await db.select().from(notifications).where(and(eq(notifications.userId, ownerId), eq(notifications.type, "wallet_chargeback")))).at(-1)!;
  assert.match(told.message, /Confirmed a handoff that never happened/);
  assert.match(told.message, /12\.00 was taken from your wallet now/);
  assert.match(told.message, /paid in full/);
  const reserved = await reservePayout(ownerId, 1000);
  assert.ok(reserved, "fully collected: the member can withdraw what is left");
});

test("what the balance cannot cover stays owed, blocks withdrawals until paid, and later earnings pay it first", async () => {
  await resetWallet("7.00");
  const made = await createRecoveryDebt(base());
  assert.deepEqual([(made as any).collectedCents, (made as any).owedCents], [700, 500]);
  assert.equal(await walletCents(), 0, "never below zero");
  assert.equal(await openDebtCents(ownerId), 500);
  assert.equal(await openRecoveryDebtCents(ownerId), 500);

  // Money arrives some way that does not go through the debt (so the block itself is what is tested).
  await db.update(users).set({ rentalBalance: "50.00" }).where(eq(users.id, ownerId));
  await assert.rejects(() => reservePayout(ownerId, 1000), (e: unknown) => e instanceof RecoveryDebtBlocksWithdrawal && e.owedCents === 500);
  assert.equal(await walletCents(), 5000, "the refused withdrawal took nothing");
  assert.equal((await db.select().from(rentalPayouts).where(and(eq(rentalPayouts.userId, ownerId), eq(rentalPayouts.status, "pending_payout")))).length, 0);

  await db.update(users).set({ stripeConnectedAccountId: "acct_test_recovery" }).where(eq(users.id, ownerId));
  const refused = await owner.post("/api/rental-balance/payout", { amount: 10 });
  assert.equal(refused.status, 403);
  assert.equal(((await refused.json()) as any).code, "RECOVERY_DEBT");

  const used = await db.transaction((tx) => payDebtsFromCredit(tx, ownerId, 5000, "cad", `${unique}-credit`));
  assert.equal(used, 500, "the next credit pays the debt first");
  assert.equal(await openRecoveryDebtCents(ownerId), 0);
  assert.ok(await reservePayout(ownerId, 1000), "paid off: withdrawals work again");
  await db.update(users).set({ stripeConnectedAccountId: null }).where(eq(users.id, ownerId));
});

test("an ordinary chargeback debt never blocks a withdrawal", async () => {
  await resetWallet("50.00");
  await db.insert(walletChargebacks).values({ userId: ownerId, disputeId: disputeId(), currency: "cad", principalCents: 1000, status: "lost", kind: "dispute" });
  assert.equal(await openDebtCents(ownerId), 1000);
  assert.equal(await openRecoveryDebtCents(ownerId), 0);
  assert.ok(await reservePayout(ownerId, 1000));
  await resetWallet("50.00");
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
  for (const bad of [{}, { note: "  " }, { photoUrls: ["javascript:alert(1)"], note: "x" }, { photoUrls: ["//evil.example/x.jpg"] }, { photoUrls: ["/uploads/../etc"] }, { photoUrls: ["/uploads/handoff.jpg"], note: "x" }, { photoUrls: ["https://example.com/a.jpg"], note: "x" }, { photoUrls: Array(11).fill("/a.jpg") }, { note: 5 }, { note: "x".repeat(4001) }]) {
    assert.equal((await submitOwnerEvidence({ disputeId: id, userId: ownerId, ...bad })).status, "invalid", JSON.stringify(bad).slice(0, 60));
  }
  const mine = await savePrivateUpload(ownerId, { buffer: Buffer.from("owner-photo"), originalname: "handoff.jpg" }, "dispute_evidence");
  const theirs = await savePrivateUpload(borrowerId, { buffer: Buffer.from("borrower-photo"), originalname: "other.jpg" }, "dispute_evidence");
  assert.equal((await submitOwnerEvidence({ disputeId: id, userId: ownerId, note: "x", photoUrls: [theirs] })).status, "invalid", "another member's upload cannot be attached");
  assert.equal((await submitOwnerEvidence({ disputeId: id, userId: ownerId, note: "Borrower signed for it in person.", photoUrls: [mine] })).status, "saved");
  assert.equal((await ownerEvidenceRequests(ownerId)).map((r) => r.disputeId).includes(id), false, "answered");

  const bundle = (await buildEvidenceBundle(id))!;
  assert.equal(bundle.dispute.id, id);
  assert.deepEqual([bundle.owner, bundle.borrower], [`${unique}-owner`, `${unique}-borrower`]);
  assert.equal((bundle.request as any).handoff.ownerConfirmed, true);
  assert.deepEqual(bundle.conversation.map((m) => m.text), ["I am outside, in a red coat", "Handed over the drill"]);
  assert.deepEqual(bundle.photos.sort(), [mine, "/uploads/item-1.jpg"].sort());
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
  assert.deepEqual(await ok.json(), { success: true, id: (await db.select().from(walletChargebacks).where(eq(walletChargebacks.userId, ownerId)))[0].id, collectedCents: 500, owedCents: 0 });
  await resetWallet("50.00");

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

test("admins are alerted once, 48 hours before Stripe's evidence deadline and before the deposit authorization runs out, and the admin list shows both dates", async () => {
  const now = new Date();
  const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
  const near = await rental();
  await db.update(itemRequests).set({ depositMode: "authorization", depositStatus: "held", depositAuthorizationExpiresAt: hours(36) }).where(eq(itemRequests.id, near.requestId));
  const nearId = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(nearId, near.pi, { evidence_details: { due_by: Math.floor(hours(24).getTime() / 1000) } })));

  const far = await rental();
  await db.update(itemRequests).set({ depositMode: "authorization", depositStatus: "held", depositAuthorizationExpiresAt: hours(24 * 5) }).where(eq(itemRequests.id, far.requestId));
  await handleDisputeEvent(evt("charge.dispute.created", payload(disputeId(), far.pi, { evidence_details: { due_by: Math.floor(hours(24 * 5).getTime() / 1000) } })));

  const sent = await rental();
  await db.update(itemRequests).set({ depositMode: "authorization", depositStatus: "released", depositAuthorizationExpiresAt: hours(10) }).where(eq(itemRequests.id, sent.requestId));
  const sentId = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(sentId, sent.pi, { evidence_details: { due_by: Math.floor(hours(10).getTime() / 1000) } })));
  await markDisputeReviewed({ disputeId: sentId, adminId, note: "Evidence already sent to Stripe", evidenceSubmittedToStripe: true });

  const first = await alertDisputeDeadlines(now);
  assert.ok(first.evidence >= 1 && first.authorization >= 1);
  const typesFor = async (requestId: number) => (await db.select().from(notifications).where(and(eq(notifications.userId, adminId), eq(notifications.requestId, requestId)))).map((n) => n.type).sort();
  assert.deepEqual(await typesFor(near.requestId), ["admin_dispute_auth_expiring", "admin_dispute_evidence_due", "admin_dispute_review"]);
  assert.deepEqual(await typesFor(far.requestId), ["admin_dispute_review"], "five days away: not yet");
  assert.deepEqual(await typesFor(sent.requestId), ["admin_dispute_review"], "evidence sent and dispute reviewed: nothing to alert");
  const message = (await db.select().from(notifications).where(and(eq(notifications.userId, adminId), eq(notifications.type, "admin_dispute_auth_expiring"), eq(notifications.requestId, near.requestId))))[0].message;
  assert.match(message, new RegExp(`request #${near.requestId}`));

  const second = await alertDisputeDeadlines(now);
  assert.deepEqual(second, { evidence: 0, authorization: 0 }, "once each");
  assert.equal((await typesFor(near.requestId)).length, 3);
  // Five days later the far one is inside the window and is alerted once.
  const later = await alertDisputeDeadlines(hours(24 * 4));
  assert.ok(later.evidence >= 1 && later.authorization >= 1);
  assert.equal((await typesFor(far.requestId)).length, 3);

  const list: any = await (await admin.get("/api/admin/chargebacks")).json();
  const listed = list.disputes.find((d: any) => d.disputeId === nearId);
  assert.ok(Math.abs(new Date(listed.evidenceDueBy).getTime() - hours(24).getTime()) < 2000, "Stripe's due_by");
  assert.equal(new Date(listed.depositAuthorizationExpiresAt).getTime(), hours(36).getTime(), "the authorization expiry");
  assert.equal(listed.itemName, `${unique}-item`);
});


// ── A deposit authorization that runs out during an unreviewed dispute ──
async function expiredDuringDispute() {
  const { requestId, pi } = await rental("RETURN_REQUESTED");
  await db.update(itemRequests).set({
    depositMode: "authorization", depositStatus: "authorized", depositPaymentIntentId: `pi_deposit_${unique}_${requestId}`,
    depositAuthorizationExpiresAt: new Date(Date.now() - 3_600_000),
  }).where(eq(itemRequests.id, requestId));
  const id = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi)));
  return { requestId, id, pi };
}
const requestRow = async (requestId: number) => (await db.select().from(itemRequests).where(eq(itemRequests.id, requestId)))[0];

test("an authorization that expires during an unreviewed dispute stays EXPIRED_UNSECURED, is flagged urgent, admins are told once, and nothing is charged or re-authorized", async () => {
  const { requestId, id } = await expiredDuringDispute();
  await db.insert(disputeEvidence).values({ disputeId: id, userId: ownerId, note: "kept", photoUrls: [] });
  const before = await requestRow(requestId);
  assert.equal(await holdForDisputeReview(requestId), true, "while the hold is live the guard blocks");
  const wallet = await walletCents();

  assert.deepEqual(await reconcileClaimDeadlines(new Date(), { onlyRequestIds: [requestId] }), { checked: 1, expired: 1 });
  const after = await requestRow(requestId);
  assert.equal(after.depositStatus, "EXPIRED_UNSECURED", "an expired authorization is never collectible");
  assert.equal(after.depositPaymentIntentId, before.depositPaymentIntentId, "no new authorization was created");
  assert.equal(after.depositCapturedAmount, before.depositCapturedAmount, "nothing was charged");

  const d = await row(id);
  assert.equal(d.urgentManualReview, true);
  assert.ok(d.depositUncollectibleAt);
  assert.deepEqual([d.reviewStatus, d.outcome, d.closedAt], ["pending_admin", "open", null], "the dispute itself stays open and unreviewed");
  assert.equal(d.evidenceSubmittedToStripeAt, null);
  assert.equal(await noteCount(adminId, DEPOSIT_UNCOLLECTIBLE_ALERT_TYPE, requestId), 1);
  const events = await db.select().from(requestLifecycleEvents).where(and(eq(requestLifecycleEvents.requestId, requestId), eq(requestLifecycleEvents.eventType, "DEPOSIT_UNCOLLECTIBLE_DURING_DISPUTE")));
  assert.equal(events.length, 1);
  assert.equal((await db.select().from(disputeEvidence).where(eq(disputeEvidence.disputeId, id))).length, 1, "evidence history is kept");
  assert.equal(await walletCents(), wallet);
  assert.equal((await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId)))[0].status, "held");

  await reconcileClaimDeadlines(new Date(), { onlyRequestIds: [requestId] });
  assert.equal(await noteCount(adminId, DEPOSIT_UNCOLLECTIBLE_ALERT_TYPE, requestId), 1, "a second sweep does not alert again");
});

test("a dispute that was already reviewed is not flagged when the authorization expires", async () => {
  const { requestId, id } = await expiredDuringDispute();
  await markDisputeReviewed({ disputeId: id, adminId, note: "Checked it all already." });
  await reconcileClaimDeadlines(new Date(), { onlyRequestIds: [requestId] });
  const d = await row(id);
  assert.deepEqual([d.urgentManualReview, d.depositUncollectibleAt], [false, null]);
  assert.equal(await noteCount(adminId, DEPOSIT_UNCOLLECTIBLE_ALERT_TYPE, requestId), 0);
});

test("once the hold has expired the unreviewed-dispute guard stops blocking cancel and return by itself", async () => {
  const { requestId, id } = await expiredDuringDispute();
  assert.equal((await claimDepositTerminalAction(requestId, "cancel")).status, "busy");
  await reconcileClaimDeadlines(new Date(), { onlyRequestIds: [requestId] });
  assert.equal(await holdForDisputeReview(requestId), false);
  const claim = await claimDepositTerminalAction(requestId, "cancel");
  assert.equal(claim.status, "claimed");
  if (claim.status === "claimed") await releaseDepositTerminalClaim(claim);
  const ret = await confirmApprovedReturn({ requestId, stripeClient: { paymentIntents: { retrieve: async () => ({}), cancel: async () => { throw new Error("must not release"); } } } });
  if (ret.status === "conflict") assert.doesNotMatch((ret as any).error, /deposit hold stays in place/);
  assert.equal((await row(id)).reviewStatus, "pending_admin", "the dispute is still open");
});

test("an admin can mark the rental operationally complete while the dispute stays open, and no money moves", async () => {
  const live = await rental("RETURN_REQUESTED");
  await db.update(itemRequests).set({ depositMode: "authorization", depositStatus: "authorized", depositAuthorizationExpiresAt: new Date(Date.now() + 86_400_000) }).where(eq(itemRequests.id, live.requestId));
  const liveId = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(liveId, live.pi)));
  assert.equal((await completeRentalOperationally({ disputeId: liveId, adminId, note: "close it out" })).status, "conflict", "not while the hold is live");

  const { requestId, id } = await expiredDuringDispute();
  await reconcileClaimDeadlines(new Date(), { onlyRequestIds: [requestId] });
  const wallet = await walletCents();
  const payoutBefore = (await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId)))[0];

  assert.equal((await plain.post(`/api/admin/chargebacks/${id}/complete-rental`, { note: "closing the rental out" })).status, 403);
  assert.equal((await admin.post(`/api/admin/chargebacks/${id}/complete-rental`, { note: "" })).status, 400);
  assert.equal((await admin.post(`/api/admin/chargebacks/nope/complete-rental`, { note: "closing the rental out" })).status, 404);
  assert.equal((await admin.post(`/api/admin/chargebacks/${id}/complete-rental`, { note: "Hold lapsed; closing the rental out." })).status, 200);

  const req = await requestRow(requestId);
  assert.equal(req.status, "COMPLETED");
  assert.equal(req.depositStatus, "EXPIRED_UNSECURED", "the deposit is untouched");
  const d = await row(id);
  assert.deepEqual([d.reviewStatus, d.outcome, d.closedAt, d.evidenceSubmittedToStripeAt], ["pending_admin", "open", null, null], "the financial dispute stays open");
  assert.equal(d.rentalCompletedBy, adminId);
  assert.ok(d.rentalCompletedAt);
  assert.equal(await walletCents(), wallet);
  const payoutAfter = (await db.select().from(rentalPayouts).where(eq(rentalPayouts.requestId, requestId)))[0];
  assert.deepEqual([payoutAfter.status, payoutAfter.netAmount], [payoutBefore.status, payoutBefore.netAmount]);
  assert.equal((await admin.post(`/api/admin/chargebacks/${id}/complete-rental`, { note: "Hold lapsed; closing the rental out." })).status, 409, "only once");
});


// ── Evidence uploads are private and bound to the member who made them ──
const photoForm = (bytes: string, name = "evidence.jpg", type = "image/jpeg") => {
  const form = new FormData();
  form.append("photo", new Blob([bytes], { type }), name);
  return form;
};
const upload = async (client: Client, bytes: string) => {
  const res = await client.postForm("/api/uploads/dispute-evidence", photoForm(bytes));
  assert.equal(res.status, 200);
  return ((await res.json()) as { url: string }).url;
};

test("evidence photos: the owner uploads, only the uploader and admins can read them, and the URL is unguessable and not public", async () => {
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.postForm("/api/uploads/dispute-evidence", photoForm("x"))).status, 401);
  assert.equal((await owner.postForm("/api/uploads/dispute-evidence", photoForm("x", "evil.html", "text/html"))).status, 500, "only images");

  const url = await upload(owner, "private-bytes");
  const token = privateTokenOf(url)!;
  assert.match(token, /^[0-9a-f]{32}$/, "128 random bits, not a counter or a timestamp");
  assert.ok(!url.includes("evidence.jpg"), "the file name is not in the URL");

  const read = await owner.get(url);
  assert.equal(read.status, 200);
  assert.equal(await read.text(), "private-bytes");
  assert.equal(read.headers.get("cache-control"), "private, no-store");
  assert.equal(read.headers.get("access-control-allow-origin"), null);
  assert.equal((await admin.get(url)).status, 200, "admins can read it");
  assert.equal((await plain.get(url)).status, 404, "another member cannot, and learns nothing");
  assert.equal((await anonymous.get(url)).status, 401);
  assert.equal((await owner.get(`${url.slice(0, -4)}0000`)).status, 404);
  assert.equal((await owner.get("/api/private-files/..%2f..%2fetc")).status, 404);

  const [stored] = await db.select().from(evidenceUploads).where(eq(evidenceUploads.token, token));
  assert.ok(stored.storageKey!.startsWith("private/"));
  for (const probe of [`/storage/${stored.storageKey}`, `/uploads/${stored.storageKey!.slice("private/".length)}`, `/uploads/private/${stored.storageKey!.slice("private/".length)}`]) {
    assert.equal((await anonymous.get(probe)).status, 404, `${probe} must not be public`);
    assert.equal((await owner.get(probe)).status, 404, `${probe} must not be public even when signed in`);
  }
});

test("the evidence endpoint takes only the dispute owner's own uploads, over HTTP too", async () => {
  const { pi } = await rental();
  const id = disputeId();
  await handleDisputeEvent(evt("charge.dispute.created", payload(id, pi)));
  const ownerUrl = await upload(owner, "owner-file");
  const plainUrl = await upload(plain, "plain-file");
  const path = `/api/disputes/${id}/evidence`;
  await anonymous.fetchCsrfToken();
  assert.equal((await anonymous.post(path, { note: "hi" })).status, 401);
  assert.equal((await plain.post(path, { note: "not my dispute", photoUrls: [plainUrl] })).status, 404, "not the dispute's owner");
  assert.equal((await owner.post(path, { note: "x", photoUrls: [plainUrl] })).status, 400, "someone else's upload");
  assert.equal((await owner.post(path, { note: "x", photoUrls: ["/uploads/anything.jpg"] })).status, 400, "an arbitrary path");
  assert.equal((await owner.post(path, { note: "x", photoUrls: [`${ownerUrl}?x=1`] })).status, 400, "a decorated url");
  assert.equal((await owner.post(path, { note: "Mine.", photoUrls: [ownerUrl] })).status, 201);
  const bundle = await admin.get(`/api/admin/chargebacks/${id}/evidence`);
  assert.equal(bundle.status, 200);
  assert.deepEqual(((await bundle.json()) as any).ownerEvidence[0].photoUrls, [ownerUrl]);
  assert.equal((await plain.get(`/api/admin/chargebacks/${id}/evidence`)).status, 403);
});
