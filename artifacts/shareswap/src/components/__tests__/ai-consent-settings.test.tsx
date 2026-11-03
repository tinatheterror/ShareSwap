import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FEATURES = {
  provider: "OpenAI",
  features: [
    { key: "smartscan", title: "SmartScan", purpose: "Identifies an item from photos.", shared: "The item photos you give SmartScan.", notShared: "n", withoutConsent: "SmartScan is unavailable.", fallback: "unavailable" },
    { key: "category_suggestion", title: "Category suggestion", purpose: "Suggests a category.", shared: "The item name you type.", notShared: "n", withoutConsent: "No category is suggested.", fallback: "unavailable" },
  ],
};
const mocks = vi.hoisted(() => ({ user: null as any, apiRequest: vi.fn(), invalidateQueries: vi.fn(), toast: vi.fn() }));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.apiRequest, queryClient: { invalidateQueries: mocks.invalidateQueries } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: FEATURES }) }));

import { AiConsentSettings } from "../ai-consent-settings";

beforeEach(() => {
  mocks.user = { id: 1, aiConsents: ["smartscan"] };
  mocks.apiRequest.mockReset().mockResolvedValue({ ok: true });
  mocks.invalidateQueries.mockReset();
  mocks.toast.mockReset();
});
afterEach(cleanup);

describe("Settings > AI features", () => {
  it("shows one switch per feature, on only for those agreed to, with what is sent and what happens when off", () => {
    render(<AiConsentSettings />);
    expect(screen.getByTestId("ai-consent-switch-smartscan").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("ai-consent-switch-category_suggestion").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("ai-consent-settings").textContent).toContain("The item name you type.");
    expect(screen.getByTestId("ai-consent-settings").textContent).toContain("No category is suggested.");
  });

  it("turning a switch on records consent, and off withdraws it, then reloads the user", async () => {
    render(<AiConsentSettings />);
    fireEvent.click(screen.getByTestId("ai-consent-switch-category_suggestion"));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("POST", "/api/ai-consent", { feature: "category_suggestion" }));
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/user"] }));
    fireEvent.click(screen.getByTestId("ai-consent-switch-smartscan"));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith("DELETE", "/api/ai-consent/smartscan"));
  });

  it("says so when the server refuses", async () => {
    mocks.apiRequest.mockResolvedValue({ ok: false });
    render(<AiConsentSettings />);
    fireEvent.click(screen.getByTestId("ai-consent-switch-category_suggestion"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });
});
