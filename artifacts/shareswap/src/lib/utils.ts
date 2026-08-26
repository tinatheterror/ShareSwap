import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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
