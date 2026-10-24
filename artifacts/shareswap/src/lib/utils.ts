import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { format } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDisplayName(username: string | null | undefined): string {
  if (!username) return "Anonymous";

  // If it looks like an email, only use the part before @
  const base = username.includes('@') ? username.split('@')[0] : username;

  const name = base
    .replace(/[._-]/g, ' ')
    .split(' ')
    .filter(p => p.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

  return name || "Anonymous";
}

/**
 * Formats a timestamp using its UTC calendar day (e.g. "Jun 15, 2025"),
 * regardless of the viewer's local timezone. Score/reputation activity is
 * recorded against a specific UTC day and must show the same date on every
 * client, even for events near a UTC day boundary.
 *
 * Returns an en dash ("–") for missing or invalid timestamps instead of an
 * invalid or misleading date.
 */
export function formatUtcCalendarDate(dateString: string | null | undefined): string {
  if (!dateString) return "–";

  const parsedDate = new Date(dateString);
  if (Number.isNaN(parsedDate.getTime())) return "–";

  return parsedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Booking and return dates are calendar days. The server stores them as
 * UTC-midnight timestamps ("2026-10-19T00:00:00.000Z"), so reading one as an
 * instant shows the day before in the Americas. These helpers read the
 * calendar day as written (the leading YYYY-MM-DD) and never shift it.
 */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})/;

/** The calendar day as a local-midnight Date (safe to pass to date-fns format), or null. */
export function parseCalendarDay(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const text = typeof value === "string" ? value : value.toISOString();
  const match = CALENDAR_DAY.exec(text);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formats a calendar day with a date-fns pattern; "–" when missing or invalid. */
export function formatCalendarDate(
  value: string | Date | null | undefined,
  pattern: string,
): string {
  const day = parseCalendarDay(value);
  return day ? format(day, pattern) : "–";
}

/** The calendar day n days later (negative: earlier), as a local-midnight Date. */
export function addCalendarDays(value: string | Date | null | undefined, n: number): Date | null {
  const day = parseCalendarDay(value);
  if (!day) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
}

/** True once the viewer's today is after the given calendar day (the due day itself is not past). */
export function isCalendarDayPast(value: string | Date | null | undefined, now: Date = new Date()): boolean {
  const day = parseCalendarDay(value);
  if (!day) return false;
  return day < new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
