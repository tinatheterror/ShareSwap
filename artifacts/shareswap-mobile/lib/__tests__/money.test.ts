import { PRICES_IN_CAD_NOTE, currencySymbol, formatMoney, formatMoneyExact } from "../money";
import { claimResolvedOwnerLine, depositPhaseDescription, depositSummaryLine, holdReleasedMessage } from "../depositCopy";

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
  });

  it("treats missing or invalid amounts as zero", () => {
    expect(formatMoney(null)).toBe("$0");
    expect(formatMoney(undefined)).toBe("$0");
    expect(formatMoney("")).toBe("$0");
    expect(formatMoney("abc")).toBe("$0");
  });

  it("uses a bare $ for CAD, US$ for a request still in USD, and the code for anything else", () => {
    expect(currencySymbol()).toBe("$");
    expect(currencySymbol("CAD")).toBe("$");
    expect(formatMoney(20, "usd")).toBe("US$20");
    expect(formatMoneyExact(20, "USD")).toBe("US$20.00");
    expect(formatMoney(20, "eur")).toBe("EUR 20");
  });

  it("states the currency once, in words", () => {
    expect(PRICES_IN_CAD_NOTE).toBe("Prices in CAD");
  });

  it("deposit copy follows the request's currency", () => {
    expect(holdReleasedMessage(42)).toBe("$42 deposit hold released. You were not charged.");
    expect(holdReleasedMessage(42, "usd")).toBe("US$42 deposit hold released. You were not charged.");
    expect(depositPhaseDescription("hold", { amount: 42, currency: "usd" })).toBe("US$42 deposit hold. Not charged unless a claim is opened.");
    expect(depositSummaryLine({ amount: 105, currency: "usd" })).toBe("Deposit: US$105");
    expect(claimResolvedOwnerLine(70, 30, "usd")).toBe("Claim resolved · US$70 refunded · US$30 awarded to owner");
  });
});
