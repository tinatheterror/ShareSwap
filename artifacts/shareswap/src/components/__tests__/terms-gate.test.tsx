import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as any,
  path: "/",
  apiRequest: vi.fn(),
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.path, vi.fn()] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest, queryClient: { invalidateQueries: mocks.invalidateQueries } }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: ({ mutationFn, onSuccess, onError }: any) => ({
    isPending: false,
    mutate: () => mutationFn().then(onSuccess, onError),
  }),
}));

import { TermsGate } from "../terms-gate";

beforeEach(() => {
  mocks.user = { id: 1, termsAcceptanceRequired: true, currentTermsVersion: "2026-11-02" };
  mocks.path = "/";
  mocks.apiRequest.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  mocks.invalidateQueries.mockReset();
  mocks.toast.mockReset();
});
afterEach(cleanup);

describe("TermsGate", () => {
  it("shows nothing to someone who has accepted, or who is signed out", () => {
    mocks.user = { id: 1, termsAcceptanceRequired: false, currentTermsVersion: "2026-11-02" };
    const { container, rerender } = render(<TermsGate />);
    expect(container.textContent).toBe("");
    mocks.user = null;
    rerender(<TermsGate />);
    expect(screen.queryByTestId("terms-gate")).toBeNull();
  });

  it("blocks until the box is ticked, then records the current version and refreshes the user", async () => {
    render(<TermsGate />);
    const accept = screen.getByTestId("terms-gate-accept") as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("terms-gate-checkbox"));
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/user"] }));
    expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/account/accept-terms", { version: "2026-11-02" });
  });

  it("says so when the server refuses, and does not refresh as if it had worked", async () => {
    mocks.apiRequest.mockResolvedValue({ ok: false, json: async () => ({ message: "The Terms were updated." }) });
    render(<TermsGate />);
    fireEvent.click(screen.getByTestId("terms-gate-checkbox"));
    fireEvent.click(screen.getByTestId("terms-gate-accept"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0][0].description).toBe("The Terms were updated.");
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("stays out of the way on the pages it links to", () => {
    for (const path of ["/terms", "/community-guidelines", "/privacy"]) {
      mocks.path = path;
      const { unmount } = render(<TermsGate />);
      expect(screen.queryByTestId("terms-gate"), path).toBeNull();
      unmount();
    }
  });
});
