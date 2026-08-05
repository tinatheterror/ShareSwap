import { safeDate, fmtDate } from "../dateUtils";

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
