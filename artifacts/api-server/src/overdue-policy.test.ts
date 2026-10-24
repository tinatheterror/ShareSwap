import assert from "node:assert/strict";
import test from "node:test";
import {
  daysOverdueAgainstDueDate,
  isBorrowingRestricted,
  claimAllowedAtStage,
  isSeriousOverdue,
  overdueStageAt,
  overdueLevel,
} from "./overdue-policy.js";
import { returnDeadlineInstant, timezoneForRequest } from "./request-dates.js";

const ZONE = timezoneForRequest();

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

test("overdue thresholds use calendar days", () => {
  const now = date("2026-08-24");
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-24"), ZONE), 0);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-23"), ZONE), 1);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-17"), ZONE), 7);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-09"), ZONE), 15);
});

test("7 days restricts new borrowing and 15 days is serious", () => {
  assert.equal(overdueLevel(6), "overdue");
  assert.equal(overdueLevel(7), "restricted");
  assert.equal(overdueLevel(14), "restricted");
  assert.equal(overdueLevel(15), "serious");
  assert.equal(isBorrowingRestricted(6), false);
  assert.equal(isBorrowingRestricted(7), true);
  assert.equal(isSeriousOverdue(14), false);
  assert.equal(isSeriousOverdue(15), true);
});

test("an accepted extension becomes the due date for the thresholds", () => {
  const now = date("2026-08-24");
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-17"), ZONE), 7);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-20"), ZONE), 4);
});

test("calendar thresholds are not delayed by a daylight-saving transition", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "America/Vancouver";
  try {
    const dueDate = new Date(2026, 2, 8, 12);
    const sevenDaysLater = new Date(2026, 2, 15, 12);
    assert.equal(daysOverdueAgainstDueDate(sevenDaysLater, dueDate, ZONE), 7);
  } finally {
    process.env.TZ = previousTimeZone;
  }
});
test("claims open from 24 hours overdue (overdue grace) onward", () => {
  const deadline = new Date("2026-08-01T12:00:00.000Z");
  const at = (hours: number) => overdueStageAt(deadline, new Date(deadline.getTime() + hours * 3_600_000));
  assert.equal(at(23), "RETURN_DUE");
  assert.equal(at(24), "OVERDUE_GRACE");
  for (const claimType of ["non_return", "lost", "damage", "missing_parts"]) {
    assert.equal(claimAllowedAtStage(claimType, at(23)), false, `${claimType} blocked before 24h`);
    for (const hours of [24, 72, 7 * 24, 15 * 24]) {
      assert.equal(claimAllowedAtStage(claimType, at(hours)), true, `${claimType} allowed at ${hours}h`);
    }
  }
});

test("non-return claims are not allowed before the item is overdue or after return", () => {
  for (const stage of ["ACTIVE", "RETURN_DUE", "RETURNED_PENDING_REVIEW", null]) {
    assert.equal(claimAllowedAtStage("non_return", stage), false);
  }
  assert.equal(claimAllowedAtStage("damage", "RETURNED_PENDING_REVIEW"), true);
});

test("a claim is not allowed at 6 PM Vancouver time on the due date", () => {
  const request = { endDate: new Date("2026-10-19T00:00:00.000Z") }; // stored date-only: Oct 19
  const deadline = returnDeadlineInstant(request)!;
  const sixPmOnDueDay = new Date("2026-10-20T01:00:00.000Z"); // Oct 19, 6:00 PM PDT
  for (const claimType of ["non_return", "lost", "damage", "missing_parts"]) {
    assert.equal(claimAllowedAtStage(claimType, overdueStageAt(deadline, sixPmOnDueDay)), false, `${claimType} at 6 PM on the due day`);
  }
  // Not even at the end of the due day, nor 23h59m after it; the 24th hour opens claims.
  assert.equal(overdueStageAt(deadline, new Date(deadline.getTime() - 1)), "ACTIVE");
  assert.equal(claimAllowedAtStage("non_return", overdueStageAt(deadline, new Date(deadline.getTime() + 23 * 3_600_000))), false);
  assert.equal(claimAllowedAtStage("non_return", overdueStageAt(deadline, new Date(deadline.getTime() + 24 * 3_600_000))), true);
});

test("the 24-hour claim window counts from the end of the due day across the Nov 1 clock change", () => {
  const deadline = returnDeadlineInstant({ endDate: new Date("2026-10-31T00:00:00.000Z") })!;
  assert.equal(deadline.toISOString(), "2026-11-01T06:59:59.999Z");
  const at = (hours: number) => overdueStageAt(deadline, new Date(deadline.getTime() + hours * 3_600_000));
  assert.equal(at(23), "RETURN_DUE");
  assert.equal(at(24), "OVERDUE_GRACE");
});
