export const OVERDUE_POLICY = {
  BORROW_RESTRICTION_DAYS: 7,
  SERIOUS_OVERDUE_DAYS: 15,
} as const;

export type OverdueLevel = "on_time" | "overdue" | "restricted" | "serious";

function calendarDayOrdinal(value: Date): number {
  // Date-only borrowing deadlines must not lose a day when local midnight is
  // 23 or 25 hours apart during a daylight-saving transition.
  return Math.floor(
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) /
      (24 * 60 * 60 * 1000),
  );
}

/**
 * Count overdue calendar days against the active due date.
 *
 * The app's return dates are date-based rather than time-of-day deadlines,
 * so a due date of August 20 is four days overdue on August 24 regardless
 * of the current clock time.
 */
export function daysOverdueAgainstDueDate(
  now: Date,
  dueDate: Date | null | undefined,
): number {
  if (!dueDate) return 0;

  return Math.max(0, calendarDayOrdinal(now) - calendarDayOrdinal(dueDate));
}

export function overdueLevel(daysOverdue: number): OverdueLevel {
  if (daysOverdue >= OVERDUE_POLICY.SERIOUS_OVERDUE_DAYS) return "serious";
  if (daysOverdue >= OVERDUE_POLICY.BORROW_RESTRICTION_DAYS) return "restricted";
  if (daysOverdue > 0) return "overdue";
  return "on_time";
}

export function isBorrowingRestricted(daysOverdue: number): boolean {
  return daysOverdue >= OVERDUE_POLICY.BORROW_RESTRICTION_DAYS;
}

export function isSeriousOverdue(daysOverdue: number): boolean {
  return daysOverdue >= OVERDUE_POLICY.SERIOUS_OVERDUE_DAYS;
}