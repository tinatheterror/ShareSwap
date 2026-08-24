import assert from "node:assert/strict";
import test from "node:test";
import {
  daysOverdueAgainstDueDate,
  isBorrowingRestricted,
  isSeriousOverdue,
  overdueLevel,
} from "./overdue-policy.js";

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

test("overdue thresholds use calendar days", () => {
  const now = date("2026-08-24");
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-24")), 0);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-23")), 1);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-17")), 7);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-09")), 15);
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
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-17")), 7);
  assert.equal(daysOverdueAgainstDueDate(now, date("2026-08-20")), 4);
});

test("calendar thresholds are not delayed by a daylight-saving transition", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "America/Vancouver";
  try {
    const dueDate = new Date(2026, 2, 8, 12);
    const sevenDaysLater = new Date(2026, 2, 15, 12);
    assert.equal(daysOverdueAgainstDueDate(sevenDaysLater, dueDate), 7);
  } finally {
    process.env.TZ = previousTimeZone;
  }
});