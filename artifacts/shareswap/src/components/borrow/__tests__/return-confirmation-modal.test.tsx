import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReturnConfirmationModal } from "../return-confirmation-modal";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: mocks.apiRequest,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReturnConfirmationModal", () => {
  it("shows a visible destructive error when owner confirmation fails", async () => {
    mocks.apiRequest.mockRejectedValueOnce(new Error("Return could not be saved"));
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ReturnConfirmationModal
          isOpen
          onClose={vi.fn()}
          requestId={42}
          itemName="Camping stove"
          depositAmount={20}
          userRole="owner"
          requestType="BORROW"
          endDate="2026-08-01"
          onSuccess={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Return" }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Confirmation failed",
        description: "Return could not be saved",
        variant: "destructive",
      });
    });
  });
});