import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRequestLane, deriveCompletedAt, REVIEW_WINDOW_DAYS, type LaneInput } from "./request-lanes";

const OWNER = 1;
const BORROWER = 2;
const NOW = new Date("2026-10-30T12:00:00Z");
const base: LaneInput = { status: "PENDING", requestType: "BORROW", requesterId: BORROWER, ownerId: OWNER, endDate: "2026-11-03" };
const lane = (over: Partial<LaneInput>, viewer: number) => classifyRequestLane({ ...base, ...over }, viewer, "Sam", NOW);

describe("classifyRequestLane", () => {
  it("maps every status for owner and borrower", () => {
    const cases: Array<[Partial<LaneInput>, string, string]> = [
      // [input, owner section, borrower section]
      [{ status: "PENDING" }, "action", "in_progress"],
      [{ status: "ACCEPTED" }, "in_progress", "action"],
      [{ status: "ACCEPTED", requestType: "GIFT" }, "in_progress", "action"],
      [{ status: "ACCEPTED", requestType: "SWAP" }, "in_progress", "in_progress"],
      [{ status: "DEPOSIT_PENDING" }, "in_progress", "action"],
      [{ status: "DEPOSIT_CONFIRMED" }, "action", "action"],
      [{ status: "AWAITING_HANDOFF_CONFIRM" }, "action", "action"],
      [{ status: "HANDOFF_CONFIRMED" }, "in_progress", "in_progress"],
      [{ status: "IN_PROGRESS" }, "in_progress", "in_progress"],
      [{ status: "RETURN_DUE" }, "in_progress", "action"],
      [{ status: "OVERDUE_GRACE" }, "in_progress", "action"],
      [{ status: "OVERDUE" }, "in_progress", "action"],
      [{ status: "SERIOUSLY_OVERDUE" }, "in_progress", "action"],
      [{ status: "RETURN_REQUESTED" }, "action", "in_progress"],
      [{ status: "RETURNED_PENDING_REVIEW" }, "action", "in_progress"],
      [{ status: "RETURN_CONFIRMED" }, "in_progress", "in_progress"],
      [{ status: "DISPUTED" }, "in_progress", "in_progress"],
      [{ status: "HANDOFF_DISPUTED" }, "in_progress", "in_progress"],
      [{ status: "NON_RETURN_REVIEW" }, "in_progress", "in_progress"],
      [{ status: "SOMETHING_NEW" }, "in_progress", "in_progress"],
      [{ status: "CANCELLED" }, "history", "history"],
      [{ status: "DECLINED" }, "history", "history"],
      [{ status: "REJECTED" }, "history", "history"],
      [{ status: "EXPIRED" }, "history", "history"],
      [{ status: "DEPOSIT_FAILED" }, "history", "history"],
    ];
    for (const [input, owner, borrower] of cases) {
      assert.equal(lane(input, OWNER).section, owner, `${input.status} ${input.requestType ?? ""} as owner`);
      assert.equal(lane(input, BORROWER).section, borrower, `${input.status} ${input.requestType ?? ""} as borrower`);
    }
  });

  it("keeps the borrower's loan in progress with a return date, then asks for the return at RETURN_DUE", () => {
    const active = lane({ status: "IN_PROGRESS" }, BORROWER);
    assert.equal(active.statusLine, "Return by Nov 3");
    assert.equal(active.dueDay, "2026-11-03");
    const due = lane({ status: "RETURN_DUE" }, BORROWER);
    assert.equal(due.section, "action");
    assert.equal(due.actionLabel, "Return the item");
  });

  it("uses the extended return date when one was accepted", () => {
    assert.equal(lane({ status: "IN_PROGRESS", returnDeadlineAt: "2026-11-05" }, BORROWER).dueDay, "2026-11-05");
  });

  it("waits on the party who has not confirmed the handoff", () => {
    assert.equal(lane({ status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true }, OWNER).section, "in_progress");
    assert.equal(lane({ status: "AWAITING_HANDOFF_CONFIRM", ownerConfirmedHandoff: true }, BORROWER).section, "action");
  });

  it("sends a counter-offer to the party who did not make it", () => {
    const counter = { negotiationStatus: "counter_proposed", counterProposedBy: BORROWER };
    assert.equal(lane(counter, OWNER).actionLabel, "Respond to counter-offer");
    assert.equal(lane(counter, BORROWER).section, "in_progress");
  });

  it("asks the owner about a pending extension and tells the borrower it was sent", () => {
    assert.equal(lane({ status: "IN_PROGRESS", pendingExtension: true }, OWNER).actionLabel, "Respond to extension request");
    assert.match(lane({ status: "IN_PROGRESS", pendingExtension: true }, BORROWER).statusLine, /extension request sent/);
  });

  it("asks for a review of a completed request until it is reviewed or the window closes", () => {
    const day = 24 * 60 * 60 * 1000;
    const done = (daysAgo: number, reviewedByViewer = false) =>
      lane({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - daysAgo * day), reviewedByViewer }, OWNER);
    assert.equal(done(1).actionLabel, "Leave a review");
    assert.equal(done(REVIEW_WINDOW_DAYS - 1).section, "action");
    assert.equal(done(REVIEW_WINDOW_DAYS + 1).section, "history");
    assert.equal(done(1, true).section, "history");
    assert.equal(lane({ status: "COMPLETED_EARLY", completedAt: new Date(NOW.getTime() - day) }, BORROWER).section, "action");
  });

  it("puts a completed request with no known completion time in history", () => {
    assert.equal(lane({ status: "COMPLETED" }, OWNER).section, "history");
  });
});

describe("deriveCompletedAt", () => {
  it("prefers the return, then the deposit release, then the handoff", () => {
    const a = new Date("2026-10-01"), b = new Date("2026-10-02"), c = new Date("2026-10-03");
    assert.equal(deriveCompletedAt({ returnConfirmedAt: a, depositReleasedAt: b, createdAt: c }), a);
    assert.equal(deriveCompletedAt({ depositReleasedAt: b, createdAt: c }), b);
    assert.equal(deriveCompletedAt({ actualHandoffAt: b, createdAt: c }), b);
    assert.equal(deriveCompletedAt({}), null);
  });
});
