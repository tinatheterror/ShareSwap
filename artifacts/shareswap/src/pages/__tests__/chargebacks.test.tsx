import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import terms from "../../../../../docs/legal/terms-of-service.md?raw";
import { SimpleMarkdown } from "@/components/legal/simple-markdown";

vi.mock("wouter", () => ({ Link: ({ children, ...props }: any) => <a {...props}>{children}</a> }));

import ChargebacksPage from "../chargebacks-page";

afterEach(cleanup);

describe("the Chargebacks and disputes help page", () => {
  it("states the launch policy: ShareSwap absorbs the loss and owners are not charged automatically", () => {
    const { container } = render(<ChargebacksPage />);
    expect(screen.getByRole("heading", { name: "Chargebacks and disputes" })).toBeTruthy();
    expect(container.textContent).toMatch(/ShareSwap absorbs the amount of a chargeback and the fee/);
    expect(container.textContent).toMatch(/do not take money from your wallet because of a chargeback/);
    expect(container.textContent).toMatch(/deposit hold stays in place/);
  });

  it("is linked from the Terms, whose Chargebacks paragraph promises no absorption and covers fraud and misconduct", () => {
    const paragraph = terms.split("\n\n").find((p) => p.startsWith("**Chargebacks.**"))!;
    expect(paragraph).toMatch(/fraud or misconduct/);
    expect(paragraph).toMatch(/false|did not happen/);
    expect(paragraph).toMatch(/restrict, suspend or ban/);
    expect(paragraph).not.toMatch(/absorb/i);
    const { container } = render(<SimpleMarkdown source={paragraph} />);
    expect(container.querySelector('a[href="/help/chargebacks"]')?.textContent).toBe("Chargebacks and disputes");
  });

  it("only turns links to a path on this site into links", () => {
    const { container } = render(<SimpleMarkdown source="[x](https://evil.example/a) and [y](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
  });
});
