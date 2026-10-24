import { expect, test } from "vitest";
import { addCalendarDays, formatCalendarDate, isCalendarDayPast, parseCalendarDay } from "./utils";

// The server sends date-only booking dates as UTC-midnight timestamps. Whatever zone the
// viewer is in, the calendar day written in them must be the day shown.
const STORED = "2026-10-19T00:00:00.000Z";

test("a stored UTC-midnight date shows its own calendar day, not the day before", () => {
  expect(formatCalendarDate(STORED, "MMM d")).toBe("Oct 19");
  expect(formatCalendarDate("2026-10-19", "MMM d, yyyy")).toBe("Oct 19, 2026");
  expect(formatCalendarDate(new Date(STORED), "MMM d")).toBe("Oct 19");
});

test("missing or malformed dates show a dash", () => {
  expect(formatCalendarDate(null, "MMM d")).toBe("–");
  expect(formatCalendarDate("soon", "MMM d")).toBe("–");
  expect(parseCalendarDay(undefined)).toBe(null);
});

test("adding days moves the calendar day, across the Nov 1 clock change too", () => {
  expect(formatCalendarDate(addCalendarDays("2026-10-30T00:00:00.000Z", 3), "yyyy-MM-dd")).toBe("2026-11-02");
  expect(formatCalendarDate(addCalendarDays("2026-03-07T00:00:00.000Z", 2), "yyyy-MM-dd")).toBe("2026-03-09");
});

test("the due day itself is not past; the next day is", () => {
  expect(isCalendarDayPast(STORED, new Date(2026, 9, 19, 23, 59))).toBe(false);
  expect(isCalendarDayPast(STORED, new Date(2026, 9, 20, 0, 1))).toBe(true);
});
