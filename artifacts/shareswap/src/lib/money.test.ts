import { describe, expect, it } from "vitest";
import { PRICES_IN_CAD_NOTE, currencySymbol, formatMoney, formatMoneyExact } from "./money";

describe("money", () => {
  it("writes whole dollars without cents and everything else with two decimals", () => {
    expect(formatMoney(20)).toBe("$20");
    expect(formatMoney(20.5)).toBe("$20.50");
    expect(formatMoney("4.99")).toBe("$4.99");
    expect(formatMoney(0.1 + 0.2)).toBe("$0.30");
    expect(formatMoney(19.999)).toBe("$20");
  });

  it("groups thousands", () => {
    expect(formatMoney(1250)).toBe("$1,250");
    expect(formatMoney(1234567.5)).toBe("$1,234,567.50");
  });

  it("always shows cents in checkout lines", () => {
    expect(formatMoneyExact(20)).toBe("$20.00");
    expect(formatMoneyExact(0.5)).toBe("$0.50");
    expect(formatMoneyExact(1250)).toBe("$1,250.00");
  });

  it("treats missing or invalid amounts as zero", () => {
    expect(formatMoney(null)).toBe("$0");
    expect(formatMoney(undefined)).toBe("$0");
    expect(formatMoney("")).toBe("$0");
    expect(formatMoney("abc")).toBe("$0");
    expect(formatMoneyExact(NaN)).toBe("$0.00");
  });

  it("keeps the sign of a negative amount", () => {
    expect(formatMoney(-5)).toBe("-$5");
    expect(formatMoney(-0.001)).toBe("$0");
  });

  it("uses a bare $ for CAD, US$ for a request still in USD, and the code for anything else", () => {
    expect(currencySymbol()).toBe("$");
    expect(currencySymbol("CAD")).toBe("$");
    expect(currencySymbol(null)).toBe("$");
    expect(formatMoney(20, "usd")).toBe("US$20");
    expect(formatMoneyExact(20, "USD")).toBe("US$20.00");
    expect(formatMoney(20, "eur")).toBe("EUR 20");
  });

  it("states the currency once, in words", () => {
    expect(PRICES_IN_CAD_NOTE).toBe("Prices in CAD");
  });
});
