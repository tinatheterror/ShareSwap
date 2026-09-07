const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
    ));
  }
  if (typeof value !== "string" || !DATE_ONLY_PATTERN.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export type BorrowPeriodValidation =
  | { valid: true; start: Date; end: Date }
  | { valid: false; code: "INVALID_BORROW_DATES" | "BORROW_PERIOD_TOO_LONG"; error: string };

export function validateBorrowPeriod(startValue: unknown, endValue: unknown): BorrowPeriodValidation {
  const start = parseDateOnly(startValue);
  const end = parseDateOnly(endValue);
  if (!start || !end || end < start) {
    return {
      valid: false,
      code: "INVALID_BORROW_DATES",
      error: "Choose a valid return date on or after the start date.",
    };
  }

  const maximumEnd = new Date(start);
  maximumEnd.setUTCFullYear(maximumEnd.getUTCFullYear() + 1);
  if (end > maximumEnd) {
    return {
      valid: false,
      code: "BORROW_PERIOD_TOO_LONG",
      error: "Items can be borrowed for a maximum of 12 months.",
    };
  }

  return { valid: true, start, end };
}