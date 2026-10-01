import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import LoginScreen from "@/app/login";
import { SessionGuard } from "@/components/SessionGuard";

const mockRouter = {
  replace: jest.fn(),
  push: jest.fn(),
};
let mockNavigationState: { key?: string } | undefined;
let mockPathname = "/chat/22";
let mockSearchParams: { requestId?: string } = { requestId: "73" };
let mockLoginParams: {
  session_expired?: string;
  returnTo?: string;
  returnUserId?: string;
} = {
  session_expired: "1",
  returnTo: "/chat/22?requestId=73",
  returnUserId: "14",
};
let mockAuthState = {
  user: null as { id: number } | null,
  isLoading: false,
  sessionExpired: true,
  clearSessionExpired: jest.fn(),
  login: jest.fn().mockResolvedValue(undefined),
  setUserData: jest.fn(),
};

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathname,
  useGlobalSearchParams: () => mockSearchParams,
  useRootNavigationState: () => mockNavigationState,
  useLocalSearchParams: () => mockLoginParams,
}));

jest.mock("@/context/AuthContext", () => ({
  LAST_AUTH_METHOD_KEY: "lastAuthMethod",
  useAuth: () => mockAuthState,
}));

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("@/hooks/usePushNotifications", () => ({
  registerPushToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1",
    primaryForeground: "#002319",
    foreground: "#111111",
    mutedForeground: "#666666",
    muted: "#f5f5f5",
    border: "#dddddd",
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: object) => React.createElement(View, props) };
});

jest.mock("expo-linking", () => ({ createURL: jest.fn(() => "shareswap://") }));
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("@/lib/api", () => ({
  BASE_URL: "https://example.test",
  apiRequest: jest.fn(),
}));

beforeEach(() => {
  mockRouter.replace.mockReset();
  mockRouter.push.mockReset();
  mockNavigationState = undefined;
  mockPathname = "/chat/22";
  mockSearchParams = { requestId: "73" };
  mockLoginParams = {
    session_expired: "1",
    returnTo: "/chat/22?requestId=73",
    returnUserId: "14",
  };
  mockAuthState = {
    user: { id: 14 },
    isLoading: false,
    sessionExpired: true,
    clearSessionExpired: jest.fn(),
    login: jest.fn().mockResolvedValue(undefined),
    setUserData: jest.fn(),
  };
});

describe("session-expiration navigation", () => {
  it("waits for root navigation, then retains the chat request and previous user id", () => {
    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<SessionGuard />);
    });

    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(mockAuthState.clearSessionExpired).not.toHaveBeenCalled();

    mockNavigationState = { key: "root-navigation" };
    act(() => {
      tree.update(<SessionGuard />);
    });

    expect(mockAuthState.clearSessionExpired).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/login",
      params: {
        session_expired: "1",
        returnTo: "/chat/22?requestId=73",
        returnUserId: "14",
      },
    });

    act(() => tree.unmount());
  });

  it("waits for auth loading and redirects a guest from protected chat without an expired-session notice", () => {
    mockAuthState = {
      user: null,
      isLoading: true,
      sessionExpired: false,
      clearSessionExpired: jest.fn(),
      login: jest.fn().mockResolvedValue(undefined),
      setUserData: jest.fn(),
    };
    mockNavigationState = { key: "root-navigation" };

    let tree!: renderer.ReactTestRenderer;
    act(() => {
      tree = renderer.create(<SessionGuard />);
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();

    mockAuthState = { ...mockAuthState, isLoading: false };
    act(() => {
      tree.update(<SessionGuard />);
    });

    expect(mockAuthState.clearSessionExpired).toHaveBeenCalledTimes(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/login",
      params: {
        session_expired: "0",
        returnTo: "/chat/22?requestId=73",
        returnUserId: "",
      },
    });
    act(() => tree.unmount());
  });

  it("resumes the saved chat only when the returning user is the same user", async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<LoginScreen />);
      await Promise.resolve();
    });

    expect(mockRouter.replace).toHaveBeenCalledWith("/chat/22?requestId=73");

    mockRouter.replace.mockClear();
    mockAuthState = {
      ...mockAuthState,
      user: { id: 15 },
    };
    await act(async () => {
      tree.update(<LoginScreen />);
      await Promise.resolve();
    });
    expect(mockRouter.replace).toHaveBeenCalledWith("/(tabs)");

    act(() => tree.unmount());
  });
});