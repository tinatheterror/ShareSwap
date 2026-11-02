import React, { act } from "react";
import renderer from "react-test-renderer";
import { Alert } from "react-native";

const mockRegister = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0d9488", primaryForeground: "#ffffff", foreground: "#0f172a",
    mutedForeground: "#64748b", muted: "#f1f5f9", background: "#ffffff", card: "#ffffff", border: "#e2e8f0",
  }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ register: mockRegister }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: mockReplace }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("@/lib/legalLinks", () => ({
  openLegalLink: jest.fn(),
  PRIVACY_URL: "https://shareswap.app/privacy",
  TERMS_URL: "https://shareswap.app/terms",
  GUIDELINES_URL: "https://shareswap.app/community-guidelines",
}));

import RegisterScreen from "../../app/register";
import { openLegalLink } from "@/lib/legalLinks";

const find = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findByProps({ testID });
const inputs = (tree: renderer.ReactTestRenderer) => tree.root.findAll((n) => typeof n.type === "string" && typeof n.props.onChangeText === "function");

describe("Create account asks for explicit agreement", () => {
  let tree: renderer.ReactTestRenderer;
  let alert: jest.SpyInstance;

  beforeEach(async () => {
    mockRegister.mockClear();
    mockReplace.mockClear();
    (openLegalLink as jest.Mock).mockClear();
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await act(async () => { tree = renderer.create(<RegisterScreen />); });
    const [first, second, third] = inputs(tree);
    await act(async () => {
      first.props.onChangeText("Avery Smith");
      second.props.onChangeText("avery@example.com");
      third.props.onChangeText("a-good-password");
    });
  });
  afterEach(() => {
    act(() => { tree.unmount(); });
    alert.mockRestore();
  });

  test("the button is disabled and nothing is sent until the box is ticked", async () => {
    expect(find(tree, "create-account-button").props.disabled).toBe(true);
    await act(async () => { find(tree, "create-account-button").props.onPress(); });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  test("ticking the box enables the button and the register call says the terms were accepted", async () => {
    await act(async () => { find(tree, "accept-terms-checkbox").props.onPress(); });
    expect(find(tree, "accept-terms-checkbox").props.accessibilityState).toEqual({ checked: true });
    expect(find(tree, "create-account-button").props.disabled).toBe(false);
    await act(async () => { find(tree, "create-account-button").props.onPress(); });
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister.mock.calls[0][0]).toMatchObject({ acceptedTerms: true, email: "avery@example.com" });
  });

  test("unticking it again blocks the sign-up again", async () => {
    await act(async () => { find(tree, "accept-terms-checkbox").props.onPress(); });
    await act(async () => { find(tree, "accept-terms-checkbox").props.onPress(); });
    expect(find(tree, "create-account-button").props.disabled).toBe(true);
  });

  test("the agreement links to the Terms and the Community Guidelines", async () => {
    const links = tree.root.findAll((n) => n.props.accessibilityRole === "link" && typeof n.props.onPress === "function");
    for (const link of links) act(() => { link.props.onPress(); });
    const opened = (openLegalLink as jest.Mock).mock.calls.map((c) => c[0]);
    expect(opened).toEqual(expect.arrayContaining(["https://shareswap.app/terms", "https://shareswap.app/community-guidelines", "https://shareswap.app/privacy"]));
  });
});
