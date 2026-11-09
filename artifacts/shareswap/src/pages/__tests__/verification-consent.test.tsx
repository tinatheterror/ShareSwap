import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/verification", vi.fn()], Link: ({ children, ...p }: any) => <a {...p}>{children}</a> }));
vi.mock("@/components/shared/navbar", () => ({ Navbar: () => null }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest, queryClient: { invalidateQueries: vi.fn() } }));

import VerificationPage, { BiometricConsentNotice, type BiometricConsent } from "../verification-page";

const consent: BiometricConsent = {
  version: "2026-11-09",
  notice: "Persona will collect your ID images and a selfie to match your face to your ID. ShareSwap receives only the result and your name.",
  checkboxLabel: "I agree to ShareSwap and Persona collecting and using my ID and face data for identity verification.",
  policyPath: "/privacy#identity-verification-and-face-matching",
  consented: false,
  consentedAt: null,
};
const unverified = { status: "unverified", legalFullName: null, submittedAt: null, verifiedAt: null, failureReason: null };

function renderPage(state: BiometricConsent) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => (queryKey[0] === "/api/biometric-consent" ? state : unverified) } },
  });
  return render(<QueryClientProvider client={client}><VerificationPage /></QueryClientProvider>);
}

const calls = () => mocks.apiRequest.mock.calls.map(([method, url, body]) => `${method} ${url}${body ? ` ${JSON.stringify(body)}` : ""}`);

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.apiRequest.mockImplementation(async (_method: string, url: string) => ({
    ok: true,
    json: async () => (url === "/api/persona/create-inquiry" ? { inquiryId: "inq_1" } : {}),
  }));
});
afterEach(cleanup);

describe("the consent notice", () => {
  it("shows the notice with a link to the Privacy Policy section and the required checkbox", () => {
    render(<BiometricConsentNotice consent={consent} agreed={false} onAgreedChange={() => {}} />);
    expect(screen.getByTestId("biometric-notice").textContent).toContain("ShareSwap receives only the result and your name");
    expect(screen.getByTestId("biometric-policy-link").getAttribute("href")).toBe("/privacy#identity-verification-and-face-matching");
    expect(screen.getByLabelText(consent.checkboxLabel)).toBeTruthy();
    expect((screen.getByTestId("biometric-checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("does not ask again once the current wording was agreed", () => {
    render(<BiometricConsentNotice consent={{ ...consent, consented: true, consentedAt: "2026-11-09T12:00:00.000Z" }} agreed={false} onAgreedChange={() => {}} />);
    expect(screen.getByTestId("biometric-agreed")).toBeTruthy();
    expect(screen.queryByTestId("biometric-checkbox")).toBeNull();
  });
});

describe("Start Verification", () => {
  it("is disabled until the box is ticked, and nothing is sent before then", async () => {
    renderPage(consent);
    const start = (await screen.findByRole("button", { name: /Start Verification/ })) as HTMLButtonElement;
    await screen.findByTestId("biometric-checkbox");
    expect(start.disabled).toBe(true);
    fireEvent.click(start);
    expect(calls()).toEqual([]);
    fireEvent.click(screen.getByTestId("biometric-checkbox"));
    expect(start.disabled).toBe(false);
    fireEvent.click(screen.getByTestId("biometric-checkbox"));
    expect(start.disabled).toBe(true);
  });

  it("records the agreement for the version shown, then starts the Persona inquiry (in that order)", async () => {
    renderPage(consent);
    fireEvent.click(await screen.findByTestId("biometric-checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Start Verification/ }));
    await waitFor(() => expect(calls()).toContain("POST /api/persona/create-inquiry"));
    expect(calls()).toEqual([
      `POST /api/biometric-consent ${JSON.stringify({ version: "2026-11-09", agreed: true })}`,
      "POST /api/persona/create-inquiry",
    ]);
  });

  it("does not start the inquiry when recording the agreement fails", async () => {
    mocks.apiRequest.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/biometric-consent") throw new Error("The notice has changed. Please read it again.");
      return { ok: true, json: async () => ({ inquiryId: "inq_1" }) };
    });
    renderPage(consent);
    fireEvent.click(await screen.findByTestId("biometric-checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Start Verification/ }));
    expect(await screen.findByText(/The notice has changed/)).toBeTruthy();
    expect(calls().some((c) => c.includes("create-inquiry"))).toBe(false);
  });

  it("with consent already recorded needs no checkbox and goes straight to the inquiry", async () => {
    renderPage({ ...consent, consented: true, consentedAt: "2026-11-09T12:00:00.000Z" });
    const start = (await screen.findByRole("button", { name: /Start Verification/ })) as HTMLButtonElement;
    await screen.findByTestId("biometric-agreed");
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(calls()).toEqual(["POST /api/persona/create-inquiry"]));
  });
});
