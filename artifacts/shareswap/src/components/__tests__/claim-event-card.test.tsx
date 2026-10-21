import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClaimEventCard } from "../chat-widget";

// Importing the chat widget would otherwise start loading Stripe over the network.
vi.mock("@/lib/stripe-client", () => ({ getStripePromise: () => null }));

const CASES = [
  { content: "Claim resolved · $100 refunded", metadata: { outcome: "refunded_full", refundedAmount: 100, retainedAmount: 0 } },
  { content: "Claim resolved · $100 awarded to owner", metadata: { outcome: "awarded_full", refundedAmount: 0, awardedAmount: 100, retainedAmount: 100 } },
  { content: "Claim resolved · $40 refunded · $60 awarded to owner", metadata: { outcome: "refunded_partial", refundedAmount: 40, awardedAmount: 60, retainedAmount: 60 } },
  { content: "Claim resolved · Deposit hold released", metadata: { outcome: "hold_released", refundedAmount: 0, retainedAmount: 0 } },
] as const;

describe("ClaimEventCard for a resolved claim", () => {
  for (const { content, metadata } of CASES) {
    for (const viewerIsBorrower of [true, false]) {
      it(`shows the server's text "${content}" to the ${viewerIsBorrower ? "borrower" : "owner"}`, () => {
        const { unmount } = render(<ClaimEventCard eventType="claim_resolved" metadata={metadata as any} content={content} viewerIsBorrower={viewerIsBorrower} />);
        const card = screen.getByTestId(viewerIsBorrower ? "event-claim-resolved-borrower" : "event-claim-resolved-owner");
        expect(card.textContent).toContain(content);
        expect(card.textContent).not.toMatch(/retained|\bkept\b/i);
        unmount();
      });
    }
  }

  it("does not claim a deposit was charged when only a hold was released", () => {
    render(<ClaimEventCard eventType="claim_resolved" metadata={{ outcome: "hold_released" } as any} content="Claim resolved · Deposit hold released" viewerIsBorrower />);
    expect(screen.getByTestId("event-claim-resolved-borrower").textContent).not.toMatch(/previously charged/i);
  });
});
