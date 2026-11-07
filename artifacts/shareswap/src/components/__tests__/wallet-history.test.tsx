import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WalletHistoryView, formatWalletAmount, type WalletPage } from "../wallet-history";

afterEach(cleanup);

const page = (over: Partial<WalletPage> = {}): WalletPage => ({
  currency: "cad",
  balance: { available: "42.50", pending: "0.00", debt: "0.00", total: "42.50" },
  nextCursor: null,
  transactions: [
    { id: 6, kind: "chargeback", label: "Chargeback", amount: "-15.00", currency: "cad", createdAt: "2026-11-05T12:00:00.000Z" },
    { id: 5, kind: "currency_conversion", label: "Currency conversion", amount: "2.50", currency: "cad", createdAt: "2026-11-04T12:00:00.000Z" },
    { id: 4, kind: "withdrawal", label: "Withdrawal", amount: "-20.00", currency: "cad", createdAt: "2026-11-03T12:00:00.000Z" },
    { id: 3, kind: "claim_award", label: "Claim award", amount: "30.00", currency: "cad", createdAt: "2026-11-02T12:00:00.000Z" },
    { id: 2, kind: "rental_payout", label: "Rental earnings", amount: "50.00", currency: "usd", createdAt: "2026-11-01T12:00:00.000Z" },
  ],
  ...over,
});

describe("WalletHistoryView", () => {
  it("labels each row as the server says and signs the amounts", () => {
    render(<WalletHistoryView pages={[page()]} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    for (const label of ["Rental earnings", "Claim award", "Withdrawal", "Chargeback", "Currency conversion"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByTestId("wallet-row-4").textContent).toContain("-$20.00");
    expect(screen.getByTestId("wallet-row-3").textContent).toContain("+$30.00");
  });

  it("marks an amount that is not in the wallet's currency", () => {
    render(<WalletHistoryView pages={[page()]} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.getByTestId("wallet-row-2").textContent).toContain("+$50.00 USD");
    expect(formatWalletAmount({ amount: "-3.00", currency: "cad" }, "cad")).toBe("-$3.00");
  });

  it("shows what is owed only when something is, and offers more only when there is more", () => {
    const { rerender } = render(<WalletHistoryView pages={[page()]} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.queryByTestId("wallet-debt")).toBeNull();
    expect(screen.queryByTestId("wallet-history-more")).toBeNull();
    const onLoadMore = vi.fn();
    rerender(<WalletHistoryView pages={[page({ balance: { available: "0.00", pending: "0.00", debt: "65.00", total: "0.00" }, nextCursor: 2 })]} hasMore loadingMore={false} onLoadMore={onLoadMore} />);
    expect(screen.getByTestId("wallet-debt").textContent).toContain("$65.00");
    fireEvent.click(screen.getByTestId("wallet-history-more"));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("says so when there is no history", () => {
    render(<WalletHistoryView pages={[page({ transactions: [] })]} hasMore={false} loadingMore={false} onLoadMore={() => {}} />);
    expect(screen.getByTestId("wallet-history-empty")).toBeTruthy();
  });
});
