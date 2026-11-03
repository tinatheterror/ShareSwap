import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FEATURES = {
  provider: "OpenAI",
  version: "v1",
  features: [
    { key: "smartscan", title: "SmartScan", purpose: "Identifies an item from photos.", shared: "The item photos you give SmartScan.", notShared: "Your name and email are never sent.", withoutConsent: "SmartScan is unavailable.", fallback: "unavailable" },
  ],
};
const mocks = vi.hoisted(() => ({ user: null as any, apiRequest: vi.fn(), invalidateQueries: vi.fn(), toast: vi.fn() }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest, queryClient: { invalidateQueries: mocks.invalidateQueries } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: FEATURES }) }));

import { AiConsentProvider, useAiConsent } from "../ai-consent";

const results: boolean[] = [];
function Trigger({ feature = "smartscan", askOnce = false }: { feature?: string; askOnce?: boolean }) {
  const { ensureAiConsent } = useAiConsent();
  return <button onClick={() => ensureAiConsent(feature, { askOnce }).then((agreed) => results.push(agreed))}>use</button>;
}
const renderTrigger = (props: Parameters<typeof Trigger>[0] = {}) => render(<AiConsentProvider><Trigger {...props} /></AiConsentProvider>);

beforeEach(() => {
  results.length = 0;
  mocks.user = { id: 1, aiConsents: [] };
  mocks.apiRequest.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  mocks.invalidateQueries.mockReset();
  mocks.toast.mockReset();
});
afterEach(cleanup);

describe("the AI consent prompt", () => {
  it("does not ask someone who already agreed", async () => {
    mocks.user = { id: 1, aiConsents: ["smartscan"] };
    renderTrigger();
    fireEvent.click(screen.getByText("use"));
    await waitFor(() => expect(results).toEqual([true]));
    expect(screen.queryByTestId("ai-consent-dialog")).toBeNull();
  });

  it("names OpenAI, what is shared and what happens without it, and records the choice on Allow", async () => {
    renderTrigger();
    fireEvent.click(screen.getByText("use"));
    const dialog = await screen.findByTestId("ai-consent-dialog");
    expect(dialog.textContent).toContain("SmartScan uses OpenAI");
    expect(dialog.textContent).toContain("The item photos you give SmartScan.");
    expect(dialog.textContent).toContain("SmartScan is unavailable.");
    expect(results).toEqual([]);
    fireEvent.click(screen.getByTestId("ai-consent-allow"));
    await waitFor(() => expect(results).toEqual([true]));
    expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/ai-consent", { feature: "smartscan" });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/user"] });
  });

  it("Not now resolves false and sends nothing; an automatic feature is not asked again", async () => {
    renderTrigger({ askOnce: true });
    fireEvent.click(screen.getByText("use"));
    await screen.findByTestId("ai-consent-dialog");
    fireEvent.click(screen.getByTestId("ai-consent-decline"));
    await waitFor(() => expect(results).toEqual([false]));
    expect(mocks.apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("use"));
    await waitFor(() => expect(results).toEqual([false, false]));
    expect(screen.queryByTestId("ai-consent-dialog")).toBeNull();
  });

  it("treats a failed save as no consent", async () => {
    mocks.apiRequest.mockResolvedValue({ ok: false, json: async () => ({}) });
    renderTrigger();
    fireEvent.click(screen.getByText("use"));
    await screen.findByTestId("ai-consent-dialog");
    fireEvent.click(screen.getByTestId("ai-consent-allow"));
    await waitFor(() => expect(results).toEqual([false]));
    expect(mocks.toast).toHaveBeenCalled();
  });
});
