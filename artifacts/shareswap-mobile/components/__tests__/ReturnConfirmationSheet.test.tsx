import React from "react";
import { act } from "react";
import { Alert } from "react-native";
import renderer from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReturnConfirmationSheet } from "../ReturnConfirmationSheet";
import { apiPost } from "@/lib/api";

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
  const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
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

  expect(alertSpy).toHaveBeenCalledWith(
    "Could not confirm return",
    "Return confirmation is temporarily unavailable",
  );
  expect(tree.root.findByProps({ testID: "submit-confirm-return" })).toBeTruthy();
  alertSpy.mockRestore();
});