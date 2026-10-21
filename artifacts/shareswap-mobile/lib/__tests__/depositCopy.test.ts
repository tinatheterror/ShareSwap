import {
  formatMoney, holdReleasedMessage, resolveDepositPhase, depositSummaryLine, holdTitle, holdPendingNote, holdReleaseExplainer,
  claimOpenedBorrowerCopy, claimOpenedOwnerLine, claimResolvedBorrowerCopy, claimResolvedCardView, claimResolvedOwnerLine,
  depositConfirmedStamp, depositNotificationKind, depositReleasedStamp, CANCEL_BOOKING_MESSAGE, CLAIM_REVIEW_TOP,
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

  it("the request card's deposit line is the amount only, whatever happened to the deposit", () => {
    for (const phase of ["none", "hold", "charged", "released", "resolved"] as const) {
      expect(depositSummaryLine({ phase, amount: 105, chargedAmount: 105, refundedAmount: 5, retainedAmount: 100 })).toBe("Deposit: $105");
    }
    expect(depositSummaryLine({ mode: "refundable_charge", status: "released", amount: 42 })).toBe("Deposit: $42");
    expect(depositSummaryLine(null, 42)).toBe("Deposit: $42");
    expect(depositSummaryLine(null)).toBeNull();
  });

  it("builds hold explainers", () => {
    expect(holdTitle(105)).toBe("$105 deposit hold");
    expect(holdPendingNote(105)).toContain("This is a deposit hold, not a charge. Your card may show $105 as pending or temporarily unavailable.");
    expect(holdReleaseExplainer(105)).toBe("After the item is returned normally, the $105 hold is released. If a claim is opened, the deposit may be charged while the claim is reviewed.");
    expect(CANCEL_BOOKING_MESSAGE).toBe("Your deposit hold will be released. You will not be charged.");
    expect(holdReleasedMessage(105)).toBe("$105 deposit hold released. You were not charged.");
  });

  it("a released deposit is a one-line chat stamp that is mode-based", () => {
    expect(depositReleasedStamp({ depositMode: "authorization", amount: 42 })).toBe("✅ Deposit hold released. You weren’t charged.");
    expect(depositReleasedStamp({ amount: "42.00" })).toBe("✅ Deposit hold released. You weren’t charged.");
    expect(depositReleasedStamp({ depositMode: "refundable_charge", amount: 42 })).toBe("✅ Deposit refunded. It may take 5–10 business days to show on your card.");
    expect(depositReleasedStamp(undefined)).toBe("✅ Deposit hold released. You weren’t charged.");
    expect(depositReleasedStamp({ depositMode: "refundable_charge" })).toBe("✅ Deposit refunded. It may take 5–10 business days to show on your card.");
  });

  it("claim opened copy depends on the deposit mode", () => {
    const hold = claimOpenedBorrowerCopy({ amount: 105, cardLast4: "4242", mode: "authorization" });
    expect(hold.title).toBe("Security deposit charged");
    expect(hold.body).toBe("$105 has been charged to your card •••• 4242.");
    expect(hold.detail).toBe("Your deposit hold was charged while the claim is reviewed.");
    expect(claimOpenedOwnerLine(105, "authorization")).toBe("Claim opened. Deposit charged while it’s reviewed.");
    const charge = claimOpenedBorrowerCopy({ amount: 105, cardLast4: "4242", mode: "refundable_charge" });
    expect(charge.title).toBe("Security deposit held");
    expect(charge.body).toBe("$105 is held while the claim is reviewed.");
    expect(charge.detail).toBe("Your deposit was already charged. It stays held while the claim is reviewed.");
    expect(claimOpenedOwnerLine(105, "refundable_charge")).toBe("Claim opened. Deposit held while it’s reviewed.");
    expect(JSON.stringify([hold, charge])).not.toMatch(/temporary hold/i);
  });

  it("claim opened copy is explicit", () => {
    const c = claimOpenedBorrowerCopy({ amount: 105, cardLast4: "4242" });
    expect(c.title).toBe("Security deposit charged");
    expect(c.body).toBe("$105 has been charged to your card •••• 4242.");
    expect(c.detail).toBe("Your deposit hold was charged while the claim is reviewed.");
    expect(JSON.stringify(c)).not.toMatch(/temporary hold/i);
    expect(JSON.stringify(c)).not.toMatch(/deposit held|on hold|secured/i);
    expect(claimOpenedOwnerLine(105)).toBe("Claim opened. Deposit charged while it’s reviewed.");
    expect(claimOpenedOwnerLine(105, "refundable_charge")).toBe("Claim opened. Deposit held while it’s reviewed.");
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
    expect(claimResolvedOwnerLine(75, 30)).toBe("Claim resolved · $75 refunded · $30 awarded to owner");
    expect(claimResolvedOwnerLine(100, 0)).toBe("Claim resolved · $100 refunded");
    expect(claimResolvedOwnerLine(0, 100)).toBe("Claim resolved · $100 awarded to owner");
  });

  it("relabels the deposit_confirmed stamp", () => {
    expect(depositConfirmedStamp({})).toBe("🔒 Deposit hold authorized. It’s only charged if a claim is opened.");
    expect(depositConfirmedStamp({ mode: "refundable_charge" })).toBe("🔒 Deposit charged. Refunded after the item is returned.");
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

describe("claimResolvedCardView", () => {
  const cases: [string, string][] = [
    ["refunded_full", "Claim resolved · $100 refunded"],
    ["awarded_full", "Claim resolved · $100 awarded to owner"],
    ["refunded_partial", "Claim resolved · $40 refunded · $60 awarded to owner"],
    ["hold_released", "Claim resolved · Deposit hold released"],
  ];
  it.each(cases)("renders the server text for %s to both the borrower and the owner", (outcome, content) => {
    for (const isOwnerView of [true, false]) {
      const view = claimResolvedCardView({ content, outcome, isOwnerView });
      expect(view.body).toBe(content);
      expect(`${view.body} ${view.detail}`).not.toMatch(/retained|\bkept\b/i);
    }
  });
  it("only says the deposit was previously charged when money was actually charged", () => {
    expect(claimResolvedCardView({ content: "x", outcome: "hold_released", isOwnerView: false }).detail).toBe("");
    expect(claimResolvedCardView({ content: "x", outcome: "refunded_full", isOwnerView: false }).detail).toMatch(/previously charged/);
    expect(claimResolvedCardView({ content: "x", outcome: "refunded_full", isOwnerView: true }).detail).toBe("");
  });
  it("tones the card by who got the money", () => {
    expect(claimResolvedCardView({ content: "x", outcome: "awarded_full", isOwnerView: false }).tone).toBe("awarded");
    expect(claimResolvedCardView({ content: "x", outcome: "retained_full", isOwnerView: false }).tone).toBe("awarded");
    expect(claimResolvedCardView({ content: "x", outcome: "refunded_partial", isOwnerView: false }).tone).toBe("refunded");
    expect(claimResolvedCardView({ content: "x", outcome: "awarded_full", isOwnerView: true }).tone).toBe("owner");
  });
});
