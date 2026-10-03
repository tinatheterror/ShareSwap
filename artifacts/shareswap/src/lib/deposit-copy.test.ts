import { describe, expect, it } from "vitest";
import {
  claimOpenedChargedLine,
  claimOpenedOwnerLine,
  claimOutcome,
  claimRefundedLine,
  claimResolvedOwnerLine,
  claimResolvedSummary,
  depositConfirmedStampLabel,
  depositNotificationKind,
  depositPhaseCopy,
  formatMoney,
  holdPendingNotice,
  holdReleaseExplainer,
  holdReleasedBody,
  phaseFromStatus,
  resolveDepositPhase,
} from "./deposit-copy";

describe("deposit-copy", () => {
  it("formats money", () => {
    expect(formatMoney(105)).toBe("$105.00");
    expect(formatMoney("75.5")).toBe("$75.50");
    expect(formatMoney(null)).toBe("$0.00");
  });

  it("derives phase from legacy status", () => {
    expect(phaseFromStatus("authorized")).toBe("hold");
    expect(phaseFromStatus("held")).toBe("hold");
    expect(phaseFromStatus("captured")).toBe("charged");
    expect(phaseFromStatus("released")).toBe("released");
    expect(phaseFromStatus("settled")).toBe("resolved");
    expect(phaseFromStatus(undefined)).toBe("none");
  });

  it("prefers backend phase and treats refundable_charge as charged", () => {
    expect(resolveDepositPhase({ status: "authorized", phase: "charged" })).toBe("charged");
    expect(resolveDepositPhase({ status: "authorized" })).toBe("hold");
    expect(resolveDepositPhase({ mode: "refundable_charge", status: "secured", phase: "hold" })).toBe("charged");
    expect(depositPhaseCopy({ mode: "refundable_charge", status: "secured", amount: 50 }).label).toBe("Refundable deposit charged");
  });

  it("never calls a captured deposit held or a release a refund", () => {
    const charged = depositPhaseCopy({ status: "captured", amount: 105, chargedAmount: 105 });
    expect(charged.label).toBe("Charged");
    expect(charged.description).not.toMatch(/hold|held|secured/i);
    const released = depositPhaseCopy({ status: "released", amount: 105 });
    expect(released.label).toBe("Hold released");
    expect(released.description).not.toMatch(/refund/i);
    expect(released.description).toBe("$105.00 temporary hold released. You were not charged.");
  });

  it("holds copy", () => {
    expect(holdPendingNotice(105)).toContain("temporary hold, not a charge");
    expect(holdReleaseExplainer(105)).toContain("$105.00 hold is released");
    expect(holdReleasedBody(105)).toBe("$105.00 temporary hold released. You were not charged.");
  });

  it("claim strings", () => {
    expect(claimOpenedChargedLine(105, "4242")).toBe("$105.00 has been charged to your card •••• 4242.");
    expect(claimOpenedOwnerLine(105)).toBe("Claim opened and under review, $105.00 security deposit has been charged");
    expect(claimRefundedLine(105, "4242")).toBe("$105.00 refunded to your card •••• 4242.");
    expect(claimResolvedOwnerLine({ refundedAmount: 75, retainedAmount: 30 })).toBe(
      "Claim has been resolved. $75.00 refunded · $30.00 retained",
    );
  });

  it("outcomes", () => {
    expect(claimOutcome({ refundedAmount: 105, retainedAmount: 0 })).toBe("refunded_full");
    expect(claimOutcome({ refundedAmount: 75, retainedAmount: 30 })).toBe("refunded_partial");
    expect(claimOutcome({ refundedAmount: 0, retainedAmount: 105 })).toBe("retained_full");
    expect(claimResolvedSummary({ chargedAmount: 105, refundedAmount: 0, retainedAmount: 30 })).toContain("retained");
    expect(claimResolvedSummary({ chargedAmount: 105, refundedAmount: 0, retainedAmount: 30 })).not.toMatch(/fee/i);
  });

  it("stamp label and notification kinds", () => {
    expect(depositConfirmedStampLabel()).toBe("🔒 Temporary hold placed");
    expect(depositConfirmedStampLabel({ mode: "refundable_charge" })).toBe("🔒 Refundable deposit charged");
    expect(depositNotificationKind("security_deposit_charged")).toBe("charged");
    expect(depositNotificationKind("security_claim_opened_owner")).toBe("charged");
    expect(depositNotificationKind("security_deposit_refunded")).toBe("refunded");
    expect(depositNotificationKind("security_deposit_retained")).toBe("retained");
    expect(depositNotificationKind("deposit_hold_released")).toBe("released");
    expect(depositNotificationKind("other")).toBeNull();
  });
});
