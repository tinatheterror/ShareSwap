import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import ChatScreen from "../../app/chat/[id]";
import { apiGet } from "@/lib/api";

const mockReturnSheet = jest.fn((_props: object) => null);
let mockRequestsUnavailable = false;
let mockRequestQueryFn: (() => unknown) | undefined;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "2", requestId: "42" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, shareCoins: 10 } }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1", foreground: "#111", mutedForeground: "#666",
    card: "#fff", muted: "#f5f5f5", border: "#ddd", background: "#fff",
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
  useQuery: ({ queryKey, queryFn }: { queryKey: unknown[]; queryFn?: () => unknown }) => {
    const key = queryKey[0];
    if (key === "/api/requests") mockRequestQueryFn = queryFn;
    if (key === "/api/requests" && mockRequestsUnavailable) {
      return { data: undefined, isLoading: false, error: new Error("Request feed unavailable"), refetch: jest.fn() };
    }
    if (key === "/api/inbox") return { data: [{
      requestId: 42, partnerId: 2, itemId: 9, itemName: "Tent", itemPhoto: null,
      requestStatus: "IN_PROGRESS",
    }], isLoading: false };
    if (key === "/api/requests") return { data: [{
      id: 42, requestType: "BORROW", status: "RETURN_REQUESTED", requesterId: 2,
      startDate: "2026-08-01", endDate: "2026-08-08", depositMethod: "in_app",
      deliveryMethod: "in_person", negotiationStatus: "terms_accepted",
      counterProposedBy: null, counterStartDate: null, counterEndDate: null,
      counterDepositMethod: null, counterRound: 0, swapOfferedItemIds: null,
      counterSwapOwnerItemIds: null, counterSwapRequesterItemIds: null,
      counterNote: null, trustDepositAmount: 25, trustDepositBaseAmount: 25,
      trustDiscountPercentage: 0, shareCoinAmount: 1, depositStatus: "held",
      handoffConfirmedAt: "2026-08-01", actualHandoffAt: "2026-08-01",
      returnDelayNotifiedAt: null, returnDelayFollowUpNotifiedAt: null,
      depositAuthorizationExpiresAt: null, ownerConfirmedHandoff: true,
      borrowerConfirmedHandoff: true,
      item: { id: 9, name: "Tent", photos: [], ownerId: 1 },
    }] };
    if (key === "/api/requests/42/lifecycle") return { data: {
      lifecycle: {
        requestId: 42, stage: "OVERDUE", deadline: "2026-08-08",
        lateHours: 48, role: "owner", actions: ["confirm_return", "open_claim"],
        deposit: { mode: "authorization", status: "held", amount: 25,
          expiresAt: null, protectionReviewRequired: false },
      },
      claims: [], events: [],
    }, isLoading: false, error: null };
    if (key === "/api/users/2/public-profile") return { data: {
      id: 2, username: "borrower", displayName: "Borrower", profilePhoto: null,
      isVerified: true, reputationScore: 5, lastActiveAt: null, reviewCount: 0,
      averageRating: null, responseTime: null,
    } };
    if (key === "/api/messages/2") return { data: [], isLoading: false };
    return { data: undefined, isLoading: false, error: null };
  },
}));

jest.mock("@/components/ReturnConfirmationSheet", () => ({
  ReturnConfirmationSheet: (props: object) => mockReturnSheet(props),
}));

jest.mock("@/components/InsufficientShareCoinsModal", () => ({ InsufficientShareCoinsModal: () => null }));
jest.mock("@/components/PayDepositSheet", () => ({ PayDepositSheet: () => null }));
jest.mock("@/components/PayRentalSheet", () => ({ PayRentalSheet: () => null }));
jest.mock("@/components/HandoffSheet", () => ({ HandoffSheet: () => null }));
jest.mock("@/components/PostReturnReviewSheet", () => ({ PostReturnReviewSheet: () => null }));
jest.mock("@/components/CounterProposalSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ExtensionSheet", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/ClaimSheet", () => ({ ClaimSheet: () => null }));
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
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));

test("an owner can open return confirmation while the overdue stage remains active", () => {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ChatScreen />);
  });

  const action = tree.root.findByProps({ testID: "confirm-return" });
  expect(action).toBeTruthy();
  expect(mockReturnSheet).toHaveBeenLastCalledWith(expect.objectContaining({
    visible: false,
    userRole: "owner",
    requestId: 42,
  }));

  act(() => action.props.onPress());

  expect(mockReturnSheet).toHaveBeenLastCalledWith(expect.objectContaining({
    visible: true,
    userRole: "owner",
    requestId: 42,
  }));

  act(() => tree.unmount());
});

test("the pinned item remains identifiable when the full request feed fails", () => {
  mockRequestsUnavailable = true;
  let tree!: renderer.ReactTestRenderer;
  try {
    act(() => {
      tree = renderer.create(<ChatScreen />);
    });
    expect(tree.root.findAllByProps({ testID: "retry-request-card" }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ children: "Tent" }).length).toBeGreaterThan(0);
    mockRequestQueryFn?.();
    expect(apiGet).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/requests\?cardRequest=42&refresh=\d+$/),
      { cache: "no-store" },
    );
  } finally {
    act(() => tree?.unmount());
    mockRequestsUnavailable = false;
  }
});