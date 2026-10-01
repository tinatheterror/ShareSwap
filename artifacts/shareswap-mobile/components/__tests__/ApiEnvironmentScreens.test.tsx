import React, { act } from "react";
import renderer from "react-test-renderer";

jest.mock("@/lib/api", () => ({
  BASE_URL: "https://screen-test.replit.dev",
  apiGet: jest.fn(),
  apiRequest: jest.fn(),
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0d9488", primaryForeground: "#ffffff", foreground: "#0f172a",
    mutedForeground: "#64748b", muted: "#f1f5f9", background: "#ffffff",
    card: "#ffffff", border: "#e2e8f0",
  }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null, login: jest.fn(), setUserData: jest.fn() }),
  LAST_AUTH_METHOD_KEY: "last-auth-method",
}));
jest.mock("@/hooks/usePushNotifications", () => ({ registerPushToken: jest.fn() }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, refetch: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn() },
}));

import LoginScreen from "../../app/login";
import SettingsScreen from "../../app/settings";

describe("Environment labels on requested screens", () => {
  let tree: renderer.ReactTestRenderer | undefined;
  afterEach(() => {
    if (tree) act(() => { tree!.unmount(); });
    tree = undefined;
  });

  test.each([
    ["login", LoginScreen],
    ["Settings", SettingsScreen],
  ])("%s renders the real label using the app's API address", async (_name, Screen) => {
    await act(async () => { tree = renderer.create(<Screen />); });
    const label = tree!.root.findByProps({ testID: "api-environment-label" });
    expect(label.props.accessibilityLabel).toContain("Development");
    expect(label.props.accessibilityLabel).toContain("screen-test.replit.dev");
  });
});