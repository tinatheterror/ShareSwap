import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));

import { CardDisputeRow, type CardDispute } from "@/components/admin/card-disputes";

afterEach(cleanup);

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const base: CardDispute = {
  disputeId: "du_1", requestId: 12, itemName: "Cordless drill", reason: "fraudulent", amountCents: 2000, currency: "cad", feeCents: 1500, outcome: "open",
  reviewStatus: "pending_admin", lossAmountCents: 2000, lossFeeCents: 1500, rentalWasOpen: true, evidenceDueBy: hours(24), evidenceSubmittedToStripeAt: null,
  depositAuthorizationExpiresAt: hours(100), depositStatus: "held", createdAt: new Date().toISOString(),
};

describe("a card dispute in the admin view", () => {
  it("shows Stripe's evidence deadline and the deposit authorization expiry, and flags the one within 48 hours", () => {
    render(<CardDisputeRow dispute={base} />);
    const due = screen.getByTestId("due-by-du_1");
    expect(due.textContent).toMatch(/Stripe needs evidence by/);
    expect(due.textContent).toMatch(/within 48 hours/);
    const expiry = screen.getByTestId("auth-expiry-du_1");
    expect(expiry.textContent).toMatch(/Deposit authorization expires/);
    expect(expiry.textContent).not.toMatch(/within 48 hours/);
    expect(screen.getByTestId("card-dispute-du_1").textContent).toMatch(/platform loss 35\.00 CAD/);
    expect(screen.getByTestId("card-dispute-du_1").textContent).toMatch(/deposit hold stays in place/);
  });

  it("does not flag a deadline that no longer matters (evidence sent, hold released) or has passed", () => {
    render(<CardDisputeRow dispute={{ ...base, evidenceSubmittedToStripeAt: hours(-1), depositAuthorizationExpiresAt: hours(10), depositStatus: "released" }} />);
    expect(screen.getByTestId("due-by-du_1").textContent).not.toMatch(/within 48 hours/);
    expect(screen.getByTestId("auth-expiry-du_1").textContent).not.toMatch(/within 48 hours/);
    cleanup();
    render(<CardDisputeRow dispute={{ ...base, evidenceDueBy: hours(-5) }} />);
    expect(screen.getByTestId("due-by-du_1").textContent).toMatch(/passed/);
  });

  it("copes with a dispute that matches no request and has no dates", () => {
    render(<CardDisputeRow dispute={{ ...base, requestId: null, itemName: null, evidenceDueBy: null, depositAuthorizationExpiresAt: null }} />);
    expect(screen.getByTestId("card-dispute-du_1").textContent).toMatch(/not matched to a request/);
    expect(screen.getByTestId("due-by-du_1").textContent).toMatch(/not known/);
    expect(screen.queryByTestId("auth-expiry-du_1")).toBeNull();
  });

  it("flags a dispute whose deposit hold expired as urgent, and opens the review panel on request", () => {
    render(<CardDisputeRow dispute={{ ...base, depositStatus: "EXPIRED_UNSECURED", urgentManualReview: true, depositUncollectibleAt: hours(-1) }} />);
    expect(screen.getByTestId("urgent-du_1").textContent).toMatch(/deposit hold expired/);
    expect(screen.queryByTestId("dispute-review-du_1")).toBeNull();
    expect(screen.getByTestId("review-toggle-du_1").textContent).toBe("Review and evidence");
  });
});
