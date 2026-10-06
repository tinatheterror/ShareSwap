import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PLATFORM_TIME_ZONE,
  PLATFORM_TIME_ZONE,
  calendarDayInZone,
  computeHandoffCutoff,
  endOfCalendarDayInZone,
  formatHandoffCutoff,
  formatHandoffCutoffSentence,
  isStartDatePassed,
  requestCalendarDay,
  resolveTimeZone,
  validateStartDateNotPast,
} from "./request-dates.js";

const VAN = "America/Vancouver";

test("the default platform time zone is America/Vancouver", () => {
  assert.equal(DEFAULT_PLATFORM_TIME_ZONE, "America/Vancouver");
  assert.equal(resolveTimeZone(undefined), "America/Vancouver");
  if (!process.env.PLATFORM_TIME_ZONE) {
    assert.equal(PLATFORM_TIME_ZONE, "America/Vancouver");
    // Without an explicit zone argument the default is used: Oct 4, 23:59:59 PDT.
    assert.equal(isStartDatePassed("2026-10-04", new Date("2026-10-05T06:59:59Z")), false);
    assert.equal(isStartDatePassed("2026-10-04", new Date("2026-10-05T07:00:00Z")), true);
  }
});

test("calendarDayInZone follows the zone, not UTC", () => {
  // 23:59:59 PDT on Oct 4 is already Oct 5 in UTC.
  assert.equal(calendarDayInZone(new Date("2026-10-05T06:59:59Z"), VAN), "2026-10-04");
  assert.equal(calendarDayInZone(new Date("2026-10-05T07:00:00Z"), VAN), "2026-10-05");
});

test("a request on its own start day stays acceptable until that day ends in the platform zone", () => {
  // Oct 4, 20:30 PDT. UTC already says Oct 5, so a UTC comparison would wrongly reject.
  const eveningBeforeUtcMidnight = new Date("2026-10-05T03:30:00Z");
  assert.equal(isStartDatePassed("2026-10-04", eveningBeforeUtcMidnight, VAN), false);

  // Last second of Oct 4 in Vancouver.
  assert.equal(isStartDatePassed("2026-10-04", new Date("2026-10-05T06:59:59Z"), VAN), false);
  // First second of Oct 5 in Vancouver: Oct 4 has passed, Oct 5 has not.
  assert.equal(isStartDatePassed("2026-10-04", new Date("2026-10-05T07:00:00Z"), VAN), true);
  assert.equal(isStartDatePassed("2026-10-05", new Date("2026-10-05T07:00:00Z"), VAN), false);
});

test("stored UTC-midnight dates keep their calendar day regardless of the zone offset", () => {
  const stored = new Date("2026-10-05T00:00:00.000Z");
  assert.equal(requestCalendarDay(stored), "2026-10-05");
  // Oct 4, 21:00 PDT: the stored Oct 5 start has not passed.
  assert.equal(isStartDatePassed(stored, new Date("2026-10-05T04:00:00Z"), VAN), false);
  // Oct 5, 00:00 PDT: still its own start day.
  assert.equal(isStartDatePassed(stored, new Date("2026-10-05T07:00:00Z"), VAN), false);
  // Oct 6, 00:00 PDT: passed.
  assert.equal(isStartDatePassed(stored, new Date("2026-10-06T07:00:00Z"), VAN), true);
});

test("fall-back DST day boundary is local midnight, not a fixed UTC offset", () => {
  // Clocks fall back on 2026-11-01; midnight on Nov 2 is 08:00Z (PST, UTC-8).
  assert.equal(calendarDayInZone(new Date("2026-11-02T07:59:59Z"), VAN), "2026-11-01");
  assert.equal(calendarDayInZone(new Date("2026-11-02T08:00:00Z"), VAN), "2026-11-02");
  assert.equal(isStartDatePassed("2026-11-01", new Date("2026-11-02T07:59:59Z"), VAN), false);
  assert.equal(isStartDatePassed("2026-11-01", new Date("2026-11-02T08:00:00Z"), VAN), true);
});

test("spring-forward DST day boundary is local midnight", () => {
  // Clocks spring forward on 2027-03-14; midnight on Mar 15 is 07:00Z (PDT, UTC-7).
  assert.equal(isStartDatePassed("2027-03-14", new Date("2027-03-15T06:59:59Z"), VAN), false);
  assert.equal(isStartDatePassed("2027-03-14", new Date("2027-03-15T07:00:00Z"), VAN), true);
});

test("the same instant can fall on different days in different zones", () => {
  const instant = new Date("2026-10-05T10:00:00Z");
  assert.equal(calendarDayInZone(instant, VAN), "2026-10-05");
  assert.equal(calendarDayInZone(instant, "Pacific/Auckland"), "2026-10-05");
  assert.equal(calendarDayInZone(new Date("2026-10-05T14:00:00Z"), "Pacific/Auckland"), "2026-10-06");
  assert.equal(isStartDatePassed("2026-10-05", new Date("2026-10-05T14:00:00Z"), "Pacific/Auckland"), true);
  assert.equal(isStartDatePassed("2026-10-05", new Date("2026-10-05T14:00:00Z"), VAN), false);
});

test("missing or unparseable start dates are never treated as passed", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  for (const value of [null, undefined, "", "not-a-date", "2026-02-30", 12345, {}]) {
    assert.equal(isStartDatePassed(value, now, VAN), false, String(value));
  }
  assert.equal(requestCalendarDay("2026-02-30"), null);
  assert.equal(requestCalendarDay("not-a-date"), null);
});

test("full timestamps use their UTC day, matching how date-only values are stored", () => {
  assert.equal(requestCalendarDay("2026-10-05T00:00:00.000Z"), "2026-10-05");
  assert.equal(requestCalendarDay(new Date("2026-10-05T23:59:59.999Z")), "2026-10-05");
});

test("validateStartDateNotPast accepts today and later, rejects earlier days", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  assert.deepEqual(validateStartDateNotPast("2026-10-05", now, VAN), { valid: true });
  assert.deepEqual(validateStartDateNotPast("2026-10-06", now, VAN), { valid: true });
  assert.deepEqual(validateStartDateNotPast(undefined, now, VAN), { valid: true });

  const rejected = validateStartDateNotPast("2026-10-04", now, VAN);
  assert.equal(rejected.valid, false);
  if (!rejected.valid) {
    assert.equal(rejected.code, "START_DATE_IN_PAST");
    assert.match(rejected.error, /today or later/);
  }
});

test("invalid PLATFORM_TIME_ZONE values fall back to the default", () => {
  assert.equal(resolveTimeZone(undefined), DEFAULT_PLATFORM_TIME_ZONE);
  assert.equal(resolveTimeZone(""), DEFAULT_PLATFORM_TIME_ZONE);
  assert.equal(resolveTimeZone("Not/AZone"), DEFAULT_PLATFORM_TIME_ZONE);
  assert.equal(resolveTimeZone("Europe/London"), "Europe/London");
});

// ── Handoff cutoff ───────────────────────────────────────────────────────────

const iso = (date: Date | null) => date?.toISOString() ?? null;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

test("end of a calendar day is 23:59:59 in the platform zone", () => {
  assert.equal(iso(endOfCalendarDayInZone("2026-10-05", VAN)), "2026-10-06T06:59:59.000Z"); // PDT
  assert.equal(iso(endOfCalendarDayInZone("2026-12-05", VAN)), "2026-12-06T07:59:59.000Z"); // PST
  assert.equal(iso(endOfCalendarDayInZone("2026-10-05", "UTC")), "2026-10-05T23:59:59.000Z");
});

test("end of day is still 23:59:59 local on the days the clocks change", () => {
  assert.equal(iso(endOfCalendarDayInZone("2026-03-08", VAN)), "2026-03-09T06:59:59.000Z"); // spring forward
  assert.equal(iso(endOfCalendarDayInZone("2026-11-01", VAN)), "2026-11-02T07:59:59.000Z"); // fall back
});

test("an Oct 2–5 request must be handed off by Oct 4 at 11:59 PM", () => {
  const cutoff = computeHandoffCutoff(day("2026-10-02"), day("2026-10-05"), VAN)!;
  assert.equal(iso(cutoff), "2026-10-05T06:59:59.000Z");
  assert.equal(formatHandoffCutoff(cutoff, VAN), "Oct 4, 11:59 PM");
  assert.equal(formatHandoffCutoffSentence(cutoff, VAN), "Oct 4 at 11:59 PM");
  // Oct 4 is the last day to hand off; Oct 5 is too late.
  assert.equal(calendarDayInZone(cutoff, VAN), "2026-10-04");
});

test("the cutoff is the later of end − 24h and the end of the start day", () => {
  // One-day request: end − 24h would be the start day's end, so no zero-or-negative window.
  assert.equal(iso(computeHandoffCutoff(day("2026-10-02"), day("2026-10-03"), VAN)), "2026-10-03T06:59:59.000Z");
  // Same-day request: end − 24h is before the start, so the end of the start day wins.
  assert.equal(iso(computeHandoffCutoff(day("2026-10-02"), day("2026-10-02"), VAN)), "2026-10-03T06:59:59.000Z");
  // A malformed end before the start never yields a cutoff before the request begins.
  assert.equal(iso(computeHandoffCutoff(day("2026-10-02"), day("2026-09-20"), VAN)), "2026-10-03T06:59:59.000Z");
});

test("the cutoff reads 11:59 PM across a DST change instead of drifting an hour", () => {
  // Fall back is Nov 1 2026; the night before the Nov 2 end is Nov 1, 11:59 PM PST.
  const cutoff = computeHandoffCutoff(day("2026-10-30"), day("2026-11-02"), VAN)!;
  assert.equal(formatHandoffCutoff(cutoff, VAN), "Nov 1, 11:59 PM");
  const spring = computeHandoffCutoff(day("2026-03-07"), day("2026-03-09"), VAN)!;
  assert.equal(formatHandoffCutoff(spring, VAN), "Mar 8, 11:59 PM");
});

test("requests without usable dates have no cutoff", () => {
  assert.equal(computeHandoffCutoff(null, day("2026-10-05"), VAN), null);
  assert.equal(computeHandoffCutoff(day("2026-10-02"), undefined, VAN), null);
  assert.equal(computeHandoffCutoff("not a date", "also not", VAN), null);
});

test("date-only strings and stored UTC-midnight timestamps give the same cutoff", () => {
  assert.equal(
    iso(computeHandoffCutoff("2026-10-02", "2026-10-05", VAN)),
    iso(computeHandoffCutoff(day("2026-10-02"), day("2026-10-05"), VAN)),
  );
});
