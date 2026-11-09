import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UserBadges } from "@/components/user-badges";

afterEach(cleanup);

const LABEL = "ID and payment method verified";

describe("the Verified badge (an approved ID AND a card on file, i.e. isVerified)", () => {
  it("shows for a verified member with the accessible label and a tooltip", () => {
    render(<UserBadges isVerified />);
    const badge = screen.getByRole("img", { name: LABEL });
    expect(badge).toBeTruthy();
    expect(badge.parentElement?.getAttribute("title")).toBe(LABEL);
  });

  it("is called Verified, not ID verified, when labels are shown", () => {
    render(<UserBadges isVerified showLabels />);
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.queryByText("ID verified")).toBeNull();
    expect(screen.queryByRole("img", { name: "ID verified" })).toBeNull();
  });

  it("does not show without isVerified, which is what a member with an approved ID but no card has", () => {
    render(<UserBadges isVerified={false} />);
    expect(screen.queryByRole("img", { name: LABEL })).toBeNull();
    cleanup();
    render(<UserBadges />);
    expect(screen.queryByRole("img", { name: LABEL })).toBeNull();
  });

  it("is not driven by an ID-only flag", () => {
    render(<UserBadges {...({ idVerified: true } as any)} />);
    expect(screen.queryByRole("img", { name: LABEL })).toBeNull();
  });
});
