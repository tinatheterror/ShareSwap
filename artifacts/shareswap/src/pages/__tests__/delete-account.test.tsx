import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletionEligibility } from "@/lib/account-deletion";

const mocks = vi.hoisted(() => ({
  user: null as null | { id: number },
  toast: vi.fn(),
  apiRequest: vi.fn(),
  data: {} as Record<string, unknown>,
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => mocks.apiRequest(...args) }));

import DeleteAccountPage from "../delete-account-page";
import { DeletionPendingBanner } from "@/components/deletion-pending-banner";

const base: DeletionEligibility = {
  eligible: true,
  blockers: [],
  autoResolve: { requests: 0 },
  wallet: { available: "0.00", pending: "0.00", tier: "none", forfeitedOnDeletion: "0.00", requiresForfeitAcknowledgement: false, withdrawalOffer: null },
  willEnd: { subscription: false },
};
const forfeit: DeletionEligibility = { ...base, wallet: { ...base.wallet, available: "0.40", tier: "forfeit", forfeitedOnDeletion: "0.40", requiresForfeitAcknowledgement: true } };
const pendingStatus = { accountStatus: "pending_deletion", deletionScheduledFor: "2099-11-13T12:00:00.000Z" };

function renderPage(ui: React.ReactElement = <DeleteAccountPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => mocks.data[queryKey[0] as string] } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const json = (body: unknown) => ({ json: async () => body });

beforeEach(() => {
  mocks.user = null;
  mocks.toast.mockReset();
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockResolvedValue(json({}));
  mocks.data = { "/api/account/status": { accountStatus: "active" }, "/api/account/deletion-eligibility": base };
});
afterEach(() => cleanup());

describe("the web deletion page, signed out", () => {
  it("explains what deleting does and sends the person to sign in, then back here", () => {
    renderPage();
    expect(screen.getByTestId("delete-account-signed-out")).toBeTruthy();
    expect(screen.getByText(/scheduled for deletion in 14 days/)).toBeTruthy();
    expect(screen.getByTestId("delete-account-sign-in").getAttribute("href")).toBe("/auth?returnTo=%2Fdelete-account");
    expect(mocks.apiRequest).not.toHaveBeenCalled();
  });
});

describe("the web deletion page, signed in", () => {
  beforeEach(() => { mocks.user = { id: 1 }; });

  it("shows what blocks the deletion and cannot continue", async () => {
    mocks.data["/api/account/deletion-eligibility"] = { ...base, eligible: false, blockers: [{ code: "open_requests", message: "Finish or cancel your open rentals, borrows, swaps and gifts first." }] };
    renderPage();
    await screen.findByTestId("delete-account-blockers");
    expect(screen.getByText(/Finish or cancel your open rentals/)).toBeTruthy();
    expect((screen.getByTestId("delete-account-continue") as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for the forfeit acknowledgement, then the final confirm, then requests the deletion", async () => {
    mocks.data["/api/account/deletion-eligibility"] = forfeit;
    renderPage();
    await screen.findByTestId("delete-account-wallet-forfeit");
    const next = screen.getByTestId("delete-account-continue") as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("delete-account-forfeit-check"));
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);

    const confirm = (await screen.findByTestId("delete-account-final-confirm")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("delete-account-final-check"));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/account/deletion/request", { acknowledgeForfeit: true }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Deletion requested" })));
  });

  it("with no balance there is nothing to acknowledge", async () => {
    renderPage();
    await screen.findByTestId("delete-account-review");
    expect(screen.queryByTestId("delete-account-forfeit-check")).toBeNull();
    expect((screen.getByTestId("delete-account-continue") as HTMLButtonElement).disabled).toBe(false);
  });

  it("while pending it shows the date; Cancel calls the cancel endpoint", async () => {
    mocks.data["/api/account/status"] = pendingStatus;
    renderPage();
    await screen.findByTestId("delete-account-pending");
    expect(screen.getAllByText(/Your account will be deleted on/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("delete-account-cancel"));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/account/deletion/cancel", {}));
  });

  it("Delete now needs its own confirmation, then deletes and shows the account is gone", async () => {
    mocks.data["/api/account/status"] = pendingStatus;
    renderPage();
    await screen.findByTestId("delete-account-pending");
    fireEvent.click(screen.getByTestId("delete-account-delete-now"));
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("delete-account-delete-now-confirm"));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/account/deletion/confirm", { confirmDeletion: true }));
    await screen.findByTestId("account-deleted");
  });

  it("Delete now is refused while something still blocks it", async () => {
    mocks.data["/api/account/status"] = pendingStatus;
    mocks.data["/api/account/deletion-eligibility"] = { ...base, eligible: false, blockers: [{ code: "open_claims", message: "A security claim involving you is still open." }] };
    renderPage();
    await screen.findByTestId("delete-account-pending");
    fireEvent.click(screen.getByTestId("delete-account-delete-now"));
    expect(await screen.findByText("A security claim involving you is still open.")).toBeTruthy();
    expect((screen.getByTestId("delete-account-delete-now-confirm") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the pending-deletion banner", () => {
  it("shows nothing for an active account or a signed-out visitor", async () => {
    mocks.user = { id: 1 };
    renderPage(<DeletionPendingBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("deletion-pending-banner")).toBeNull();
    cleanup();
    mocks.user = null;
    mocks.data["/api/account/status"] = pendingStatus;
    renderPage(<DeletionPendingBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("deletion-pending-banner")).toBeNull();
  });

  it("shows the date and a Cancel button while a deletion is pending", async () => {
    mocks.user = { id: 1 };
    mocks.data["/api/account/status"] = pendingStatus;
    renderPage(<DeletionPendingBanner />);
    await screen.findByTestId("deletion-pending-banner");
    expect(screen.getByText(/Your account will be deleted on/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("deletion-banner-cancel"));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/account/deletion/cancel", {}));
  });
});
