/**
 * The banner follows the server's `missing` list: it shows for an unverified account and for nobody else.
 */
import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@expo/vector-icons", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Feather: (props: object) => React.createElement(View, props) };
});

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0DCEA1",
    foreground: "#0c0a09",
    mutedForeground: "#78716c",
    card: "#ffffff",
    muted: "#f5f5f4",
    border: "#e7e5e4",
    background: "#F3F4F6",
    radius: 14,
  }),
}));

let mockUser: object | null = null;
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser, resendVerification: jest.fn() }),
}));

import { EmailVerificationBanner } from "../EmailVerificationBanner";

function render() {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<EmailVerificationBanner />);
  });
  return tree;
}

const flags = { canSwap: true, canClaimGift: true, canList: true, canBorrow: false, canRent: false };

describe("EmailVerificationBanner", () => {
  it("shows for an unverified account", () => {
    mockUser = { id: 1, ...flags, canSwap: false, canClaimGift: false, canList: false, missing: ["email", "id", "card"] };
    expect(render().toJSON()).not.toBeNull();
  });

  it("is hidden for a verified account, with or without ID and card", () => {
    mockUser = { id: 1, ...flags, missing: ["id", "card"] };
    expect(render().toJSON()).toBeNull();
    mockUser = { id: 1, ...flags, canBorrow: true, canRent: true, missing: [] };
    expect(render().toJSON()).toBeNull();
  });

  it("is hidden when the server sent no flags, and when nobody is signed in", () => {
    mockUser = { id: 1 };
    expect(render().toJSON()).toBeNull();
    mockUser = null;
    expect(render().toJSON()).toBeNull();
  });
});
