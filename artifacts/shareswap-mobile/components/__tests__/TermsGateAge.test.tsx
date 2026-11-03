import React, { act } from "react";
import renderer from "react-test-renderer";

const mockRefetchUser = jest.fn().mockResolvedValue(1);
const mockLogout = jest.fn().mockResolvedValue(undefined);
let mockUser: Record<string, unknown> | null = null;

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#0d9488", primaryForeground: "#fff", foreground: "#000", mutedForeground: "#666", background: "#fff", card: "#fff", border: "#ddd" }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("@/lib/api", () => ({
  apiGet: jest.fn().mockResolvedValue({ regions: [{ code: "CA-BC", country: "CA", name: "British Columbia", ageOfMajority: 19 }] }),
  apiPost: jest.fn(),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, refetchUser: mockRefetchUser, logout: mockLogout }) }));
jest.mock("@/components/AccountDeletionSheet", () => ({
  AccountDeletionSheet: ({ onClose }: { onClose: () => void }) => {
    const { View } = require("react-native");
    const mockReact = require("react");
    return mockReact.createElement(View, { testID: "deletion-sheet", onClose });
  },
}));
jest.mock("@/lib/legalLinks", () => ({ openLegalLink: jest.fn(), TERMS_URL: "t", GUIDELINES_URL: "g" }));

import { TermsGate } from "@/components/TermsGate";
import { apiPost } from "@/lib/api";

const find = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findByProps({ testID });
const maybe = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findAllByProps({ testID });
const press = async (tree: renderer.ReactTestRenderer, testID: string) => { await act(async () => { find(tree, testID).props.onPress(); }); };

async function mount() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => { tree = renderer.create(<TermsGate />); });
  return tree;
}
async function fillAge(tree: renderer.ReactTestRenderer) {
  await act(async () => { find(tree, "age-dob").props.onChangeText("19900505"); });
  await press(tree, "age-region");
  await press(tree, "age-region-CA-BC");
}

beforeEach(() => {
  (apiPost as jest.Mock).mockReset().mockResolvedValue({});
  mockRefetchUser.mockClear();
});

test("an account that only needs its age checked sees no Terms box and nothing is sent until the age is filled in", async () => {
  mockUser = { id: 1, termsAcceptanceRequired: false, ageConfirmationRequired: true, currentTermsVersion: "v" };
  const tree = await mount();
  expect(maybe(tree, "terms-gate-checkbox")).toHaveLength(0);
  expect(find(tree, "terms-gate-accept").props.disabled).toBe(true);
  await fillAge(tree);
  expect(find(tree, "terms-gate-accept").props.disabled).toBe(false);
  await press(tree, "terms-gate-accept");
  expect((apiPost as jest.Mock).mock.calls).toEqual([["/api/account/confirm-age", { dateOfBirth: "1990-05-05", region: "CA-BC" }]]);
  expect(mockRefetchUser).toHaveBeenCalled();
});

test("when both are missing the age is checked first, then the Terms are accepted", async () => {
  mockUser = { id: 1, termsAcceptanceRequired: true, ageConfirmationRequired: true, currentTermsVersion: "v1" };
  const tree = await mount();
  await fillAge(tree);
  expect(find(tree, "terms-gate-accept").props.disabled).toBe(true);
  await press(tree, "terms-gate-checkbox");
  await press(tree, "terms-gate-accept");
  expect((apiPost as jest.Mock).mock.calls.map((call) => call[0])).toEqual(["/api/account/confirm-age", "/api/account/accept-terms"]);
});

test("an under-age answer is shown and the Terms are not accepted", async () => {
  mockUser = { id: 1, termsAcceptanceRequired: true, ageConfirmationRequired: true, currentTermsVersion: "v1" };
  (apiPost as jest.Mock).mockRejectedValueOnce(Object.assign(new Error("You must be at least 19 to use ShareSwap in British Columbia."), { status: 403, code: "AGE_NOT_ELIGIBLE" }));
  const tree = await mount();
  await fillAge(tree);
  await press(tree, "terms-gate-checkbox");
  await press(tree, "terms-gate-accept");
  expect(JSON.stringify(find(tree, "terms-gate-error").props.children)).toContain("at least 19");
  expect((apiPost as jest.Mock).mock.calls).toHaveLength(1);
  expect(mockRefetchUser).not.toHaveBeenCalled();
});

test("the gate offers Sign out and Delete my account, which opens the existing deletion sheet", async () => {
  mockUser = { id: 1, termsAcceptanceRequired: true, ageConfirmationRequired: false, currentTermsVersion: "v1" };
  const tree = await mount();
  expect(maybe(tree, "deletion-sheet")).toHaveLength(0);
  await press(tree, "terms-gate-sign-out");
  expect(mockLogout).toHaveBeenCalledTimes(1);
  await press(tree, "terms-gate-delete-account");
  expect(maybe(tree, "deletion-sheet").length).toBeGreaterThan(0);
  await act(async () => { maybe(tree, "deletion-sheet")[0].props.onClose(); });
  expect(maybe(tree, "deletion-sheet")).toHaveLength(0);
});
