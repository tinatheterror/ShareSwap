import { cardLabel, planButtonAction, sheetCopy } from "../subscriptionPlan";

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
  it("Pro choosing Member: takes effect at period end, nothing charged or refunded now", () => {
    const c = sheetCopy({ currentTier: "pro", target: "member", card, preview: { tier: "member", priceCents: 499, amountDueTodayCents: 0, change: "downgrade", effectiveAt: "2026-11-20T00:00:00.000Z" }, formatDate: () => "November 20" });
    expect(c.headline).toBe("Switch to Member: CA$4.99/month, charged to Visa •••• 4242");
    expect(c.detail).toContain("Takes effect on November 20");
    expect(c.detail).toContain("Nothing is charged or refunded now");
    expect(c.confirmLabel).toBe("Switch to Member at period end");
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
