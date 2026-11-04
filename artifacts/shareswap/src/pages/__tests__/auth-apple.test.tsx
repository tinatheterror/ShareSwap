import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appleSignInHref } from "@/lib/apple-sign-in";

const mocks = vi.hoisted(() => ({ search: "", toast: vi.fn() }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("wouter", () => ({ useSearch: () => mocks.search, useLocation: () => ["/auth", vi.fn()], Redirect: () => null }));
vi.mock("@/components/rolling-counter", () => ({ RollingCounter: () => null }));

import AuthPage from "../auth-page";

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => ({ itemsShared: 0, totalUsers: 0, successfulTransactions: 0 }) } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthPage />
    </QueryClientProvider>,
  );
}

describe("appleSignInHref", () => {
  it("points at the server's redirect flow and carries a referral code", () => {
    expect(appleSignInHref("", "/")).toBe("/api/auth/apple/start");
    expect(appleSignInHref("  ", "/app/")).toBe("/app/api/auth/apple/start");
    expect(appleSignInHref("AB 12", "/")).toBe("/api/auth/apple/start?ref=AB%2012");
  });
});

describe("Sign in with Apple on the web sign-in page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/auth/oauth-reactivate") return { ok: true, json: async () => ({ user: { id: 1 } }) };
      return { ok: true, json: async () => ({ itemsShared: 0, totalUsers: 0, successfulTransactions: 0 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.toast.mockReset();
    window.history.replaceState(null, "", "/auth");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mocks.search = "";
  });

  it("offers Continue with Apple, linking to the redirect flow, ahead of Google", () => {
    renderPage();
    const apple = screen.getByRole("link", { name: "Continue with Apple" });
    const google = screen.getByRole("link", { name: "Continue with Google" });
    expect(apple.getAttribute("href")).toBe("/api/auth/apple/start");
    expect(apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ["failed", /could not be completed/],
    ["refused", /cannot be used on ShareSwap/],
    ["unavailable", /not available right now/],
  ])("explains ?apple=%s and clears it from the address bar", (reason, text) => {
    window.history.replaceState(null, "", `/auth?apple=${reason}`);
    mocks.search = `apple=${reason}`;
    renderPage();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Sign in with Apple", description: expect.stringMatching(text), variant: "destructive" }));
    expect(window.location.search).toBe("");
  });

  it("redeems an Apple reactivation token at the provider-neutral route, not the Google one", async () => {
    mocks.search = "reactivate=apple&token=reactivate-apple-1";
    window.history.replaceState(null, "", "/auth?reactivate=apple&token=reactivate-apple-1");
    renderPage();
    expect(screen.getByText("Account Deactivated")).toBeTruthy();
    expect(window.location.href).not.toContain("reactivate-apple-1");
    fireEvent.click(screen.getByRole("button", { name: /Reactivate Account/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/oauth-reactivate")).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/auth/oauth-reactivate")!;
    expect(JSON.parse(call[1].body)).toEqual({ token: "reactivate-apple-1" });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/auth/google-reactivate")).toBe(false);
  });
});
