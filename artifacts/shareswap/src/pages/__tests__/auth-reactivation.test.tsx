import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: "",
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("wouter", () => ({
  useSearch: () => mocks.search,
  useLocation: () => ["/auth", vi.fn()],
  Redirect: () => null,
}));
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

const reactivationCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/auth/google-reactivate");

describe("Google reactivation prompt on the web sign-in page", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/auth/google-reactivate") return { ok: true, json: async () => ({ user: { id: 1 } }) };
      return { ok: true, json: async () => ({ itemsShared: 0, totalUsers: 0, successfulTransactions: 0 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.toast.mockReset();
    window.history.replaceState(null, "", "/auth?reactivate=google&token=reactivate-abc");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mocks.search = "";
  });

  it("shows no prompt on an ordinary visit", () => {
    mocks.search = "";
    renderPage();
    expect(screen.queryByText("Account Deactivated")).toBeNull();
  });

  it("ignores a token that is not marked as a Google reactivation", () => {
    mocks.search = "token=reactivate-abc";
    renderPage();
    expect(screen.queryByText("Account Deactivated")).toBeNull();
  });

  it("offers to reactivate and takes the token out of the address bar", () => {
    mocks.search = "reactivate=google&token=reactivate-abc";
    renderPage();
    expect(screen.getByText("Account Deactivated")).toBeTruthy();
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("reactivate-abc");
  });

  it("sends only the token to the Google route when the person confirms", async () => {
    mocks.search = "reactivate=google&token=reactivate-abc";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Reactivate Account/ }));
    await waitFor(() => expect(reactivationCalls()).toHaveLength(1));
    const [, init] = reactivationCalls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ token: "reactivate-abc" });
    expect(fetchMock.mock.calls.some(([url]) => url === "/api/reactivate-account")).toBe(false);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Welcome back!" })));
  });

  it("sends nothing when the person cancels", () => {
    mocks.search = "reactivate=google&token=reactivate-abc";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(reactivationCalls()).toHaveLength(0);
    expect(screen.queryByText("Account Deactivated")).toBeNull();
  });

  it("drops the prompt and shows the server's reason when the token is refused", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/auth/google-reactivate") return { ok: false, json: async () => ({ message: "Invalid or expired token" }) };
      return { ok: true, json: async () => ({}) };
    });
    mocks.search = "reactivate=google&token=reactivate-abc";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Reactivate Account/ }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Reactivation failed", description: "Invalid or expired token", variant: "destructive" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("Account Deactivated")).toBeNull());
  });
});
