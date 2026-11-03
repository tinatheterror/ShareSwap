import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({ Link: ({ children, ...props }: any) => <a {...props}>{children}</a> }));

import TermsPage from "../terms-page";
import PrivacyPage from "../privacy-page";

afterEach(cleanup);

describe("the Terms and Privacy pages", () => {
  it("show the Terms from docs/legal, including the zero-tolerance section", () => {
    const { container } = render(<TermsPage />);
    expect(screen.getByRole("heading", { name: "ShareSwap Terms of Service" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Zero tolerance for objectionable content and abusive users" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/coming soon/i);
  });

  it("show the Privacy Policy with its third parties, retention and deletion sections", () => {
    const { container } = render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: "ShareSwap Privacy Policy" })).toBeTruthy();
    for (const heading of ["What we collect", "Who we share it with", "How long we keep it", "Deleting your account"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    for (const party of ["Stripe", "Google", "Expo", "SendGrid", "Persona", "OpenAI"]) expect(container.textContent).toContain(party);
    expect(container.textContent).not.toMatch(/coming soon/i);
  });
});
