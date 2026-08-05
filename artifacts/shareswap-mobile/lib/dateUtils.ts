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
