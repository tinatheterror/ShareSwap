import assert from "node:assert/strict";
import { test } from "node:test";
import * as copy from "./deposit-copy.js";

test("money formatting drops empty cents", () => {
  assert.equal(copy.formatMoney(105), "$105");
  assert.equal(copy.formatMoney("105.00"), "$105");
  assert.equal(copy.formatMoney(12.5), "$12.50");
});

test("spec strings are exact", () => {
  assert.equal(copy.claimOpenedChat(105), "⚠️ Claim opened. Deposit charged while it’s reviewed.");
  assert.equal(copy.claimResolvedStamp({ refunded: 75, awarded: 30, captured: true }).content, "Claim resolved · $75 refunded · $30 awarded to owner");
  assert.equal(copy.holdReleasedChat(105), "✅ Deposit hold released. You weren’t charged.");
  const n = copy.depositChargedBorrower(105, "Tineco vacuum mop");
  assert.equal(n.type, "security_deposit_charged");
  assert.equal(n.title, "Claim opened — deposit charged");
  assert.equal(n.message, "A claim was opened for your Tineco vacuum mop. Your $105 security deposit was charged to your card while the claim is reviewed and may be refunded depending on the outcome.");
  const owner = copy.claimOpenedOwner(105, "Tineco vacuum mop");
  assert.equal(owner.title, "Claim opened — deposit charged");
  assert.equal(owner.message, "Your claim for Tineco vacuum mop is under review. The borrower's $105 security deposit was charged to their card while the claim is reviewed.");
  assert.deepEqual(copy.depositHoldReleased(105), { type: "deposit_hold_released", title: "Deposit hold released", message: "$105 deposit hold released. You were not charged." });
});

test("resolution copy distinguishes full refund, partial refund, and retained", () => {
  assert.equal(copy.resolutionBorrower({ charged: 105, refunded: 105, retained: 0 }, "4242").title, "Security deposit refunded");
  assert.equal(copy.resolutionBorrower({ charged: 105, refunded: 75, retained: 30 }, "4242").title, "Security deposit partly refunded");
  assert.match(copy.resolutionBorrower({ charged: 105, refunded: 75, retained: 30 }, "4242").message, /^\$75 refunded to your card •••• 4242\. \$30 of your \$105/);
  const kept = copy.resolutionBorrower({ charged: 105, refunded: 0, retained: 105 });
  assert.equal(kept.title, "Security deposit retained");
  assert.match(kept.message, /Charged: \$105, refunded: \$0, retained: \$105/);
  assert.equal(copy.outcomeFor(105, 75, 30), "refunded_partial");
});

test("lifecycle phases never confuse hold, charge, release and refund", () => {
  const base = { amount: "105.00" };
  assert.equal(copy.depositLifecycleView({ ...base, mode: "authorization", status: "authorized" }).phase, "hold");
  assert.equal(copy.depositLifecycleView({ ...base, mode: "authorization", status: "held" }).chargedAmount, null);
  const charged = copy.depositLifecycleView({ ...base, mode: "authorization", status: "captured", capturedAmount: "105.00", cardLast4: "4242", cardBrand: "visa" });
  assert.deepEqual(charged, { phase: "charged", chargedAmount: 105, refundedAmount: null, retainedAmount: null, cardLast4: "4242", cardBrand: "visa" });
  assert.equal(copy.depositLifecycleView({ ...base, mode: "refundable_charge", status: "held" }).phase, "charged");
  assert.equal(copy.depositLifecycleView({ ...base, mode: "refundable_charge", status: "held" }).chargedAmount, 105);
  assert.equal(copy.depositLifecycleView({ ...base, mode: "authorization", status: "released" }).phase, "released");
  const resolved = copy.depositLifecycleView({ ...base, mode: "authorization", status: "settled", capturedAmount: "105.00", refundedAmount: "75.00", retainedAmount: "30.00" });
  assert.equal(resolved.phase, "resolved");
  assert.equal(resolved.refundedAmount, 75);
  assert.equal(resolved.retainedAmount, 30);
  assert.equal(copy.depositLifecycleView({ ...base, mode: "authorization", status: "EXPIRED_UNSECURED" }).phase, "none");
});

test("return stamp has an in-person version that never mentions a hold or refund", () => {
  const s = copy.returnConfirmedChat(true, false, true);
  assert.equal(s, "✅ Item returned in good condition. In-person deposit can be returned.");
  assert.doesNotMatch(s, /hold|refund/i);
  assert.equal(copy.returnConfirmedChat(false, false, false), "✅ Item returned in good condition.");
});

test("claim-opened copy depends on the deposit mode", () => {
  // Hold mode: the hold is charged while the claim is reviewed.
  assert.equal(copy.claimOpenedChat(105), "⚠️ Claim opened. Deposit charged while it’s reviewed.");
  assert.equal(copy.claimOpenedChat(105, false), "⚠️ Claim opened. Deposit charged while it’s reviewed.");
  assert.equal(copy.depositChargedBorrower(105, "Mop").title, "Claim opened — deposit charged");
  assert.match(copy.depositChargedBorrower(105, "Mop").message, /charged to your card while the claim is reviewed/);
  assert.match(copy.claimOpenedOwner(105, "Mop").message, /was charged to their card while the claim is reviewed/);
  // Charge mode: the deposit was already charged, so it is held while the claim is reviewed.
  assert.equal(copy.claimOpenedChat(105, true), "⚠️ Claim opened. Deposit held while it’s reviewed.");
  assert.equal(copy.depositChargedBorrower(105, "Mop", true).title, "Claim opened — deposit held");
  assert.match(copy.depositChargedBorrower(105, "Mop", true).message, /security deposit is held while the claim is reviewed/);
  assert.match(copy.claimOpenedOwner(105, "Mop", true).message, /is held while the claim is reviewed/);
  for (const s of [copy.claimOpenedChat(105), copy.claimOpenedChat(105, true), copy.depositChargedBorrower(105, "Mop").message, copy.depositChargedBorrower(105, "Mop", true).message]) {
    assert.doesNotMatch(s, /temporary hold/i, s);
  }
});

test("server-generated copy avoids ambiguous terminology", () => {
  const strings: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  for (const value of Object.values(copy)) {
    if (typeof value === "string") strings.push(value);
  }
  collect([
    copy.holdPlacedChat(105), copy.refundableChargedChat(105), copy.holdReleasedChat(105), copy.refundableRefundedChat(105),
    copy.claimOpenedChat(105), copy.claimResolvedStamp({ refunded: 75, awarded: 30, captured: true }).content, copy.claimResolvedStamp({ refunded: 0, awarded: 0, captured: false }).content, copy.depositChargedBorrower(105, "Mop"), copy.claimOpenedOwner(105, "Mop"),
    copy.claimOpenedPendingCharge("Mop"), copy.depositHoldReleased(105), copy.refundableDepositRefunded(105),
    copy.resolutionBorrower({ charged: 105, refunded: 75, retained: 30 }, "4242"), copy.resolutionBorrower({ charged: 105, refunded: 0, retained: 105 }),
    copy.resolutionOwner({ charged: 105, refunded: 105, retained: 0 }), copy.rejectedHoldReleasedBorrower(105), copy.rejectedHoldReleasedOwner(105),
    copy.returnHoldReleasedNotice("Mop"), copy.returnConfirmedNotice("Mop", true), copy.returnConfirmedChat(true), copy.renewalFailedBorrowerBody("Mop"),
    copy.stripeHoldDescription(1), copy.stripeRefundableChargeDescription(1), copy.refundableConsentMessage(105, "rental"), copy.disputeOpenedNotice("Mop"),
  ]);
  const banned = /\b(secured|deposit processed|funds secured|payment completed|authorization expires|deposit held|deposit on hold)\b/i;
  for (const s of strings) assert.doesNotMatch(s, banned, s);
  // "refunded" is only valid for money that was previously charged.
  for (const s of [copy.holdReleasedChat(105), copy.depositHoldReleased(105).message, copy.holdPlacedChat(105), copy.returnConfirmedChat(true), copy.returnHoldReleasedNotice("Mop")]) {
    assert.doesNotMatch(s, /refund/i, s);
  }
  // "temporary hold" is never used after capture.
  for (const s of [copy.claimOpenedChat(105), copy.depositChargedBorrower(105, "Mop").message, copy.claimResolvedStamp({ refunded: 75, awarded: 30, captured: true }).content]) {
    assert.doesNotMatch(s, /temporary hold|\bheld\b/i, s);
  }
});

test("the claim-resolved stamp states only the money that moved, in four distinct cases", () => {
  const full = copy.claimResolvedStamp({ refunded: 100, awarded: 0, captured: true });
  assert.equal(full.content, "Claim resolved · $100 refunded");
  assert.deepEqual(full.metadata, { eventType: "claim_resolved", outcome: "refunded_full", chargedAmount: 100, refundedAmount: 100, awardedAmount: 0, retainedAmount: 0 });

  const award = copy.claimResolvedStamp({ refunded: 0, awarded: 100, captured: true });
  assert.equal(award.content, "Claim resolved · $100 awarded to owner");
  assert.deepEqual(award.metadata, { eventType: "claim_resolved", outcome: "awarded_full", chargedAmount: 100, refundedAmount: 0, awardedAmount: 100, retainedAmount: 100 });

  const split = copy.claimResolvedStamp({ refunded: 40, awarded: 60, captured: true });
  assert.equal(split.content, "Claim resolved · $40 refunded · $60 awarded to owner");
  assert.deepEqual(split.metadata, { eventType: "claim_resolved", outcome: "refunded_partial", chargedAmount: 100, refundedAmount: 40, awardedAmount: 60, retainedAmount: 60 });

  const hold = copy.claimResolvedStamp({ refunded: 0, awarded: 0, captured: false });
  assert.equal(hold.content, "Claim resolved · Deposit hold released");
  assert.deepEqual(hold.metadata, { eventType: "claim_resolved", outcome: "hold_released", chargedAmount: 0, refundedAmount: 0, awardedAmount: 0, retainedAmount: 0 });

  for (const stamp of [full, award, split, hold]) {
    assert.doesNotMatch(stamp.content, /\$0\b|\bkept\b|retained|\bpaid\b/i, stamp.content);
  }
});

test("a hold that was never captured states no amounts even if amounts are passed", () => {
  const stamp = copy.claimResolvedStamp({ refunded: 100, awarded: 0, captured: false });
  assert.equal(stamp.content, "Claim resolved · Deposit hold released");
  assert.equal(stamp.metadata.refundedAmount, 0);
});

test("cents are kept and zero parts are dropped", () => {
  assert.equal(copy.claimResolvedStamp({ refunded: "12.50", awarded: "0.00", captured: true }).content, "Claim resolved · $12.50 refunded");
  assert.equal(copy.claimResolvedStamp({ refunded: 0.1 + 0.2, awarded: 0, captured: true }).content, "Claim resolved · $0.30 refunded");
});
