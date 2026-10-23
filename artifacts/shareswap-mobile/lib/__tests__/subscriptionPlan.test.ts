import { billingRow, cardLabel, keepPlanLabel, pendingChangeLabel, planButtonAction, sheetCopy } from "../subscriptionPlan";

describe("planButtonAction", () => {
  it("opens the in-app confirm sheet for any paid plan the user is not on, whether or not they already pay", () => {
    expect(planButtonAction("member", "pro")).toBe("confirm-sheet");
    expect(planButtonAction("pro", "member")).toBe("confirm-sheet");
    expect(planButtonAction("free", "member")).toBe("confirm-sheet");
    expect(planButtonAction("free", "pro")).toBe("confirm-sheet");
  });
  it("never routes a plan button to the billing portal", () => {
    const all = (["free", "member", "pro"] as const).flatMap((c) => (["free", "member", "pro"] as const).map((t) => planButtonAction(c, t)));
    expect(new Set(all)).toEqual(new Set(["current", "free", "confirm-sheet"]));
  });
  it("does nothing for the current plan or the free plan", () => {
    expect(planButtonAction("member", "member")).toBe("current");
    expect(planButtonAction("member", "free")).toBe("free");
  });
});

describe("sheetCopy", () => {
  const card = { brand: "visa", last4: "4242" };
  it("Member upgrading to Pro: price in CAD, the card, and the amount due today from Stripe's preview", () => {
    const c = sheetCopy({ currentTier: "member", target: "pro", card, preview: { tier: "pro", priceCents: 999, amountDueTodayCents: 321, change: "upgrade" } });
    expect(c.headline).toBe("Upgrade to Pro: CA$9.99/month, charged to Visa •••• 4242");
    expect(c.detail).toBe("Due today: CA$3.21, prorated for the rest of this billing period. Then CA$9.99/month.");
    expect(c.confirmLabel).toBe("Pay CA$3.21 and upgrade");
  });
  it("falls back to a plain proration note when there is no preview", () => {
    const c = sheetCopy({ currentTier: "member", target: "pro", card });
    expect(c.headline).toBe("Upgrade to Pro: CA$9.99/month, charged to Visa •••• 4242");
    expect(c.detail).toBe("Your first charge is prorated for the rest of this billing period.");
  });
  it("Pro choosing Member: the title carries the date and the price after it; no card, since nothing is charged now", () => {
    const c = sheetCopy({ currentTier: "pro", target: "member", card, preview: { tier: "member", priceCents: 499, amountDueTodayCents: 0, change: "downgrade", effectiveAt: "2026-11-23T19:37:47.000Z" }, formatDate: () => "November 23" });
    expect(c.title).toBe("Switch to Member on November 23");
    expect(c.headline).toBe("Switch to Member on November 23: CA$4.99/month after that");
    expect(c.headline).not.toContain("charged to");
    expect(c.showCard).toBe(false);
    expect(c.detail).toBe("Nothing is charged or refunded now, and you keep your current plan until then.");
    expect(c.confirmLabel).toBe("Switch to Member at period end");
  });
  it("without a date the downgrade says it takes effect when the billing period ends", () => {
    const c = sheetCopy({ currentTier: "pro", target: "member", card });
    expect(c.headline).toBe("Switch to Member: CA$4.99/month after that");
    expect(c.detail).toBe("Takes effect when your current billing period ends. Nothing is charged or refunded now.");
    expect(c.detail).not.toContain("on the end");
  });
  it("a first subscription says Subscribe and what is due now", () => {
    const c = sheetCopy({ currentTier: "free", target: "member", card, preview: { tier: "member", priceCents: 499, amountDueTodayCents: 499, change: "new" } });
    expect(c.headline).toBe("Subscribe to Member: CA$4.99/month, charged to Visa •••• 4242");
    expect(c.detail).toBe("Due today: CA$4.99.");
  });
  it("omits the card when none is on file", () => {
    expect(sheetCopy({ currentTier: "free", target: "pro", card: null }).headline).toBe("Subscribe to Pro: CA$9.99/month");
  });
});

describe("cardLabel", () => {
  it("names the brand and last four", () => {
    expect(cardLabel({ brand: "amex", last4: "0005" })).toBe("American Express •••• 0005");
    expect(cardLabel(null)).toBeNull();
  });
});

describe("pendingChangeLabel", () => {
  it("names the plan and the date a scheduled downgrade starts", () => {
    expect(pendingChangeLabel({ tier: "member", effectiveAt: "2026-11-20T00:00:00.000Z" }, () => "November 20")).toBe("Switching to Member on November 20");
  });
  it("is empty when nothing is pending", () => {
    expect(pendingChangeLabel(null)).toBeNull();
    expect(pendingChangeLabel(undefined)).toBeNull();
  });
});

describe("keepPlanLabel", () => {
  it("is named after the plan the user is on", () => {
    expect(keepPlanLabel("pro")).toBe("Keep Pro");
    expect(keepPlanLabel("member")).toBe("Keep Member");
  });
});

describe("billingRow", () => {
  const fmt = (iso: string) => iso.slice(0, 10);
  it("a paid plan shows Next billing from Stripe's period end, never the borrow-reset date (the August 5 bug)", () => {
    expect(billingRow({ hasActivePaidSub: true, currentPeriodEnd: "2026-11-23T19:37:47.000Z", monthlyBorrowResetAt: "2026-08-05T00:00:00.000Z", formatDate: fmt })).toEqual({ label: "Next billing", date: "2026-11-23" });
  });
  it("a paid plan without a period end shows no row", () => {
    expect(billingRow({ hasActivePaidSub: true, currentPeriodEnd: null, monthlyBorrowResetAt: "2026-08-05T00:00:00.000Z" })).toBeNull();
  });
  it("a free plan shows when usage resets", () => {
    expect(billingRow({ hasActivePaidSub: false, monthlyBorrowResetAt: "2026-08-05T00:00:00.000Z", formatDate: fmt })).toEqual({ label: "Usage resets", date: "2026-08-05" });
  });
});
