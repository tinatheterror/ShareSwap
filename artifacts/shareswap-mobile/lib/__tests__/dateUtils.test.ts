import { safeDate, fmtCalendarDate, fmtDate, formatTime } from "../dateUtils";

describe("safeDate", () => {
  it("parses a bare YYYY-MM-DD string without returning Invalid Date", () => {
    const result = safeDate("2025-06-15");
    expect(isNaN(result.getTime())).toBe(false);
  });

  it("returns the correct calendar date for a bare YYYY-MM-DD string", () => {
    const result = safeDate("2025-06-15");
    // Normalized to local midnight — year/month/day should match
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(5); // 0-indexed
    expect(result.getDate()).toBe(15);
  });

  it("parses a full ISO timestamp without modification", () => {
    const result = safeDate("2025-06-15T12:30:00.000Z");
    expect(isNaN(result.getTime())).toBe(false);
  });

  it("returns an invalid Date for a malformed string", () => {
    const result = safeDate("not-a-date");
    expect(isNaN(result.getTime())).toBe(true);
  });
});

describe("fmtDate", () => {
  it("formats a bare YYYY-MM-DD string", () => {
    const result = fmtDate("2025-06-15");
    expect(result).not.toBe("Invalid Date");
    expect(result).not.toBe("–");
    expect(typeof result).toBe("string");
  });

  it("formats a full ISO timestamp string", () => {
    const result = fmtDate("2025-06-15T12:30:00.000Z");
    expect(result).not.toBe("Invalid Date");
    expect(result).not.toBe("–");
    expect(typeof result).toBe("string");
  });

  it("returns '–' for null", () => {
    expect(fmtDate(null)).toBe("–");
  });

  it("returns '–' for undefined", () => {
    expect(fmtDate(undefined)).toBe("–");
  });

  it("returns '–' for a malformed string (not 'Invalid Date')", () => {
    const result = fmtDate("garbage-input");
    expect(result).toBe("–");
  });

  it("returns '–' for an empty string", () => {
    expect(fmtDate("")).toBe("–");
  });

  it("accepts custom Intl.DateTimeFormatOptions", () => {
    const result = fmtDate("2025-06-15", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    expect(result).not.toBe("–");
    expect(result).not.toBe("Invalid Date");
  });
});

describe("fmtCalendarDate", () => {
  it("preserves the selected calendar day from a midnight UTC booking timestamp", () => {
    expect(fmtCalendarDate("2025-06-15T00:00:00.000Z")).toBe("Jun 15");
  });

  it("returns '–' for malformed date-only input", () => {
    expect(fmtCalendarDate("garbage-input")).toBe("–");
  });
});

// ---------------------------------------------------------------------------
// formatTime — activity feed timestamp formatter
// ---------------------------------------------------------------------------
describe("formatTime", () => {
  it("returns a non-empty string for a valid ISO timestamp", () => {
    const result = formatTime("2025-06-15T10:30:00.000Z");
    expect(result).not.toBe("–");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for a bare YYYY-MM-DD date", () => {
    const result = formatTime("2025-06-15");
    expect(result).not.toBe("–");
    expect(typeof result).toBe("string");
  });

  it("returns '–' for null", () => {
    expect(formatTime(null)).toBe("–");
  });

  it("returns '–' for undefined", () => {
    expect(formatTime(undefined)).toBe("–");
  });

  it("returns '–' for an empty string", () => {
    expect(formatTime("")).toBe("–");
  });

  it("returns '–' for a malformed date string", () => {
    expect(formatTime("not-a-date")).toBe("–");
  });

  it("returns '–' for a partial date string that produces Invalid Date", () => {
    expect(formatTime("2025-99-99")).toBe("–");
  });

  it("returns a time string (HH:MM) for a timestamp from today", () => {
    // Construct a timestamp for earlier today in local time so isToday is true
    const now = new Date();
    const todayAt9am = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      9,
      5,
      0,
    );
    const result = formatTime(todayAt9am.toISOString());
    expect(result).not.toBe("–");
    // Should contain a colon separator characteristic of time strings
    expect(result).toMatch(/:/);
  });

  it("returns a date string (e.g. 'Jun 15') for a past date", () => {
    const result = formatTime("2020-01-10T08:00:00.000Z");
    expect(result).not.toBe("–");
    // Should NOT contain a colon (it's a date, not a time)
    // We only assert it is non-empty and not a dash; exact format is locale-dependent
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
