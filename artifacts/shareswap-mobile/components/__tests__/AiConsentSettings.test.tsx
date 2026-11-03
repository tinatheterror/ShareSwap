import React, { act } from "react";
import renderer from "react-test-renderer";

const mockRefetchUser = jest.fn().mockResolvedValue(1);
let mockUser: Record<string, unknown> | null = null;
const FEATURES = {
  provider: "OpenAI",
  features: [
    { key: "smartscan", title: "SmartScan", purpose: "Identifies an item.", shared: "The item photos you give SmartScan.", notShared: "n", withoutConsent: "SmartScan is unavailable.", fallback: "unavailable" },
    { key: "category_suggestion", title: "Category suggestion", purpose: "Suggests a category.", shared: "The item name you type.", notShared: "n", withoutConsent: "No category is suggested.", fallback: "unavailable" },
  ],
};

jest.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "#000", mutedForeground: "#666", card: "#fff", border: "#ddd" }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: FEATURES }) }));
jest.mock("@/lib/api", () => ({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: jest.fn() }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, refetchUser: mockRefetchUser }) }));
jest.mock("@/lib/legalLinks", () => ({ openLegalLink: jest.fn(), PRIVACY_URL: "https://shareswap.app/privacy" }));

import { Alert } from "react-native";
import { AiConsentSettings } from "@/components/AiConsentSettings";
import { apiDelete, apiPost } from "@/lib/api";

const find = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findByProps({ testID });

async function mount() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<AiConsentSettings />); });
  return tree;
}

beforeEach(() => {
  mockUser = { id: 1, aiConsents: ["smartscan"] };
  (apiPost as jest.Mock).mockReset().mockResolvedValue({});
  (apiDelete as jest.Mock).mockReset().mockResolvedValue({});
  mockRefetchUser.mockClear();
});

test("one switch per feature, on only for those agreed to, with what is sent and what happens when off", async () => {
  const tree = await mount();
  expect(find(tree, "ai-consent-switch-smartscan").props.value).toBe(true);
  expect(find(tree, "ai-consent-switch-category_suggestion").props.value).toBe(false);
  const text = JSON.stringify(tree.toJSON());
  expect(text).toContain("The item name you type.");
  expect(text).toContain("No category is suggested.");
});

test("on records consent, off withdraws it, and the user is reloaded each time", async () => {
  const tree = await mount();
  await act(async () => { find(tree, "ai-consent-switch-category_suggestion").props.onValueChange(true); });
  expect(apiPost).toHaveBeenCalledWith("/api/ai-consent", { feature: "category_suggestion" });
  await act(async () => { find(tree, "ai-consent-switch-smartscan").props.onValueChange(false); });
  expect(apiDelete).toHaveBeenCalledWith("/api/ai-consent/smartscan");
  expect(mockRefetchUser).toHaveBeenCalledTimes(2);
});

test("says so when the server refuses", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  (apiPost as jest.Mock).mockRejectedValue(new Error("no"));
  const tree = await mount();
  await act(async () => { find(tree, "ai-consent-switch-category_suggestion").props.onValueChange(true); });
  expect(alert).toHaveBeenCalled();
  expect(mockRefetchUser).not.toHaveBeenCalled();
  alert.mockRestore();
});
