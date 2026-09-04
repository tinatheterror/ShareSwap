/** Central platform defaults. Callers may overlay an item/category policy. */
export const OVERDUE_POLICY = {
  graceHours: 24,
  overdueHours: 72,
  seriousOverdueHours: 7 * 24,
  nonReturnReviewHours: 15 * 24,
  borrowerResponseHours: 72,
  claimDecisionBufferHours: 72,
  CAPTURE_OPERATION_SAFETY_BUFFER_MINUTES: 15,
  maxExtensionDays: 3,
  BORROW_RESTRICTION_DAYS: 7,
  SERIOUS_OVERDUE_DAYS: 15,
} as const;

export type OverdueStage =
  | "ACTIVE" | "RETURN_DUE" | "OVERDUE_GRACE" | "OVERDUE"
  | "SERIOUSLY_OVERDUE" | "NON_RETURN_REVIEW" | "RETURNED_PENDING_REVIEW";

export type OverduePolicyInput = {
  requestType?: string | null; durationDays?: number; category?: string | null;
  itemValue?: number; overrides?: Partial<typeof OVERDUE_POLICY>;
};

export function policyFor(input: OverduePolicyInput = {}) {
  // Short, high-value rentals get earlier human review, not earlier capture.
  const highValue = (input.itemValue || 0) >= 1000;
  const shortRental = input.requestType === "RENT" && (input.durationDays || 0) <= 2;
  return { ...OVERDUE_POLICY, ...(highValue || shortRental ? { seriousOverdueHours: 5 * 24 } : {}), ...input.overrides };
}

export function overdueStageAt(deadline: Date | null | undefined, now: Date, input?: OverduePolicyInput): OverdueStage {
  if (!deadline || now < deadline) return "ACTIVE";
  const hours = (now.getTime() - deadline.getTime()) / 3_600_000;
  const p = policyFor(input);
  if (hours >= p.nonReturnReviewHours) return "NON_RETURN_REVIEW";
  if (hours >= p.seriousOverdueHours) return "SERIOUSLY_OVERDUE";
  if (hours >= p.overdueHours) return "OVERDUE";
  if (hours >= p.graceHours) return "OVERDUE_GRACE";
  return "RETURN_DUE";
}

export type OverdueLevel = "on_time" | "overdue" | "restricted" | "serious";
function calendarDayOrdinal(value: Date) { return Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000); }
export function daysOverdueAgainstDueDate(now: Date, dueDate: Date | null | undefined) {
  return dueDate ? Math.max(0, calendarDayOrdinal(now) - calendarDayOrdinal(dueDate)) : 0;
}
export function overdueLevel(days: number): OverdueLevel {
  return days >= OVERDUE_POLICY.SERIOUS_OVERDUE_DAYS ? "serious" : days >= OVERDUE_POLICY.BORROW_RESTRICTION_DAYS ? "restricted" : days > 0 ? "overdue" : "on_time";
}
export const isBorrowingRestricted = (days: number) => days >= OVERDUE_POLICY.BORROW_RESTRICTION_DAYS;
export const isSeriousOverdue = (days: number) => days >= OVERDUE_POLICY.SERIOUS_OVERDUE_DAYS;