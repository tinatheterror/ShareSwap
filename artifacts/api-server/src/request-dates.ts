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

/**
 * The time zone a request's calendar dates (start, end, extended end, handoff
 * deadline) are read in. This is the ONLY place that picks it; nothing else may
 * name a zone. It is the platform zone (America/Vancouver) for now; it will
 * come from the item's region when we expand beyond one.
 */
export function timezoneForRequest(_request?: unknown): string {
  return PLATFORM_TIME_ZONE;
}

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

// ── Handoff cutoff ───────────────────────────────────────────────────────────
//
// A BORROW/RENT request is only fulfillable until its late-handoff cutoff:
// the later of (end − 24h) and the end of the start day. The "end" of a request
// is 23:59:59.999 on its end calendar day in the platform zone, so for Oct 2–5 the
// cutoff is Oct 4 23:59:59 and for a one-day request it is the end of the start
// day (never before the request even begins). "End of day" is endOfLocalDay.

const SECOND_MS = 1_000;
const DAY_MS = 86_400_000;

/** Milliseconds the zone's wall clock is ahead of UTC at the given instant. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const part = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wallAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallAsUtc - Math.floor(instantMs / SECOND_MS) * SECOND_MS;
}

/**
 * The last instant (23:59:59.999 local time, DST handled) of the calendar day a
 * date stands for, in the given zone, or null when the date is missing or
 * unparseable. A date-only value ("2026-10-19", or its stored UTC-midnight
 * timestamp) means that whole day: it ends at local midnight, not at UTC
 * midnight (which is 5 PM the evening before in Vancouver).
 */
export function endOfLocalDay(date: unknown, timeZone: string): Date | null {
  const day = requestCalendarDay(date);
  if (!day) return null;
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, dayOfMonth, 23, 59, 59, 999);
  // Two passes settle the offset when the day contains a DST change.
  let instant = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  instant = wallAsUtc - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

function dayOrdinal(day: string): number {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, dayOfMonth) / DAY_MS;
}

/** The calendar day n days after (negative: before) a YYYY-MM-DD day. */
export function addCalendarDays(day: string, n: number): string {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, dayOfMonth + n)).toISOString().slice(0, 10);
}

/**
 * Whole calendar days from today to a date, both read as calendar days in the
 * given zone (negative once it has passed); null when the date is unusable.
 * Never counts 24-hour blocks.
 */
export function calendarDaysUntil(date: unknown, now: Date, timeZone: string): number | null {
  const day = requestCalendarDay(date);
  if (!day) return null;
  return dayOrdinal(day) - dayOrdinal(calendarDayInZone(now, timeZone));
}

/** Calendar days past a due date; 0 on or before the due day (see calendarDaysUntil). */
export function calendarDaysLate(dueDate: unknown, now: Date, timeZone: string): number {
  return Math.max(0, -(calendarDaysUntil(dueDate, now, timeZone) ?? 0));
}

/** The first instant (00:00:00.000 local time) of the calendar day a date stands for, or null. */
export function startOfLocalDay(date: unknown, timeZone: string): Date | null {
  const day = requestCalendarDay(date);
  if (!day) return null;
  return new Date(endOfLocalDay(addCalendarDays(day, -1), timeZone)!.getTime() + 1);
}

/** The calendar day a request's return is due: the extended date once one was accepted. */
export function returnDueDay(request: { returnDeadlineAt?: unknown; endDate?: unknown }): string | null {
  return requestCalendarDay(request.returnDeadlineAt) ?? requestCalendarDay(request.endDate);
}

/** True when the request's start day (the counter-proposed one if there is one) is still ahead of today in its zone. */
export function isStartDateUpcoming(
  request: { startDate?: unknown; counterStartDate?: unknown },
  now: Date,
): boolean {
  const until = calendarDaysUntil(request.counterStartDate || request.startDate, now, timezoneForRequest(request));
  return until !== null && until > 0;
}

export interface ReturnTiming {
  /** The return came (or, if it has not happened yet, now is) after the due day ended. */
  isOverdue: boolean;
  /** The return came (or now is) before the due day began. The due day itself is on time, not early. */
  isEarlyReturn: boolean;
  /** Calendar days past the due day. */
  daysLate: number;
}

/**
 * The date-based flags clients show, all read in the request's zone. They are measured at the actual
 * return when there is one, otherwise at `now`, so a returned request keeps saying whether it was late.
 * Apps display these; they never compare dates against the viewer's own today.
 */
export function returnTiming(
  request: { returnDeadlineAt?: unknown; endDate?: unknown; actualReturnAt?: unknown },
  now: Date,
): ReturnTiming {
  const timeZone = timezoneForRequest(request);
  const dueDay = returnDueDay(request);
  const returnedAt = request.actualReturnAt ? new Date(request.actualReturnAt as string | Date) : null;
  const at = returnedAt && !Number.isNaN(returnedAt.getTime()) ? returnedAt : now;
  const endOfDueDay = endOfLocalDay(dueDay, timeZone);
  const startOfDueDay = startOfLocalDay(dueDay, timeZone);
  return {
    isOverdue: endOfDueDay ? at.getTime() > endOfDueDay.getTime() : false,
    isEarlyReturn: startOfDueDay ? at.getTime() < startOfDueDay.getTime() : false,
    daysLate: calendarDaysLate(dueDay, at, timeZone),
  };
}

/** The instant a request's return deadline passes: the end of its due day in the request's zone. */
export function returnDeadlineInstant(request: { returnDeadlineAt?: unknown; endDate?: unknown }): Date | null {
  return endOfLocalDay(returnDueDay(request), timezoneForRequest(request));
}

const previousCalendarDay = (day: string) => addCalendarDays(day, -1);

/**
 * The last instant a request can still be handed off, or null when its dates
 * are missing/unparseable (such requests never expire on a schedule).
 *
 * "end − 24h" is taken as the end of the previous calendar day rather than a
 * raw 24 hours, so it reads "11:59 PM" even across a DST change.
 */
export function computeHandoffCutoff(
  startValue: unknown,
  endValue: unknown,
  timeZone: string = PLATFORM_TIME_ZONE,
): Date | null {
  const startDay = requestCalendarDay(startValue);
  const endDay = requestCalendarDay(endValue);
  if (!startDay || !endDay) return null;
  const lastDayOfWindow = endDay < startDay ? startDay : endDay;
  const endMinus24h = endOfLocalDay(previousCalendarDay(lastDayOfWindow), timeZone)!;
  const endOfStartDay = endOfLocalDay(startDay, timeZone)!;
  return endMinus24h.getTime() > endOfStartDay.getTime() ? endMinus24h : endOfStartDay;
}

/** "Oct 4, 11:59 PM" — the cutoff as shown to people, in the platform zone. */
export function formatHandoffCutoff(
  cutoff: Date,
  timeZone: string = PLATFORM_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(cutoff);
}

/** "Oct 4 at 11:59 PM" — for sentences like "This request expired Oct 4 at 11:59 PM". */
export function formatHandoffCutoffSentence(
  cutoff: Date,
  timeZone: string = PLATFORM_TIME_ZONE,
): string {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(cutoff);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(cutoff);
  return `${day} at ${time}`;
}
