import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import ChatScreen from "@/app/chat/[id]";

const mockCapturedQueries: Array<{
  queryKey: unknown[];
  enabled?: boolean;
  refetchInterval?: number | false;
}> = [];
let mockUser: { id: number; username: string; shareCoins: number } | null = null;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "2", requestId: "73" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1",
    primaryForeground: "#002319",
    foreground: "#111111",
    mutedForeground: "#666666",
    card: "#ffffff",
    muted: "#f5f5f5",
    border: "#dddddd",
    background: "#ffffff",
  }),
}));

jest.mock("@/lib/api", () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiPatch: jest.fn(),
  photoUrl: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
  useQuery: (options: {
    queryKey: unknown[];
    enabled?: boolean;
    refetchInterval?: number | false;
  }) => {
    mockCapturedQueries.push(options);
    return { data: undefined, isLoading: false, error: null, refetch: jest.fn() };
  },
}));

jest.mock("react-native-keyboard-controller", () => {
  const { View } = require("react-native");
  return { KeyboardAvoidingView: View };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return {
    Feather: (props: object) => React.createElement(View, props),
    MaterialCommunityIcons: (props: object) => React.createElement(View, props),
  };
});

jest.mock("lucide-react-native", () => {
  const React = require("react");
  const { View } = require("react-native");
  return new Proxy({}, { get: () => (props: object) => React.createElement(View, props) });
});

jest.mock("@/components/InsufficientShareCoinsModal", () => ({
  InsufficientShareCoinsModal: () => null,
}));
jest.mock("@/components/PayDepositSheet", () => ({ PayDepositSheet: () => null }));
jest.mock("@/components/PayRentalSheet", () => ({ PayRentalSheet: () => null }));
jest.mock("@/components/HandoffSheet", () => ({ HandoffSheet: () => null }));
jest.mock("@/components/ReturnConfirmationSheet", () => ({ ReturnConfirmationSheet: () => null }));
jest.mock("@/components/PostReturnReviewSheet", () => ({ PostReturnReviewSheet: () => null }));
jest.mock("@/components/CounterProposalSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ExtensionSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ClaimSheet", () => ({ ClaimSheet: () => null }));
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success", Error: "error" },
  ImpactFeedbackStyle: { Light: "light" },
}));

function capturedQuery(key: string) {
  return mockCapturedQueries.find((query) => query.queryKey[0] === key);
}

function protectedQueries() {
  return mockCapturedQueries.filter(
    (query) => query.queryKey[0] !== "/api/users/2/public-profile",
  );
}

function protectedPollingQueries() {
  return protectedQueries().filter((query) => query.refetchInterval !== undefined);
}

function renderChat() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ChatScreen />);
  });
  return tree;
}

beforeEach(() => {
  mockCapturedQueries.length = 0;
  mockUser = null;
});

describe("ChatScreen session query gates", () => {
  it("does not enable private chat queries while signed out", () => {
    const tree = renderChat();

    expect(protectedQueries().length).toBeGreaterThan(0);
    expect(protectedQueries().every((query) => query.enabled === false)).toBe(true);
    expect(protectedPollingQueries().every((query) => query.refetchInterval === false)).toBe(true);

    act(() => tree.unmount());
  });

  it("re-enables authenticated chat queries and polling on the same screen after login", () => {
    mockUser = null;
    const tree = renderChat();

    expect(protectedQueries().every((query) => query.enabled === false)).toBe(true);
    expect(protectedPollingQueries().every((query) => query.refetchInterval === false)).toBe(true);

    mockCapturedQueries.length = 0;
    mockUser = { id: 14, username: "morgan", shareCoins: 5 };
    act(() => {
      tree.update(<ChatScreen />);
    });

    expect(capturedQuery("/api/messages/2")?.enabled).toBe(true);
    expect(capturedQuery("/api/messages/2")?.refetchInterval).toBe(5_000);
    expect(capturedQuery("/api/requests")?.enabled).toBe(true);
    expect(capturedQuery("/api/requests")?.refetchInterval).toBe(8_000);
    expect(capturedQuery("/api/requests/73/lifecycle")?.enabled).toBe(true);
    expect(capturedQuery("/api/requests/73/lifecycle")?.refetchInterval).toBe(8_000);
    expect(capturedQuery("/api/inbox")?.enabled).toBe(true);
    expect(capturedQuery("/api/inbox/archived")?.enabled).toBe(true);
    expect(protectedPollingQueries().every((query) => query.refetchInterval !== false)).toBe(true);

    act(() => tree.unmount());
  });
});