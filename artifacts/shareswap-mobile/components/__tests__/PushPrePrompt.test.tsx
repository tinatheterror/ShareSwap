/**
 * The explanation screen is hidden until the push hook asks for it, and its buttons call the accept/dismiss handlers.
 */
import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";

let mockListener: ((pending: boolean) => void) | null = null;
const mockAccept = jest.fn();
const mockDismiss = jest.fn();

jest.mock("@/hooks/usePushNotifications", () => ({
  subscribePushPrePrompt: (listener: (pending: boolean) => void) => {
    mockListener = listener;
    listener(false);
    return () => { mockListener = null; };
  },
  acceptPushPrePrompt: () => mockAccept(),
  dismissPushPrePrompt: () => mockDismiss(),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: object) => React.createElement(View, props) };
});

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1",
    primaryForeground: "#002319",
    foreground: "#0c0a09",
    mutedForeground: "#78716c",
    background: "#ffffff",
    muted: "#f5f5f4",
  }),
}));

import { PushPrePrompt } from "../PushPrePrompt";

function texts(tree: renderer.ReactTestRenderer) {
  return JSON.stringify(tree.toJSON());
}

describe("PushPrePrompt", () => {
  let tree: renderer.ReactTestRenderer;
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => { tree = renderer.create(<PushPrePrompt />); });
  });

  it("shows nothing until the hook asks for it", () => {
    expect(texts(tree)).not.toContain("Turn on notifications");
    act(() => { mockListener?.(true); });
    expect(texts(tree)).toContain("Turn on notifications");
  });

  it("runs the accept and dismiss handlers from its buttons", () => {
    act(() => { mockListener?.(true); });
    const [accept, notNow] = tree.root.findAll(
      (node) => node.props.accessibilityRole === "button" && typeof node.props.onPress === "function",
    );
    act(() => { accept.props.onPress(); });
    expect(mockAccept).toHaveBeenCalledTimes(1);
    act(() => { notNow.props.onPress(); });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
