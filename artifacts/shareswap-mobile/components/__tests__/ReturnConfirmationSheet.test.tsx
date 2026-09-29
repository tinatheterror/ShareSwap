import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReturnConfirmationSheet } from "../ReturnConfirmationSheet";
import { apiPost } from "@/lib/api";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ refetchUser: jest.fn() }),
}));

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    card: "#ffffff",
    foreground: "#111111",
    mutedForeground: "#666666",
    muted: "#f5f5f5",
    border: "#dddddd",
    background: "#ffffff",
  }),
}));

jest.mock("@/lib/api", () => ({
  apiPost: jest.fn(),
  apiRequest: jest.fn(),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: object) => React.createElement(View, props) };
});

jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("expo-image-picker", () => ({}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

test("a failed owner confirmation shows a visible error", async () => {
  const error = new Error("Return confirmation is temporarily unavailable");
  jest.mocked(apiPost).mockRejectedValueOnce(error);
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <QueryClientProvider client={client}>
        <ReturnConfirmationSheet
          visible
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          requestId={42}
          itemName="Tent"
          depositAmount={25}
          userRole="owner"
        />
      </QueryClientProvider>,
    );
  });

  const submit = tree.root.findByProps({ testID: "submit-confirm-return" });

  await act(async () => {
    submit.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(tree.root.findAllByProps({ children: error.message }).length).toBeGreaterThan(0);
  expect(tree.root.findByProps({ testID: "submit-confirm-return" })).toBeTruthy();
  act(() => tree.unmount());
  client.clear();
});

test("an expired session offers sign-in instead of silently retrying the return", async () => {
  const error = Object.assign(new Error("Your session has expired."), { status: 401 });
  jest.mocked(apiPost).mockRejectedValueOnce(error);
  mockPush.mockClear();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });

  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <QueryClientProvider client={client}>
        <ReturnConfirmationSheet
          visible
          onClose={jest.fn()}
          onSuccess={jest.fn()}
          requestId={42}
          itemName="Tent"
          depositAmount={25}
          userRole="borrower"
        />
      </QueryClientProvider>,
    );
  });

  await act(async () => {
    tree.root.findByProps({ testID: "submit-borrower-return" }).props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(tree.root.findAllByProps({ testID: "return-submit-error" }).length).toBeGreaterThan(0);
  expect(tree.root.findAllByProps({
    children: "Your sign-in has expired. Sign in again, then reopen this chat to return the item.",
  }).length).toBeGreaterThan(0);
  act(() => tree.root.findByProps({ testID: "return-sign-in" }).props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/login?session_expired=1");
  act(() => tree.unmount());
  client.clear();
});