import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), invalidate: vi.fn() }));

vi.mock("wouter", () => ({ useLocation: () => ["/dispute-evidence", vi.fn()], Link: ({ children, ...p }: any) => <a {...p}>{children}</a> }));
vi.mock("@/components/shared/navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest, queryClient: { invalidateQueries: mocks.invalidate } }));

import DisputeEvidencePage, { evidenceProblem } from "../dispute-evidence-page";
import { getNotificationRoute } from "../activity-page";

const pending = { disputeId: "du_1", requestId: 5, itemName: "Cordless drill", dueBy: "2026-12-01T00:00:00.000Z", requestedAt: "2026-11-20T00:00:00.000Z" };
const fetchMock = vi.fn();

function renderPage(requests = [pending]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => ({ requests }) } } });
  return render(<QueryClientProvider client={client}><DisputeEvidencePage /></QueryClientProvider>);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/csrf-token") return { ok: true, json: async () => ({ csrfToken: "tok" }) };
    if (url === "/api/uploads/claim-evidence") return { ok: true, json: async () => ({ url: "/uploads/a.jpg" }) };
    throw new Error(`unexpected ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});
afterEach(cleanup);

describe("the owner's dispute evidence screen", () => {
  it("needs a note or a photo, and respects the limits", () => {
    expect(evidenceProblem(" ", 0)).toMatch(/note, a photo/);
    expect(evidenceProblem("x", 0)).toBeNull();
    expect(evidenceProblem("", 1)).toBeNull();
    expect(evidenceProblem("x".repeat(4001), 0)).toMatch(/too long/);
    expect(evidenceProblem("x", 11)).toMatch(/at most 10/);
  });

  it("shows the pending dispute with the plain explanation", async () => {
    renderPage();
    expect(await screen.findByText("Cordless drill")).toBeTruthy();
    expect(screen.getByText(/You will not be charged/)).toBeTruthy();
    expect(screen.getByText(/We need your evidence by/)).toBeTruthy();
  });

  it("refuses an empty answer, then posts the note to the dispute's evidence endpoint", async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId("evidence-submit"));
    expect((await screen.findByTestId("evidence-error")).textContent).toMatch(/note, a photo, or both/);
    expect(mocks.apiRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("evidence-note"), { target: { value: "Borrower signed for it." } });
    fireEvent.click(screen.getByTestId("evidence-submit"));
    await screen.findByTestId("evidence-sent");
    expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/disputes/du_1/evidence", { note: "Borrower signed for it.", photoUrls: [] });
  });

  it("uploads each photo with the CSRF token first and sends the returned urls", async () => {
    renderPage();
    const input = await screen.findByTestId("evidence-files");
    fireEvent.change(input, { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByTestId("evidence-submit"));
    await screen.findByTestId("evidence-sent");
    const upload = fetchMock.mock.calls.find(([url]) => url === "/api/uploads/claim-evidence")!;
    expect(upload[1].headers).toEqual({ "x-csrf-token": "tok" });
    expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/disputes/du_1/evidence", { note: undefined, photoUrls: ["/uploads/a.jpg"] });
  });

  it("shows the server's error and keeps the form when sending fails", async () => {
    mocks.apiRequest.mockResolvedValue({ ok: false, json: async () => ({ message: "Dispute not found" }) });
    renderPage();
    fireEvent.change(await screen.findByTestId("evidence-note"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("evidence-submit"));
    await waitFor(() => expect(screen.getByTestId("evidence-error").textContent).toBe("Dispute not found"));
    expect(screen.getByTestId("evidence-submit")).toBeTruthy();
  });

  it("says so when nothing is waiting", async () => {
    renderPage([]);
    expect(await screen.findByTestId("evidence-empty")).toBeTruthy();
  });

  it("the evidence-request notification opens this screen, not the chat", () => {
    expect(getNotificationRoute({ id: 1, userId: 2, type: "dispute_evidence_requested", requestId: 5, itemId: null } as any)).toEqual({ type: "url", url: "/dispute-evidence?requestId=5" });
  });
});
