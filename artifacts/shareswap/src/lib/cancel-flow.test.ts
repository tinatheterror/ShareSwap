import { describe, expect, it } from "vitest";

import {
  CANCEL_PENALTY_POINTS,
  CONTINUE_WITH_TRANSACTION,
  PENALTY_MODAL_TEXT,
  PROCEED_TO_CANCEL,
  cancelAction,
  cancelToast,
  interpretCancelError,
  interpretCancelSuccess,
  isServerDecidedCancel,
  legacyCancelDialog,
  penaltyDialog,
  submitCancel,
  type CancelRole,
} from "@workspace/api-client-react/cancel-flow";

const TYPES = ["BORROW", "RENT", "SWAP", "GIFT"];
const STATUSES = ["PENDING", "ACCEPTED", "DEPOSIT_CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"];
const ROLES: CancelRole[] = ["requester", "owner"];

describe("cancel flow: who sees a Cancel button, and what it does", () => {
  it("BORROW and RENT cancel straight away for the requester (pending, accepted, deposit in place)", () => {
    for (const requestType of ["BORROW", "RENT"]) {
      for (const status of ["PENDING", "ACCEPTED", "DEPOSIT_CONFIRMED"]) {
        expect(cancelAction({ requestType, status, role: "requester" })).toBe("direct");
      }
      for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"]) {
        expect(cancelAction({ requestType, status, role: "requester" })).toBe("none");
      }
    }
  });

  it("owners can cancel an accepted BORROW or RENT (option a), never a pending one (they decline it)", () => {
    for (const requestType of ["BORROW", "RENT"]) {
      expect(cancelAction({ requestType, status: "ACCEPTED", role: "owner" })).toBe("direct");
      expect(cancelAction({ requestType, status: "DEPOSIT_CONFIRMED", role: "owner" })).toBe("direct");
      expect(cancelAction({ requestType, status: "PENDING", role: "owner" })).toBe("none");
      expect(cancelAction({ requestType, status: "IN_PROGRESS", role: "owner" })).toBe("none");
    }
  });

  it("SWAP and GIFT keep a confirmation, and only a GIFT giver can cancel as owner", () => {
    expect(cancelAction({ requestType: "GIFT", status: "ACCEPTED", role: "owner" })).toBe("confirm");
    expect(cancelAction({ requestType: "GIFT", status: "PENDING", role: "owner" })).toBe("none");
    expect(cancelAction({ requestType: "SWAP", status: "ACCEPTED", role: "owner" })).toBe("none");
    for (const requestType of ["SWAP", "GIFT"]) {
      expect(cancelAction({ requestType, status: "ACCEPTED", role: "requester" })).toBe("confirm");
      expect(cancelAction({ requestType, status: "DEPOSIT_CONFIRMED", role: "requester" })).toBe("confirm");
      expect(cancelAction({ requestType, status: "PENDING", role: "requester" })).toBe("direct");
    }
  });

  it("only BORROW and RENT are decided by the server", () => {
    expect(TYPES.filter(isServerDecidedCancel)).toEqual(["BORROW", "RENT"]);
  });
});

describe("cancel flow: dialogs", () => {
  it("BORROW and RENT never get a confirmation dialog, on either platform", () => {
    for (const requestType of ["BORROW", "RENT"]) {
      for (const status of STATUSES) {
        for (const role of ROLES) {
          for (const platform of ["web", "mobile"] as const) {
            expect(legacyCancelDialog({ requestType, status, role }, platform)).toBeNull();
          }
        }
      }
    }
  });

  it('"Cancel this gift?" appears for an owner\'s accepted GIFT and nowhere else', () => {
    const hits: string[] = [];
    for (const requestType of TYPES) {
      for (const status of STATUSES) {
        for (const role of ROLES) {
          for (const platform of ["web", "mobile"] as const) {
            const spec = legacyCancelDialog({ requestType, status, role }, platform);
            if (spec?.title === "Cancel this gift?") hits.push(`${requestType}/${status}/${role}/${platform}`);
          }
        }
      }
    }
    expect(hits).toEqual(["GIFT/ACCEPTED/owner/mobile"]);
  });

  it("keeps each app's existing SWAP/GIFT wording", () => {
    expect(legacyCancelDialog({ requestType: "SWAP", status: "ACCEPTED", role: "requester" }, "mobile")).toMatchObject({
      title: "Cancel request?", message: "The owner has already accepted your request.", keepLabel: "Keep booking", confirmLabel: "Cancel", primary: "confirm",
    });
    expect(legacyCancelDialog({ requestType: "SWAP", status: "ACCEPTED", role: "requester" }, "web")?.title).toBe("Cancel this booking?");
    expect(legacyCancelDialog({ requestType: "GIFT", status: "DEPOSIT_CONFIRMED", role: "requester" }, "web")?.message).toBe(
      "Your deposit hold will be released automatically — you will not be charged.",
    );
    expect(legacyCancelDialog({ requestType: "GIFT", status: "ACCEPTED", role: "owner" }, "mobile")).toMatchObject({
      title: "Cancel this gift?", message: "The requester will be notified.", keepLabel: "Keep it",
    });
  });

  it("the penalty modal says what the server says, labels both buttons, and makes Continue the default", () => {
    const spec = penaltyDialog({ role: "requester", otherPartyName: "Sam", serverError: PENALTY_MODAL_TEXT });
    expect(spec.title).toBe("Cancel this booking?");
    expect(spec.message).toBe("A trust score penalty of -5 will be applied for this cancellation");
    expect(spec.hint).toBe("If plans have changed, message Sam to agree a change first.");
    expect(spec.keepLabel).toBe(CONTINUE_WITH_TRANSACTION);
    expect(spec.confirmLabel).toBe(PROCEED_TO_CANCEL);
    expect([spec.keepLabel, spec.confirmLabel]).toEqual(["Continue with transaction", "Proceed to cancel"]);
    expect(spec.primary).toBe("keep");
  });

  it("the owner's modal says 'request', falls back to the standard sentence and to a neutral name", () => {
    const spec = penaltyDialog({ role: "owner" });
    expect(spec.title).toBe("Cancel this request?");
    expect(spec.message).toBe(PENALTY_MODAL_TEXT);
    expect(spec.hint).toBe("If plans have changed, message the other person to agree a change first.");
  });
});

describe("cancel flow: talking to the server", () => {
  it("the first send has no acknowledgment; the second carries exactly the amount the server announced", async () => {
    const sent: unknown[] = [];
    await submitCancel(async (body) => { sent.push(body); return { message: "Request cancelled." }; });
    await submitCancel(async (body) => { sent.push(body); return { message: "Request cancelled." }; }, { acknowledged: true, reason: "changed_plans" });
    expect(sent).toEqual([{}, { reason: "changed_plans", acknowledgePenalty: CANCEL_PENALTY_POINTS }]);
    expect(CANCEL_PENALTY_POINTS).toBe(5);
  });

  it("a PENALTY_ACK_REQUIRED error is a prompt, not a failure", async () => {
    const error = Object.assign(new Error("A trust score penalty of -5 will be applied for this cancellation"), {
      status: 409, code: "PENALTY_ACK_REQUIRED", error: "A trust score penalty of -5 will be applied for this cancellation", penalty: { points: 5 },
    });
    expect(await submitCancel(async () => { throw error; })).toEqual({
      kind: "ack_required", error: "A trust score penalty of -5 will be applied for this cancellation", points: 5,
    });
  });

  it("other errors are failures with the server's wording, and say whether a retry is safe", () => {
    expect(interpretCancelError(Object.assign(new Error("We couldn't release your payment. Nothing was changed — please try again."), { code: "REFUND_FAILED", retryable: true }))).toEqual({
      kind: "failed", message: "We couldn't release your payment. Nothing was changed — please try again.", retryable: true, code: "REFUND_FAILED",
    });
    expect(interpretCancelError({})).toMatchObject({ kind: "failed", retryable: false });
  });

  it("success carries the server's sentence and whether it was already cancelled", () => {
    expect(interpretCancelSuccess({ message: "Request cancelled. Nothing was charged.", outcome: { penaltyApplied: false } })).toEqual({
      kind: "done", alreadyCancelled: false, message: "Request cancelled. Nothing was charged.", penaltyApplied: false,
    });
    expect(interpretCancelSuccess({ alreadyCancelled: true, message: "This request was already cancelled." })).toMatchObject({ alreadyCancelled: true });
    expect(interpretCancelSuccess({ success: true })).toMatchObject({ message: "Request cancelled." });
  });

  it("the toast leads with 'Request cancelled' and then what was released or refunded", () => {
    expect(cancelToast({ alreadyCancelled: false, message: "Request cancelled. Your $42 temporary hold was released. You were not charged. A trust score penalty of -5 was applied." })).toEqual({
      title: "Request cancelled",
      description: "Your $42 temporary hold was released. You were not charged. A trust score penalty of -5 was applied.",
    });
    expect(cancelToast({ alreadyCancelled: false, message: "Request cancelled." })).toEqual({ title: "Request cancelled", description: undefined });
    expect(cancelToast({ alreadyCancelled: false, message: "Gift cancelled. Your item is available again." })).toEqual({
      title: "Request cancelled", description: "Gift cancelled. Your item is available again.",
    });
    expect(cancelToast({ alreadyCancelled: true, message: "This request was already cancelled." })).toEqual({ title: "Already cancelled" });
  });
});
