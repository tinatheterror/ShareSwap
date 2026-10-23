import { describe, it, expect } from "vitest";
import { billingRow } from "./billing-row";

const fmt = (iso: string) => iso.slice(0, 10);

describe("billingRow", () => {
  it("a paid plan shows Next billing from Stripe's period end, never the borrow-reset date", () => {
    expect(billingRow({ hasActivePaidSub: true, currentPeriodEnd: "2026-11-23T19:37:47.000Z", monthlyBorrowResetAt: "2026-08-05T00:00:00.000Z", formatDate: fmt })).toEqual({ label: "Next billing", date: "2026-11-23" });
  });
  it("a paid plan with no period end shows no row at all", () => {
    expect(billingRow({ hasActivePaidSub: true, currentPeriodEnd: null, monthlyBorrowResetAt: "2026-08-05T00:00:00.000Z" })).toBeNull();
  });
  it("a free plan shows when usage resets", () => {
    expect(billingRow({ hasActivePaidSub: false, monthlyBorrowResetAt: "2026-08-05T00:00:00.000Z", formatDate: fmt })).toEqual({ label: "Usage resets", date: "2026-08-05" });
    expect(billingRow({ hasActivePaidSub: false })).toBeNull();
  });
});
