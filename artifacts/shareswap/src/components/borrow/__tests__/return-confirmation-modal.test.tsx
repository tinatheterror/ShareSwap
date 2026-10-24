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
          isEarlyReturn={false}
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

  it("tells the owner no claim was opened when damage is reported on an in-person deposit", async () => {
    const reason = "This deposit was paid in person, so it can’t be charged through ShareSwap. Please settle any damage with the borrower directly.";
    mocks.apiRequest.mockResolvedValueOnce({
      json: async () => ({ success: true, claimNotOpened: true, claimNotOpenedReason: reason }),
    });
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
          isEarlyReturn={false}
          depositMethod="in_person"
          onSuccess={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm Return" }));

    await waitFor(() => {
      expect(mocks.toast).toHaveBeenCalledWith({
        title: "Return confirmed — no claim opened",
        description: reason,
      });
    });
  });

  it("labels the return early only when the server says so, whatever the viewer's own date is", () => {
    const renderModal = (isEarlyReturn: boolean) => {
      const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      return render(
        <QueryClientProvider client={queryClient}>
          <ReturnConfirmationModal
            isOpen
            onClose={vi.fn()}
            requestId={42}
            itemName="Camping stove"
            depositAmount={20}
            userRole="owner"
            requestType="BORROW"
            isEarlyReturn={isEarlyReturn}
            onSuccess={vi.fn()}
          />
        </QueryClientProvider>,
      );
    };
    const early = renderModal(true);
    expect(screen.getByText("Confirm Early Return")).toBeInTheDocument();
    early.unmount();
    renderModal(false);
    expect(screen.queryByText("Confirm Early Return")).not.toBeInTheDocument();
    expect(screen.getByText("Confirm Item Return")).toBeInTheDocument();
  });
});