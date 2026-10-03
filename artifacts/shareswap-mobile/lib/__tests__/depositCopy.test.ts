import {
  formatMoney, resolveDepositPhase, depositSummaryLine, holdTitle, holdPendingNote, holdReleaseExplainer,
  claimOpenedBorrowerCopy, claimOpenedOwnerLine, claimResolvedBorrowerCopy, claimResolvedOwnerLine,
  depositConfirmedStamp, depositNotificationKind, depositReleasedCopy, CANCEL_BOOKING_MESSAGE, CLAIM_REVIEW_TOP,
} from "../depositCopy";

const BANNED = /deposit secured|funds secured|payment completed|deposit processed|authorization expires/i;

describe("depositCopy", () => {
  it("formats money", () => {
    expect(formatMoney(105)).toBe("$105");
    expect(formatMoney("30.5")).toBe("$30.50");
    expect(formatMoney(null)).toBe("$0");
  });

  it("derives phase from backend phase or falls back to status", () => {
    expect(resolveDepositPhase({ phase: "charged", status: "captured" })).toBe("charged");
    expect(resolveDepositPhase({ status: "authorized" })).toBe("hold");
    expect(resolveDepositPhase({ status: "held" })).toBe("hold");
    expect(resolveDepositPhase({ status: "captured" })).toBe("charged");
    expect(resolveDepositPhase({ status: "released" })).toBe("released");
    expect(resolveDepositPhase({ status: "settled" })).toBe("resolved");
    expect(resolveDepositPhase(null)).toBe("none");
    expect(resolveDepositPhase({ mode: "refundable_charge", status: "secured", phase: "hold" })).toBe("charged");
  });

  it("never calls a captured deposit a hold", () => {
    const line = depositSummaryLine({ phase: "charged", amount: 105, chargedAmount: 105 });
    expect(line).toContain("Charged");
    expect(line).not.toMatch(/hold/i);
    expect(depositSummaryLine({ phase: "hold", amount: 105 })).toContain("Temporary hold");
    expect(depositSummaryLine({ phase: "released", amount: 105 })).toContain("Hold released");
    expect(depositSummaryLine({ phase: "released", amount: 105 })).not.toMatch(/refund/i);
  });

  it("builds hold explainers", () => {
    expect(holdTitle(105)).toBe("$105 temporary card hold");
    expect(holdPendingNote(105)).toContain("This is a temporary hold, not a charge. Your card may show $105 as pending or temporarily unavailable.");
    expect(holdReleaseExplainer(105)).toBe("After the item is returned normally, the $105 hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.");
    expect(CANCEL_BOOKING_MESSAGE).toBe("Your temporary hold will be released. You will not be charged.");
    expect(depositReleasedCopy(105).body).toBe("$105 temporary hold released. You were not charged.");
  });

  it("claim opened copy is explicit", () => {
    const c = claimOpenedBorrowerCopy({ amount: 105, cardLast4: "4242" });
    expect(c.title).toBe("Security deposit charged");
    expect(c.body).toBe("$105 has been charged to your card •••• 4242.");
    expect(c.detail).toMatch(/converted into an actual charge/);
    expect(JSON.stringify(c)).not.toMatch(/deposit held|on hold|secured/i);
    expect(claimOpenedOwnerLine(105)).toBe("Claim opened and under review, $105 security deposit has been charged");
    expect(CLAIM_REVIEW_TOP.whyTitle).toBe("Why was I charged?");
  });

  it("claim resolved copy covers refund, partial and retained", () => {
    const full = claimResolvedBorrowerCopy({ chargedAmount: 105, refundedAmount: 105, retainedAmount: 0, cardLast4: "4242", outcome: "refunded_full" });
    expect(full.title).toBe("Security deposit refunded");
    expect(full.body).toBe("$105 refunded to your card •••• 4242.");
    const partial = claimResolvedBorrowerCopy({ chargedAmount: 105, refundedAmount: 75, retainedAmount: 30 });
    expect(partial.body).toBe("$75 refunded to your card.");
    expect(partial.detail).toContain("$30 retained based on the claim outcome.");
    expect(partial.rows).toEqual([
      { label: "Charged", value: "$105" }, { label: "Refunded", value: "$75" }, { label: "Retained", value: "$30" },
    ]);
    const kept = claimResolvedBorrowerCopy({ chargedAmount: 105, refundedAmount: 0, retainedAmount: 30, outcome: "retained_full" });
    expect(kept.title).toBe("Security deposit retained");
    expect(kept.body).toBe("$30 of your $105 security deposit was retained based on the claim outcome.");
    expect(JSON.stringify([full, partial, kept])).not.toMatch(/\bfee\b/i);
    expect(claimResolvedOwnerLine(75, 30)).toBe("Claim has been resolved. $75 refunded · $30 retained");
  });

  it("relabels the deposit_confirmed stamp", () => {
    expect(depositConfirmedStamp({})).toBe("🔒 Temporary hold placed");
    expect(depositConfirmedStamp({ mode: "refundable_charge" })).toBe("🔒 Refundable deposit charged");
    expect(depositConfirmedStamp(undefined)).not.toMatch(BANNED);
  });

  it("maps deposit notification types", () => {
    expect(depositNotificationKind("security_deposit_charged")).toBe("charged");
    expect(depositNotificationKind("security_claim_opened_owner")).toBe("charged");
    expect(depositNotificationKind("security_deposit_refunded")).toBe("refunded");
    expect(depositNotificationKind("security_deposit_retained")).toBe("retained");
    expect(depositNotificationKind("deposit_hold_released")).toBe("released");
    expect(depositNotificationKind("badge_earned")).toBeNull();
  });
});
