import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UserBadges } from "@/components/user-badges";

afterEach(cleanup);

describe("the ID verified badge", () => {
  it("shows for a member with an approved ID", () => {
    render(<UserBadges idVerified />);
    expect(screen.getByRole("img", { name: "ID verified" })).toBeTruthy();
  });

  it("does not show without one", () => {
    render(<UserBadges idVerified={false} />);
    expect(screen.queryByRole("img", { name: "ID verified" })).toBeNull();
    cleanup();
    render(<UserBadges />);
    expect(screen.queryByRole("img", { name: "ID verified" })).toBeNull();
  });

  it("is not driven by the old isVerified flag (ID plus card), which only gates borrowing and renting", () => {
    render(<UserBadges {...({ isVerified: true } as any)} />);
    expect(screen.queryByRole("img", { name: "ID verified" })).toBeNull();
  });
});
