import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PendingPlanChangeNotice, pendingChangeLabel } from "../pending-plan-change";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...a: unknown[]) => apiRequest(...a) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const pending = { tier: "member" as const, effectiveAt: "2026-11-20T12:00:00.000Z" };

function renderNotice(p: typeof pending | null, currentTier = "pro") {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <PendingPlanChangeNotice pending={p} currentTier={currentTier} />
    </QueryClientProvider>,
  );
  return { invalidate };
}

beforeEach(() => apiRequest.mockReset());
afterEach(cleanup);

describe("pendingChangeLabel", () => {
  it("names the plan and the date", () => {
    expect(pendingChangeLabel(pending, () => "November 20")).toBe("Switching to Member on November 20");
    expect(pendingChangeLabel(null)).toBeNull();
  });
});

describe("PendingPlanChangeNotice", () => {
  it("shows the label with the date and a Keep Pro button", () => {
    renderNotice(pending);
    expect(screen.getByText(/Switching to Member on /)).toBeTruthy();
    expect(screen.getByText(/November 2[01]/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep Pro" })).toBeTruthy();
  });

  it("renders nothing when no change is pending", () => {
    renderNotice(null);
    expect(screen.queryByTestId("pending-plan-change")).toBeNull();
  });

  it("Keep Pro calls the release endpoint and refreshes the subscription status", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ released: true }) });
    const { invalidate } = renderNotice(pending);
    fireEvent.click(screen.getByRole("button", { name: "Keep Pro" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/subscription/keep-plan", {}));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/subscription/status"] }));
  });
});
