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
