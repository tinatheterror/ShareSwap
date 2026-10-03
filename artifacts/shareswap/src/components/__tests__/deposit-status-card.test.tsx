import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DepositStatusCard } from "../deposit-status-card";

describe("DepositStatusCard", () => {
  it("shows a temporary hold (derived from legacy status) without charge language", () => {
    render(<DepositStatusCard role="borrower" deposit={{ status: "authorized", amount: "105" }} />);
    const card = screen.getByTestId("deposit-card-hold");
    expect(card.textContent).toContain("$105.00 temporary card hold");
    expect(card.textContent).toContain("not a charge");
    expect(card.textContent).not.toMatch(/authorization expires|3-day/i);
  });

  it("shows borrower claim review copy once charged and never says held", () => {
    render(<DepositStatusCard role="borrower" deposit={{ status: "captured", phase: "charged", amount: "105", chargedAmount: 105 }} />);
    const card = screen.getByTestId("deposit-card-charged-borrower");
    expect(card.textContent).toContain("$105.00 charged");
    expect(card.textContent).toContain("Why was I charged?");
    expect(card.textContent).toContain("What happens next?");
    expect(card.textContent).not.toMatch(/\bheld\b|on hold|secured/i);
  });

  it("shows owner charged state", () => {
    render(<DepositStatusCard role="owner" deposit={{ status: "captured", amount: "105" }} />);
    expect(screen.getByTestId("deposit-card-charged-owner").textContent).toContain("under review, $105.00 security deposit has been charged");
  });

  it("shows released as hold released, not refunded", () => {
    render(<DepositStatusCard role="borrower" deposit={{ status: "released", amount: "105" }} />);
    const t = screen.getByTestId("deposit-card-released").textContent!;
    expect(t).toContain("Deposit hold released");
    expect(t).toContain("You were not charged");
    expect(t).not.toMatch(/refund/i);
  });

  it("shows resolved amounts", () => {
    render(<DepositStatusCard role="borrower" deposit={{ phase: "resolved", amount: "105", chargedAmount: 105, refundedAmount: 75, retainedAmount: 30 }} />);
    const t = screen.getByTestId("deposit-card-resolved").textContent!;
    expect(t).toContain("$75.00 refunded");
    expect(t).toContain("$30.00 retained");
    expect(t).not.toMatch(/\bfee\b/i);
  });

  it("treats refundable_charge as a real charge, never a temporary hold", () => {
    render(<DepositStatusCard role="borrower" deposit={{ mode: "refundable_charge", status: "secured", phase: "hold", amount: "50" }} />);
    const t = screen.getByTestId("deposit-card-refundable").textContent!;
    expect(t).toContain("refundable deposit charged");
    expect(t).not.toMatch(/temporary card hold|hold placed/i);
  });
});
