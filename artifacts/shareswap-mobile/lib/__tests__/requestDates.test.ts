import { REQUEST_DATES_PASSED_MESSAGE, REQUEST_NOT_ACCEPTABLE_NOW_CODE, REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE, acceptBlockedByDates } from "../requestDates";

describe("acceptBlockedByDates", () => {
  it("blocks Accept only for PENDING requests whose start day the API says has passed", () => {
    expect(acceptBlockedByDates({ status: "PENDING", startDatePassed: true })).toBe(true);
    expect(acceptBlockedByDates({ status: "PENDING", startDatePassed: false })).toBe(false);
  });

  it("does not block when the API did not send the flag (older cached payloads)", () => {
    expect(acceptBlockedByDates({ status: "PENDING" })).toBe(false);
  });

  it("ignores requests that are no longer pending", () => {
    for (const status of ["ACCEPTED", "DEPOSIT_CONFIRMED", "IN_PROGRESS", "DECLINED", "CANCELLED"]) {
      expect(acceptBlockedByDates({ status, startDatePassed: true })).toBe(false);
    }
  });

  it("uses the exact guidance copy", () => {
    expect(REQUEST_DATES_PASSED_MESSAGE).toBe(
      "Dates have passed. Counter with new dates or decline.",
    );
  });
});

describe("the answer when a request cannot be accepted right now", () => {
  it("is the server's own wording, with no amount, role or reason in it", () => {
    expect(REQUEST_NOT_ACCEPTABLE_NOW_CODE).toBe("REQUEST_NOT_ACCEPTABLE_NOW");
    expect(REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE).toBe("This can't be accepted right now. Please try again later.");
    expect(REQUEST_NOT_ACCEPTABLE_NOW_MESSAGE).not.toMatch(/ShareCoin|requester|borrower|payer|balance|\d/i);
  });
});
