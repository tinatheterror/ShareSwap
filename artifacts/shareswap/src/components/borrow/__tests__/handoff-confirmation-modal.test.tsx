import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HandoffConfirmationModal } from "../handoff-confirmation-modal";

// Code-only handoff: the requester enters the code or reports a problem; the owner sees the same code or reports a problem.

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

const state = (over: Record<string, unknown> = {}) => ({
  hideManualConfirm: true, reportProblem: true, oneCode: true, autoConfirm: false,
  role: "requester", otherName: "Olive", locked: false, lockedUntil: null, minutesRemaining: 0, ...over,
});

function mockApi(stateBody: object) {
  mocks.apiRequest.mockImplementation(async (_method: string, path: string) => {
    const body = path.endsWith("/handoff-code-state") ? stateBody : { pin: "4821", pinUsed: false, expired: false };
    return { ok: true, json: async () => body };
  });
}

function open(userRole: "owner" | "borrower") {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HandoffConfirmationModal
        isOpen onClose={vi.fn()} requestId={7} itemName="Tent" shareCoinAmount={0}
        userRole={userRole} deliveryMethod="in_person" onSuccess={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("HandoffConfirmationModal (code-only)", () => {
  it("requester: asks the owner by name, one helper line, report a problem, no manual confirm", async () => {
    mockApi(state());
    open("borrower");
    expect(await screen.findByText("Ask Olive for the handoff code")).toBeInTheDocument();
    expect(screen.getByText("Only enter the code once you have the item.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument();
    expect(screen.queryByText(/Confirm without code/)).not.toBeInTheDocument();
  });

  it("requester: with the manual confirm switched back on, 'Confirm without code' is there", async () => {
    mockApi(state({ hideManualConfirm: false, reportProblem: false }));
    open("borrower");
    expect(await screen.findByText(/Confirm without code/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Item was not received?" })).toBeInTheDocument();
  });

  it("requester: during a lockout it says how long and shows no entry boxes", async () => {
    mockApi(state({ locked: true, minutesRemaining: 12 }));
    open("borrower");
    expect(await screen.findByText("Too many tries. Try again in 12 minutes.")).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("owner: shows the code, the in-person or chat line and a way to report a problem", async () => {
    mockApi(state({ role: "owner", otherName: "Remy" }));
    open("owner");
    expect(await screen.findByText("4821")).toBeInTheDocument();
    expect(screen.getByText("You can show this in person or send it in chat once you've handed the item over.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Report a problem" })).toBeInTheDocument());
    expect(screen.queryByText(/automatically in 24 hours/)).not.toBeInTheDocument();
  });
});
