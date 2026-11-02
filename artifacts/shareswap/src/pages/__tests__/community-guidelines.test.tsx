import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ children, ...props }: any) => <a {...props}>{children}</a> }));

import CommunityGuidelinesPage from "../community-guidelines-page";

afterEach(cleanup);

describe("the Community Guidelines page", () => {
  it("shows the reviewed document from docs/legal, including how to report, block and appeal", () => {
    const { container } = render(<CommunityGuidelinesPage />);
    expect(screen.getByRole("heading", { name: "ShareSwap Community Guidelines" })).toBeTruthy();
    for (const heading of ["Be respectful", "Keep it safe and legal", "Be honest", "Respect privacy", "Reporting and blocking", "What happens when these are broken"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(container.querySelector('a[href="mailto:support@shareswap.app"]')).toBeTruthy();
    expect(container.textContent).toMatch(/review every report within 24 hours/);
  });
});
