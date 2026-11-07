import { formatWalletAmount, walletDebtNotice } from "../walletHistory";

describe("wallet history", () => {
  it("signs amounts and names a currency only when it is not the wallet's", () => {
    expect(formatWalletAmount({ amount: "-20.00", currency: "cad" }, "cad")).toBe("-$20.00");
    expect(formatWalletAmount({ amount: "30.00", currency: "cad" }, "cad")).toBe("+$30.00");
    expect(formatWalletAmount({ amount: "50.00", currency: "usd" }, "cad")).toBe("+$50.00 USD");
    expect(formatWalletAmount({ amount: "2.5", currency: "CAD" }, "cad")).toBe("+$2.50");
  });

  it("only mentions debt when something is owed", () => {
    expect(walletDebtNotice("0.00")).toBeNull();
    expect(walletDebtNotice(0)).toBeNull();
    expect(walletDebtNotice("65.00")?.title).toBe("You owe $65.00 from a payment dispute");
    expect(walletDebtNotice("65.00")?.body).toMatch(/next earnings pay it off first/);
  });
});
