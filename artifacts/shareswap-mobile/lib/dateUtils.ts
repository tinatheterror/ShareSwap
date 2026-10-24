/**
 * Normalize a date string to a parseable format on all platforms.
 * iOS JavaScriptCore rejects bare "YYYY-MM-DD" when passed to new Date()
 * directly (it may parse as UTC midnight and cause off-by-one day issues or
 * return Invalid Date). Full ISO timestamps are passed through unchanged.
 */
export function safeDate(d: string): Date {
  const normalized = d.includes("T") ? d : `${d}T00:00:00`;
  return new Date(normalized);
}

/**
 * Format a date-only value as the calendar day the user selected.
 * PostgreSQL serializes date-only booking fields as midnight UTC timestamps;
 * parsing those as an instant can shift the visible day in timezones west of UTC.
 */
export function fmtCalendarDate(
  d: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  if (!d) return "–";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!match) return "–";
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (isNaN(parsed.getTime())) return "–";
  return parsed.toLocaleDateString("en-US", options);
}

/**
 * Format a calendar date range. Collapses the end to just the day when both
 * dates fall in the same month and year ("Jun 7–11").
 */
export function fmtCalendarRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = start ? /^(\d{4})-(\d{2})-(\d{2})/.exec(start) : null;
  const e = end ? /^(\d{4})-(\d{2})-(\d{2})/.exec(end) : null;
  if (s && e && s[1] === e[1] && s[2] === e[2]) {
    return `${fmtCalendarDate(start)}–${Number(e[3])}`;
  }
  return `${fmtCalendarDate(start)} – ${fmtCalendarDate(end)}`;
}

/**
 * Format a nullable date string for display. Returns "–" for null/undefined/invalid.
 * Handles both "YYYY-MM-DD" and full ISO timestamp inputs safely on iOS.
 */
export function fmtDate(
  d: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  if (!d) return "–";
  const parsed = safeDate(d);
  if (isNaN(parsed.getTime())) return "–";
  return parsed.toLocaleDateString("en-US", options);
}

/**
 * Format a score history timestamp as its UTC calendar day.
 * Score history uses the date the activity was recorded, rather than shifting
 * that day into the member's local timezone. Returns "–" for missing/invalid
 * values so malformed API data is never shown as a misleading date.
 */
export function fmtScoreHistoryDate(d: string | null | undefined): string {
  if (!d) return "–";

  // Keep date-only values stable on runtimes where bare ISO dates are parsed
  // inconsistently, while full timestamps retain their recorded instant.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(`${d}T00:00:00.000Z`)
    : safeDate(d);
  if (isNaN(parsed.getTime())) return "–";

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format a timestamp string for inbox/activity feed display.
 * Shows time (HH:MM) if the date is today, otherwise shows "Mon DD".
 * Returns "–" for null/undefined/invalid inputs.
 */
export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "–";
  const d = safeDate(dateStr);
  if (isNaN(d.getTime())) return "–";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
