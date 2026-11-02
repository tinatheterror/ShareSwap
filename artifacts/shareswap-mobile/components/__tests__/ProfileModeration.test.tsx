import React, { act } from "react";
import renderer from "react-test-renderer";
import { Alert } from "react-native";

let mockCurrentUser: { id: number } | null = { id: 1 };
let mockHeaderOptions: { headerRight?: () => React.ReactElement } = {};
const mockBack = jest.fn();

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0d9488", primaryForeground: "#ffffff", foreground: "#0f172a", accent: "#ccfbf1", accentForeground: "#0f766e",
    mutedForeground: "#64748b", muted: "#f1f5f9", background: "#ffffff", card: "#ffffff", border: "#e2e8f0",
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  const icon = (props: object) => mockReact.createElement(View, props);
  return { Feather: icon, MaterialCommunityIcons: icon };
});
jest.mock("lucide-react-native", () => ({ Coins: () => null }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "7" }),
  useRouter: () => ({ push: jest.fn(), back: mockBack, replace: jest.fn() }),
  Stack: { Screen: ({ options }: { options: typeof mockHeaderOptions }) => { mockHeaderOptions = options; return null; } },
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockCurrentUser }) }));
jest.mock("@/lib/api", () => ({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: jest.fn(), photoUrl: (p: string) => p }));
jest.mock("@/lib/moderation", () => ({ ...jest.requireActual("@/lib/moderation"), submitReport: jest.fn(), blockUser: jest.fn().mockResolvedValue({ blocked: true }) }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = String(queryKey[0]);
    if (key.endsWith("/public-profile")) return { isLoading: false, data: { id: 7, username: "dana-handle", displayName: "Dana", reviewCount: 1, createdAt: "2026-01-01T00:00:00Z" } };
    if (key.endsWith("/reviews")) return { data: [{ id: 31, rating: 5, comment: "Great", createdAt: "2026-02-01T00:00:00Z", reviewer: { id: 12, username: "rev", displayName: "Rey" } }] };
    return { data: [] };
  },
}));

import PublicProfileScreen from "../../app/profile/[id]";
import { submitReport } from "@/lib/moderation";

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  mockCurrentUser = { id: 1 };
  mockHeaderOptions = {};
  mockBack.mockClear();
  (submitReport as jest.Mock).mockReset().mockResolvedValue({ id: 1, status: "open", alreadyReported: false });
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

const render = async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<PublicProfileScreen />); });
  return tree;
};

describe("someone else's profile", () => {
  test("has a menu in the header that offers Report and Block, and a flag on each review", async () => {
    const tree = await render();
    expect(mockHeaderOptions.headerRight).toBeDefined();
    let menu!: renderer.ReactTestRenderer;
    await act(async () => { menu = renderer.create(mockHeaderOptions.headerRight!()); });
    await act(async () => { menu.root.findByProps({ testID: "profile-more" }).props.onPress(); });
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Dana");
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(["Report", "Block", "Cancel"]);
    expect(tree.root.findByProps({ testID: "report-review-31" })).toBeTruthy();
  });

  test("the flag on a review reports that review and offers to block its author", async () => {
    const tree = await render();
    await act(async () => { tree.root.findByProps({ testID: "report-review-31" }).props.onPress(); });
    await act(async () => { tree.root.findByProps({ testID: "report-reason-harassment" }).props.onPress(); });
    expect(tree.root.findAllByProps({ testID: "report-also-block" }).length).toBeGreaterThan(0);
    await act(async () => { tree.root.findByProps({ testID: "report-submit" }).props.onPress(); });
    expect(submitReport).toHaveBeenCalledWith({ targetType: "review", targetId: 31, reason: "harassment", details: "" });
  });
});

describe("your own profile, or a signed-out visitor", () => {
  test("has no report or block controls", async () => {
    mockCurrentUser = { id: 7 };
    let tree = await render();
    expect(mockHeaderOptions.headerRight).toBeUndefined();
    expect(tree.root.findAllByProps({ testID: "report-review-31" })).toHaveLength(0);

    mockCurrentUser = null;
    mockHeaderOptions = {};
    tree = await render();
    expect(mockHeaderOptions.headerRight).toBeUndefined();
    expect(tree.root.findAllByProps({ testID: "report-review-31" })).toHaveLength(0);
  });
});
