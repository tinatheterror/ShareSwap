import React, { act } from "react";
import renderer from "react-test-renderer";
import { Text } from "react-native";

const mockRefetchUser = jest.fn().mockResolvedValue(1);
let mockUser: Record<string, unknown> | null = null;

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#0d9488", primaryForeground: "#fff", foreground: "#000", mutedForeground: "#666", background: "#fff" }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/lib/api", () => ({ apiPost: jest.fn(), apiGet: jest.fn() }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, refetchUser: mockRefetchUser }) }));
jest.mock("@/lib/legalLinks", () => ({ openLegalLink: jest.fn(), PRIVACY_URL: "https://shareswap.app/privacy" }));

import { AiConsentProvider, useAiConsent } from "@/components/AiConsent";
import { apiGet, apiPost } from "@/lib/api";

const FEATURES = {
  provider: "OpenAI",
  version: "v1",
  features: [{ key: "smartscan", title: "SmartScan", purpose: "Identifies an item from photos.", shared: "The item photos you give SmartScan.", notShared: "Your name and email are never sent.", withoutConsent: "SmartScan is unavailable.", fallback: "unavailable" }],
};

let ensure: (feature: string, options?: { askOnce?: boolean }) => Promise<boolean>;
function Probe() {
  ensure = useAiConsent().ensureAiConsent;
  return <Text>probe</Text>;
}
const find = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findByProps({ testID });
const maybe = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findAllByProps({ testID });
const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

async function mount() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<AiConsentProvider><Probe /></AiConsentProvider>); });
  return tree;
}

beforeEach(() => {
  mockUser = { id: 1, aiConsents: [] };
  (apiGet as jest.Mock).mockReset().mockResolvedValue(FEATURES);
  (apiPost as jest.Mock).mockReset().mockResolvedValue({});
  mockRefetchUser.mockClear();
});

test("someone who already agreed is not asked", async () => {
  mockUser = { id: 1, aiConsents: ["smartscan"] };
  const tree = await mount();
  await expect(ensure("smartscan")).resolves.toBe(true);
  expect(maybe(tree, "ai-consent")).toHaveLength(0);
});

test("the prompt names OpenAI, what is shared and what happens without it; Allow records it and reloads the user", async () => {
  const tree = await mount();
  let result: boolean | undefined;
  await act(async () => { ensure("smartscan").then((v) => { result = v; }); });
  const sheet = text(tree);
  expect(sheet).toContain("OpenAI");
  expect(sheet).toContain("The item photos you give SmartScan.");
  expect(sheet).toContain("SmartScan is unavailable.");
  expect(result).toBeUndefined();
  await act(async () => { find(tree, "ai-consent-allow").props.onPress(); });
  expect(apiPost).toHaveBeenCalledWith("/api/ai-consent", { feature: "smartscan" });
  expect(mockRefetchUser).toHaveBeenCalled();
  expect(result).toBe(true);
});

test("Not now resolves false and sends nothing; an automatic feature is not asked twice", async () => {
  const tree = await mount();
  let result: boolean | undefined;
  await act(async () => { ensure("smartscan", { askOnce: true }).then((v) => { result = v; }); });
  await act(async () => { find(tree, "ai-consent-decline").props.onPress(); });
  expect(result).toBe(false);
  expect(apiPost).not.toHaveBeenCalled();
  await expect(ensure("smartscan", { askOnce: true })).resolves.toBe(false);
  expect(maybe(tree, "ai-consent")).toHaveLength(0);
});

test("if the wording cannot be loaded nothing is shared", async () => {
  (apiGet as jest.Mock).mockRejectedValue(new Error("offline"));
  await mount();
  await expect(ensure("smartscan")).resolves.toBe(false);
});
