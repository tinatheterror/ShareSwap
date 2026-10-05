// Calendar-date rules for request start dates.
//
// Request dates are calendar days ("2026-10-05"), stored as UTC-midnight
// timestamps. They are compared with "today" as a calendar day in ONE fixed
// platform time zone, never as raw UTC instants. That keeps a request on its
// own start day acceptable until that day ends in the platform zone, instead
// of expiring at UTC midnight (which falls in the evening of the previous day
// for the Americas).

export const DEFAULT_PLATFORM_TIME_ZONE = "America/Vancouver";

export const REQUEST_DATES_PASSED_MESSAGE =
  "These dates have passed. Counter with new dates or decline.";

export function resolveTimeZone(candidate: string | undefined): string {
  if (!candidate) return DEFAULT_PLATFORM_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    console.warn(
      `[request-dates] Ignoring invalid PLATFORM_TIME_ZONE "${candidate}"; using ${DEFAULT_PLATFORM_TIME_ZONE}`,
    );
    return DEFAULT_PLATFORM_TIME_ZONE;
  }
}

export const PLATFORM_TIME_ZONE = resolveTimeZone(process.env.PLATFORM_TIME_ZONE);

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar day (YYYY-MM-DD) in the given zone. */
export function calendarDayInZone(
  now: Date,
  timeZone: string = PLATFORM_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The calendar day a stored or submitted request date stands for, or null when
 * it is missing or unparseable. Date-only strings are taken as written; Date
 * values and full timestamps use their UTC day, which is how date-only values
 * are stored (`new Date("2026-10-05")` is UTC midnight).
 */
export function requestCalendarDay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "string" && DATE_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    const real =
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day;
    return real ? value : null;
  }

  if (typeof value === "string" || value instanceof Date) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  return null;
}

/** True when the start day is before today's calendar day in the platform zone. */
export function isStartDatePassed(
  startValue: unknown,
  now: Date = new Date(),
  timeZone: string = PLATFORM_TIME_ZONE,
): boolean {
  const startDay = requestCalendarDay(startValue);
  if (!startDay) return false;
  // YYYY-MM-DD strings order lexicographically the same as chronologically.
  return startDay < calendarDayInZone(now, timeZone);
}

export type StartDateValidation =
  | { valid: true }
  | { valid: false; code: "START_DATE_IN_PAST"; error: string };

/** Creation and counter-proposal check; a missing start date is not an error. */
export function validateStartDateNotPast(
  startValue: unknown,
  now: Date = new Date(),
  timeZone: string = PLATFORM_TIME_ZONE,
): StartDateValidation {
  if (isStartDatePassed(startValue, now, timeZone)) {
    return {
      valid: false,
      code: "START_DATE_IN_PAST",
      error: "Choose a start date of today or later.",
    };
  }
  return { valid: true };
}
