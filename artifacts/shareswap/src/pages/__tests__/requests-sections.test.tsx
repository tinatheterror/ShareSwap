import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requests: [] as unknown[] }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1 }, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/components/shared/navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/stripe-client", () => ({ getStripePromise: () => null }));

import RequestsPage from "../requests-page";

const lane = (section: string, statusLine: string, actionLabel: string | null = null) => ({ section, statusLine, actionLabel, dueDay: null });
const request = (id: number, status: string, ownerId: number, l: ReturnType<typeof lane>, name: string) => ({
  id, itemId: id, requesterId: ownerId === 1 ? 2 : 1, requestType: "BORROW", status, message: "", startDate: null, endDate: null,
  createdAt: "2026-10-01T00:00:00Z", deliveryMethod: "in_person", depositMethod: "in_app", lane: l,
  item: { id, name, photos: [], ownerId, replacementValue: 0, tier: 1, originalValue: "0", shareCoinPrice: "0" },
  requester: { id: 2, username: "sam", displayName: "Sam" },
  owner: { username: "me" },
});

function renderPage(path = "/requests") {
  const { hook } = memoryLocation({ path });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => (queryKey[0] === "/api/requests" ? mocks.requests : []),
      },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}><RequestsPage /></Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.requests = [
    request(1, "PENDING", 1, lane("action", "Sam is waiting for your answer", "Accept or decline"), "Drill"),
    request(2, "ACCEPTED", 1, lane("in_progress", "Waiting on Sam to place the deposit hold"), "Ladder"),
    request(3, "COMPLETED", 1, lane("history", "Completed"), "Tent"),
  ];
});
afterEach(() => cleanup());

describe("the requests page", () => {
  it("shows Needs your action and In progress, and keeps History behind its tab", async () => {
    renderPage();
    expect(await screen.findByTestId("requests-section-action")).toBeTruthy();
    expect(screen.getByTestId("requests-section-action").textContent).toContain("Drill");
    expect(screen.getByTestId("request-status-line-1").textContent).toContain("Accept or decline");
    expect(screen.getByTestId("requests-section-in-progress").textContent).toContain("Ladder");
    expect(screen.getByTestId("request-status-line-2").textContent).toBe("Waiting on Sam to place the deposit hold");
    expect(screen.queryByText("Tent")).toBeNull();

    fireEvent.click(screen.getByTestId("requests-tab-history"));
    expect(screen.getByTestId("requests-section-history").textContent).toContain("Tent");
    expect(screen.queryByTestId("requests-section-action")).toBeNull();
  });

  it("filters by who asked", async () => {
    mocks.requests.push(request(4, "PENDING", 2, lane("in_progress", "Waiting on Sam to respond"), "Bike"));
    renderPage();
    await screen.findByTestId("requests-section-action");
    expect(screen.getByText("Bike")).toBeTruthy();
    fireEvent.click(screen.getByTestId("requests-role-incoming"));
    expect(screen.queryByText("Bike")).toBeNull();
    fireEvent.click(screen.getByTestId("requests-role-mine"));
    expect(screen.getByText("Bike")).toBeTruthy();
    expect(screen.queryByText("Drill")).toBeNull();
  });

  it("explains the blocking-deletion filter with a way back", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => [mocks.requests[0]] } as Response);
    renderPage("/requests?filter=blocking-deletion");
    expect(await screen.findByTestId("requests-blocking-banner")).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/requests?filter=blocking-deletion", { credentials: "include" });
    expect(screen.getByTestId("requests-blocking-back").getAttribute("href")).toBe("/delete-account");
    expect(await screen.findByText("Drill")).toBeTruthy();
    expect(screen.queryByText("Ladder")).toBeNull();
  });
});
