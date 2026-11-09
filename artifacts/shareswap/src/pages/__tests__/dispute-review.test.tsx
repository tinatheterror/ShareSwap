import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

import { DisputeReviewPanel, stripeDisputeUrl, type EvidenceBundle, type ReviewContext } from "@/components/admin/dispute-review";

const ok = () => Promise.resolve({ ok: true, json: async () => ({}) });
beforeEach(() => apiRequest.mockReset().mockImplementation(ok));
afterEach(cleanup);

const bundle: EvidenceBundle = {
  dispute: { id: "du_1", reason: "fraudulent", outcome: "open", reviewStatus: "pending_admin", evidenceDueBy: "2026-11-20T12:00:00.000Z", evidenceSubmittedToStripeAt: null },
  owner: "olive", borrower: "ben",
  ownerEvidence: [{ at: "2026-11-09T10:00:00.000Z", note: "He signed for it in person.", photoUrls: ["/api/dispute-evidence/files/abc"] }],
  photos: ["/api/dispute-evidence/files/abc", "/uploads/item-1.jpg"],
  summaryText: "Dispute du_1 (fraudulent). Handoff: both confirmed.",
};
const context: ReviewContext = { disputeId: "du_1", reviewStatus: "pending_admin", depositStatus: "authorized" };

describe("reviewing a card dispute", () => {
  it("shows the bundle: due date, the owner's statement, the photos and the text to paste into Stripe", () => {
    render(<DisputeReviewPanel bundle={bundle} context={context} />);
    expect(screen.getByTestId("evidence-due").textContent).toMatch(/Stripe needs evidence by: /);
    expect(screen.getByText(/He signed for it in person/)).toBeTruthy();
    expect(screen.getByTestId("evidence-photos").querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByTestId("summary-text").textContent).toBe(bundle.summaryText);
    expect(screen.getByRole("link", { name: /Stripe's dashboard/ }).getAttribute("href")).toBe(stripeDisputeUrl("du_1"));
    expect(screen.getByText(/does not send this to Stripe/)).toBeTruthy();
    expect(screen.queryByTestId("urgent-banner")).toBeNull();
    expect(screen.queryByTestId("complete-rental")).toBeNull();
  });

  it("says so when the owner has sent nothing", () => {
    render(<DisputeReviewPanel bundle={{ ...bundle, ownerEvidence: [], photos: [] }} context={context} />);
    expect(screen.getByTestId("no-owner-evidence")).toBeTruthy();
    expect(screen.queryByTestId("evidence-photos")).toBeNull();
  });

  it("will not record a review without a note, then posts the note and what was ticked to the review endpoint", async () => {
    const changed = vi.fn();
    render(<DisputeReviewPanel bundle={bundle} context={context} onChanged={changed} />);
    const submit = screen.getByTestId("review-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("review-note"), { target: { value: "ok" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("review-note"), { target: { value: "  Checked the handoff record; evidence sent.  " } });
    fireEvent.click(screen.getByTestId("review-sent"));
    fireEvent.click(screen.getByTestId("review-clear-flag"));
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByTestId("review-message").textContent).toBe("Review recorded."));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/chargebacks/du_1/review", {
      note: "Checked the handoff record; evidence sent.", evidenceSubmittedToStripe: true, clearBorrowerFlag: true,
    });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason when the review is refused", async () => {
    apiRequest.mockImplementation(() => Promise.resolve({ ok: false, json: async () => ({ message: "Dispute not found" }) }));
    render(<DisputeReviewPanel bundle={bundle} context={context} />);
    fireEvent.change(screen.getByTestId("review-note"), { target: { value: "Looked at everything." } });
    fireEvent.click(screen.getByTestId("review-submit"));
    await waitFor(() => expect(screen.getByTestId("review-message").textContent).toBe("Dispute not found"));
  });

  it("an expired deposit hold shows the urgent notice and lets the rental be closed while the dispute stays open", async () => {
    render(<DisputeReviewPanel bundle={bundle} context={{ ...context, depositStatus: "EXPIRED_UNSECURED", urgentManualReview: true, depositUncollectibleAt: "2026-11-09T09:00:00.000Z" }} />);
    expect(screen.getByTestId("urgent-banner").textContent).toMatch(/nothing will be charged automatically/);
    const close = screen.getByTestId("complete-rental") as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("review-note"), { target: { value: "Hold lapsed, closing the rental." } });
    fireEvent.click(close);
    await waitFor(() => expect(screen.getByTestId("review-message").textContent).toMatch(/dispute is still open/));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/chargebacks/du_1/complete-rental", { note: "Hold lapsed, closing the rental." });
  });

  it("a reviewed dispute offers no review form, and a closed rental no second close", () => {
    render(<DisputeReviewPanel bundle={bundle} context={{ ...context, reviewStatus: "reviewed", depositStatus: "EXPIRED_UNSECURED", rentalCompletedAt: "2026-11-09T10:00:00.000Z" }} />);
    expect(screen.getByTestId("already-reviewed")).toBeTruthy();
    expect(screen.queryByTestId("review-submit")).toBeNull();
    expect(screen.queryByTestId("complete-rental")).toBeNull();
    expect(screen.getByTestId("rental-closed")).toBeTruthy();
  });
});
