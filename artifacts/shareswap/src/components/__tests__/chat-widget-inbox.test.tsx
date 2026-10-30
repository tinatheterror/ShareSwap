import React from "react";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, username: "me" }, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => ({ apiRequest: vi.fn(), queryClient: new (await import("@tanstack/react-query")).QueryClient() }));
vi.mock("@/lib/stripe-client", () => ({ getStripePromise: () => null }));
vi.mock("@/hooks/use-websocket", () => ({ useWebSocket: () => ({ isConnected: false, sendMessage: vi.fn() }) }));

import { ChatWidget } from "../chat-widget";

const thread = (requestId: number, over: Record<string, unknown>) => ({
  requestId, partnerId: 10 + requestId, partnerUsername: `partner${requestId}`, partnerDisplayName: `Partner ${requestId}`,
  partnerPhoto: null, partnerIsVerified: false, partnerLastActiveAt: null, partnerActiveStatus: null, partnerResponseTime: null,
  lastActivityTime: "2026-10-29T10:00:00.000Z", preview: "hi", previewType: "message", previewSentByMe: false, unreadCount: 0,
  requestType: "BORROW", requestStatus: "PENDING", requestNegotiationStatus: null, itemName: `Item ${requestId}`, itemId: requestId,
  itemPhoto: null, iAmRequester: false, isArchived: false, ...over,
});
const lane = (section: string, statusLine: string, actionLabel: string | null = null) => ({ section, statusLine, actionLabel, dueDay: null });

function renderWidget() {
  const { hook } = memoryLocation({ path: "/" });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => mocks.data[queryKey.join("|")] ?? mocks.data[queryKey[0] as string] ?? [] } },
  });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}><ChatWidget /></Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    ({ ok: true, json: async () => (String(input).includes("archived=true") ? mocks.data.archived : []) }) as Response);
  mocks.data = {
    "/api/inbox": [
      thread(1, { lane: lane("action", "Partner 1 is waiting for your answer", "Accept or decline") }),
      thread(2, { requestStatus: "IN_PROGRESS", iAmRequester: true, lane: lane("in_progress", "Return by Nov 3") }),
    ],
    archived: [thread(3, { requestStatus: "COMPLETED", isArchived: true, lane: lane("history", "Completed") })],
  };
});
afterEach(() => cleanup());

describe("the inbox panel", () => {
  it("groups threads into Needs your action and In progress, with a status line each, and keeps History behind its pill", async () => {
    renderWidget();
    await act(async () => { window.dispatchEvent(new Event("open-chat-requests")); });

    expect((await screen.findByTestId("inbox-section-action")).textContent).toContain("Item 1");
    expect(screen.getByTestId("inbox-status-line-1").textContent).toBe("Accept or decline · Partner 1 is waiting for your answer");
    expect(screen.getByTestId("inbox-section-in_progress").textContent).toContain("Item 2");
    expect(screen.getByTestId("inbox-status-line-2").textContent).toBe("Return by Nov 3");
    expect(screen.queryByText("Item 3")).toBeNull();

    fireEvent.click(screen.getByText("History"));
    expect(await screen.findByTestId("inbox-section-history")).toBeTruthy();
    expect(screen.getByTestId("inbox-section-history").textContent).toContain("Item 3");
    expect(screen.queryByTestId("inbox-section-action")).toBeNull();
  });

  it("filters by who asked", async () => {
    renderWidget();
    await act(async () => { window.dispatchEvent(new Event("open-chat-requests")); });
    await screen.findByTestId("inbox-section-action");
    fireEvent.click(screen.getByText("Mine"));
    expect(screen.queryByText("Item 1")).toBeNull();
    expect(screen.getByText("Item 2")).toBeTruthy();
  });
});
