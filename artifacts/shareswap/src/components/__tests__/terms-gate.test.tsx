import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: null as any,
  path: "/",
  apiRequest: vi.fn(),
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
  navigate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user, logoutMutation: { mutate: mocks.logout, isPending: false } }) }));
vi.mock("wouter", () => ({ useLocation: () => [mocks.path, mocks.navigate] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest, queryClient: { invalidateQueries: mocks.invalidateQueries } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { regions: [{ code: "CA-ON", country: "CA", name: "Ontario", ageOfMajority: 18 }, { code: "CA-BC", country: "CA", name: "British Columbia", ageOfMajority: 19 }] } }),
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
  mocks.navigate.mockReset();
  mocks.logout.mockReset();
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

  it("asks for the age too: nothing is sent until both are filled in, then the age is checked first and the Terms are accepted", async () => {
    mocks.user = { id: 1, termsAcceptanceRequired: true, ageConfirmationRequired: true, currentTermsVersion: "2026-11-02" };
    render(<TermsGate />);
    const accept = screen.getByTestId("terms-gate-accept") as HTMLButtonElement;
    fireEvent.click(screen.getByTestId("terms-gate-checkbox"));
    expect(accept.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("age-region"), { target: { value: "CA-BC" } });
    fireEvent.change(screen.getByTestId("age-dob"), { target: { value: "1990-05-05" } });
    expect(accept.disabled).toBe(false);
    fireEvent.click(accept);
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/user"] }));
    expect(mocks.apiRequest.mock.calls.map((call) => call[1])).toEqual(["/api/account/confirm-age", "/api/account/accept-terms"]);
    expect(mocks.apiRequest.mock.calls[0][2]).toEqual({ dateOfBirth: "1990-05-05", region: "CA-BC" });
  });

  it("an existing account that only needs its age checked sees no Terms box, and an under-age answer is shown on the screen", async () => {
    mocks.user = { id: 1, termsAcceptanceRequired: false, ageConfirmationRequired: true, currentTermsVersion: "2026-11-02" };
    mocks.apiRequest.mockResolvedValue({ ok: false, json: async () => ({ code: "AGE_NOT_ELIGIBLE", message: "You must be at least 19 to use ShareSwap in British Columbia." }) });
    render(<TermsGate />);
    expect(screen.queryByTestId("terms-gate-checkbox")).toBeNull();
    fireEvent.change(screen.getByTestId("age-region"), { target: { value: "CA-BC" } });
    fireEvent.change(screen.getByTestId("age-dob"), { target: { value: "2008-01-01" } });
    fireEvent.click(screen.getByTestId("terms-gate-accept"));
    expect((await screen.findByTestId("age-error")).textContent).toContain("at least 19");
    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("offers a way out: sign out, and the existing account deletion page", () => {
    render(<TermsGate />);
    fireEvent.click(screen.getByTestId("terms-gate-sign-out"));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("terms-gate-delete-account"));
    expect(mocks.navigate).toHaveBeenCalledWith("/delete-account");
  });

  it("is not shown on the deletion page itself, so the deletion flow stays reachable", () => {
    mocks.path = "/delete-account";
    const { container } = render(<TermsGate />);
    expect(container.textContent).toBe("");
  });
});
