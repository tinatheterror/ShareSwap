import { describe, expect, it } from "vitest";
import { REQUEST_DATES_PASSED_MESSAGE, acceptBlockedByDates } from "./request-dates";

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
      "These dates have passed. Counter with new dates or decline.",
    );
  });
});
