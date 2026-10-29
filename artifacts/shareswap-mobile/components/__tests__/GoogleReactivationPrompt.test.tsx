import React, { act } from "react";
import { Alert } from "react-native";
import renderer from "react-test-renderer";

const mockSetUserData = jest.fn();
const mockApiRequest = jest.fn();
const mockOpenAuthSession = jest.fn();

jest.mock("@/lib/api", () => ({
  BASE_URL: "https://reactivation-test.replit.dev",
  apiGet: jest.fn(),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0d9488", primaryForeground: "#ffffff", foreground: "#0f172a",
    mutedForeground: "#64748b", muted: "#f1f5f9", background: "#ffffff",
    card: "#ffffff", border: "#e2e8f0",
  }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: null, login: jest.fn(), setUserData: mockSetUserData }),
  LAST_AUTH_METHOD_KEY: "last-auth-method",
}));
jest.mock("@/hooks/usePushNotifications", () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
  getPushTokenForLogout: jest.fn().mockResolvedValue(null),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-linking", () => ({ createURL: () => "shareswap://login" }));
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args),
}));
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
  default: { getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn().mockResolvedValue(undefined) },
}));

import LoginScreen from "../../app/login";

type AlertButton = { text: string; onPress?: () => void };

describe("Google reactivation prompt on the login screen", () => {
  let tree: renderer.ReactTestRenderer | undefined;
  let alertSpy: jest.SpyInstance;
  let pressedButton: string | null;

  beforeEach(() => {
    jest.clearAllMocks();
    pressedButton = null;
    // The prompt resolves when one of its buttons is pressed; the test presses the one it names.
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      const button = (buttons as AlertButton[] | undefined)?.find((b) => b.text === pressedButton);
      button?.onPress?.();
    });
    mockApiRequest.mockResolvedValue({ json: async () => ({ user: { id: 9, accountStatus: "active" } }) });
  });

  afterEach(() => {
    if (tree) act(() => { tree!.unmount(); });
    tree = undefined;
    alertSpy.mockRestore();
  });

  async function signInWithGoogle(redirectUrl: string, press: string | null) {
    pressedButton = press;
    mockOpenAuthSession.mockResolvedValue({ type: "success", url: redirectUrl });
    await act(async () => { tree = renderer.create(<LoginScreen />); });
    let node: renderer.ReactTestInstance | null = tree!.root.findAll((n) => n.props.children === "Continue with Google")[0];
    while (node && typeof node.props.onPress !== "function") node = node.parent;
    const button = node!;
    await act(async () => { await button.props.onPress(); });
  }

  const promptCalls = () => alertSpy.mock.calls.filter(([title]) => title === "Account deactivated");

  test("asks before reactivating, and sends only the token to the Google route once confirmed", async () => {
    await signInWithGoogle("shareswap://login?reactivate=1&token=reactivate-abc", "Reactivate");

    expect(promptCalls()).toHaveLength(1);
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/google-reactivate", { token: "reactivate-abc" });
    expect(mockSetUserData).toHaveBeenCalledWith({ id: 9, accountStatus: "active" });
  });

  test("does nothing when the person cancels", async () => {
    await signInWithGoogle("shareswap://login?reactivate=1&token=reactivate-abc", "Cancel");

    expect(promptCalls()).toHaveLength(1);
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockSetUserData).not.toHaveBeenCalled();
  });

  test("reports a failure instead of signing in when the server refuses the token", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ message: "Invalid or expired token" }) });
    await signInWithGoogle("shareswap://login?reactivate=1&token=reactivate-abc", "Reactivate");

    expect(mockSetUserData).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Sign-in failed", "Unable to reactivate your account. Please try again.");
  });

  test("an ordinary Google sign-in never shows the prompt and uses the normal token exchange", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ id: 3 }) });
    await signInWithGoogle("shareswap://login?token=plain-token", null);

    expect(promptCalls()).toHaveLength(0);
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/exchange-token", { token: "plain-token" });
  });

  test("a reactivate flag without a token is not treated as a reactivation", async () => {
    await signInWithGoogle("shareswap://login?reactivate=1", "Reactivate");

    expect(promptCalls()).toHaveLength(0);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
