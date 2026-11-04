import React, { act } from "react";
import { Alert, Platform } from "react-native";
import renderer from "react-test-renderer";

const mockSetUserData = jest.fn();
const mockApiRequest = jest.fn();
const mockRequestCredential = jest.fn();
const mockAvailable = jest.fn();
const mockOpenAuthSession = jest.fn();

class MockCancelled extends Error {}

jest.mock("@/lib/api", () => ({
  BASE_URL: "https://apple-test.replit.dev",
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
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSession(...args) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
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
jest.mock("@/lib/appleSignIn", () => ({
  appleSignInAvailable: () => mockAvailable(),
  requestAppleCredential: () => mockRequestCredential(),
  get AppleSignInCancelled() {
    return MockCancelled;
  },
}));
jest.mock("@/components/AppleSignInButton", () => {
  const { Pressable, Text } = require("react-native");
  const mockReact = require("react");
  return {
    AppleSignInButton: ({ onPress }: { onPress: () => void }) =>
      mockReact.createElement(Pressable, { onPress, testID: "apple-button" }, mockReact.createElement(Text, null, "Continue with Apple")),
  };
});

import LoginScreen from "../../app/login";

type AlertButton = { text: string; onPress?: () => void };
const payload = { identityToken: "id-token", authorizationCode: "code", nonce: "raw-nonce", fullName: { givenName: "Ana", familyName: "Ruiz" } };

describe("Sign in with Apple on the login screen", () => {
  let tree: renderer.ReactTestRenderer | undefined;
  let alertSpy: jest.SpyInstance;
  let pressed: string | null;

  beforeEach(() => {
    jest.clearAllMocks();
    pressed = null;
    mockAvailable.mockResolvedValue(true);
    mockRequestCredential.mockResolvedValue(payload);
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      (buttons as AlertButton[] | undefined)?.find((b) => b.text === pressed)?.onPress?.();
    });
  });

  afterEach(() => {
    if (tree) act(() => { tree!.unmount(); });
    tree = undefined;
    alertSpy.mockRestore();
  });

  const render = async () => { await act(async () => { tree = renderer.create(<LoginScreen />); }); };
  const appleButtons = () => tree!.root.findAll((n) => n.props.testID === "apple-button" && typeof n.props.onPress === "function");
  const pressApple = async () => { await act(async () => { await appleButtons()[0].props.onPress(); }); };

  test("is offered when the device supports it, above Google, and hidden when it does not", async () => {
    await render();
    expect(appleButtons().length).toBeGreaterThan(0);
    act(() => { tree!.unmount(); });
    mockAvailable.mockResolvedValue(false);
    await render();
    expect(appleButtons()).toHaveLength(0);
  });

  test("sends Apple's token, raw nonce and first-time name to the native route and signs the person in", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => ({ id: 12, displayName: "Ana R." }) });
    await render();
    await pressApple();
    expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/apple/native", payload);
    expect(mockSetUserData).toHaveBeenCalledWith({ id: 12, displayName: "Ana R." });
  });

  test("a person who closes the Apple sheet sees nothing", async () => {
    mockRequestCredential.mockRejectedValue(new MockCancelled());
    await render();
    await pressApple();
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("a deactivated account is offered reactivation and the token goes to the provider-neutral route", async () => {
    pressed = "Reactivate";
    mockApiRequest
      .mockResolvedValueOnce({ json: async () => ({ reactivate: true, token: "reactivate-xyz" }) })
      .mockResolvedValueOnce({ json: async () => ({ user: { id: 5, accountStatus: "active" } }) });
    await render();
    await pressApple();
    expect(mockApiRequest).toHaveBeenLastCalledWith("POST", "/api/auth/oauth-reactivate", { token: "reactivate-xyz" });
    expect(mockSetUserData).toHaveBeenCalledWith({ id: 5, accountStatus: "active" });
  });

  test("cancelling the reactivation prompt signs nobody in", async () => {
    pressed = "Cancel";
    mockApiRequest.mockResolvedValue({ json: async () => ({ reactivate: true, token: "reactivate-xyz" }) });
    await render();
    await pressApple();
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockSetUserData).not.toHaveBeenCalled();
  });

  test("a refusal from the server is reported, not swallowed", async () => {
    mockApiRequest.mockRejectedValue(new Error("This account cannot be used on ShareSwap."));
    await render();
    await pressApple();
    expect(mockSetUserData).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Sign-in failed", "This account cannot be used on ShareSwap.");
  });

  describe("on Android (browser redirect flow)", () => {
    const original = Platform.OS;
    beforeEach(() => { (Platform as { OS: string }).OS = "android"; mockAvailable.mockResolvedValue(true); });
    afterEach(() => { (Platform as { OS: string }).OS = original; });

    test("opens the system browser at the server's flow with the app's return address, then redeems the token", async () => {
      mockOpenAuthSession.mockResolvedValue({ type: "success", url: "shareswap://login?token=abc123" });
      mockApiRequest.mockResolvedValue({ json: async () => ({ id: 21 }) });
      await render();
      await pressApple();
      expect(mockOpenAuthSession).toHaveBeenCalledWith("https://apple-test.replit.dev/api/auth/apple/start?platform=native&redirect_uri=shareswap%3A%2F%2Flogin", "shareswap://login");
      expect(mockRequestCredential).not.toHaveBeenCalled();
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/exchange-token", { token: "abc123" });
      expect(mockSetUserData).toHaveBeenCalledWith({ id: 21 });
    });

    test("closing the browser, or cancelling at Apple, shows nothing", async () => {
      mockOpenAuthSession.mockResolvedValueOnce({ type: "cancel" }).mockResolvedValueOnce({ type: "success", url: "shareswap://login?apple=cancelled" });
      await render();
      await pressApple();
      await pressApple();
      expect(mockApiRequest).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    test("a refusal that comes back in the link is shown to the person", async () => {
      mockOpenAuthSession.mockResolvedValue({ type: "success", url: "shareswap://login?apple=refused" });
      await render();
      await pressApple();
      expect(mockSetUserData).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith("Sign-in failed", "This account cannot be used on ShareSwap.");
    });

    test("a deactivated account comes back with a reactivation token and is offered the prompt", async () => {
      pressed = "Reactivate";
      mockOpenAuthSession.mockResolvedValue({ type: "success", url: "shareswap://login?reactivate=1&token=reactivate-zzz" });
      mockApiRequest.mockResolvedValue({ json: async () => ({ user: { id: 8, accountStatus: "active" } }) });
      await render();
      await pressApple();
      expect(mockApiRequest).toHaveBeenCalledWith("POST", "/api/auth/oauth-reactivate", { token: "reactivate-zzz" });
      expect(mockSetUserData).toHaveBeenCalledWith({ id: 8, accountStatus: "active" });
    });
  });

  test("on the web build the button goes to the server's redirect flow", async () => {
    const original = Platform.OS;
    (Platform as { OS: string }).OS = "web";
    const location = { href: "" };
    (global as unknown as { window: { location: typeof location } }).window = { location };
    try {
      mockAvailable.mockResolvedValue(false);
      await render();
      await pressApple();
      expect(location.href).toBe("https://apple-test.replit.dev/api/auth/apple/start");
      expect(mockRequestCredential).not.toHaveBeenCalled();
    } finally {
      (Platform as { OS: string }).OS = original;
      delete (global as unknown as { window?: unknown }).window;
    }
  });
});
