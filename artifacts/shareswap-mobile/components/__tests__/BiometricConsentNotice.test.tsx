import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { BiometricConsentNotice, biometricPolicyUrl, type BiometricConsent } from "../BiometricConsentNotice";
import { openLegalLink } from "@/lib/legalLinks";

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#0DCEA1", foreground: "#0c0a09", mutedForeground: "#78716c", border: "#e7e5e4", card: "#fff" }),
}));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("@/lib/legalLinks", () => ({ PRIVACY_URL: "https://shareswap.app/privacy", openLegalLink: jest.fn() }));

const consent: BiometricConsent = {
  version: "2026-11-09",
  notice: "Persona will collect your ID images and a selfie to match your face to your ID. ShareSwap receives only the result and your name.",
  checkboxLabel: "I agree to ShareSwap and Persona collecting and using my ID and face data for identity verification.",
  policyPath: "/privacy#identity-verification-and-face-matching",
  consented: false,
  consentedAt: null,
};

function render(props: Partial<React.ComponentProps<typeof BiometricConsentNotice>> = {}) {
  let r!: renderer.ReactTestRenderer;
  act(() => { r = renderer.create(<BiometricConsentNotice consent={consent} agreed={false} onAgreedChange={() => {}} {...props} />); });
  return r;
}
const byId = (r: renderer.ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id)[0];
const text = (r: renderer.ReactTestRenderer) => JSON.stringify(r.toJSON());

beforeEach(() => jest.clearAllMocks());

test("shows the notice, the checkbox wording and an unchecked required checkbox", () => {
  const r = render();
  expect(text(r)).toContain("ShareSwap receives only the result and your name");
  expect(text(r)).toContain(consent.checkboxLabel);
  const box = byId(r, "biometric-checkbox");
  expect(box.props.accessibilityRole).toBe("checkbox");
  expect(box.props.accessibilityState).toEqual({ checked: false });
});

test("tapping the checkbox reports the new value, and a ticked box reads as checked", () => {
  const onAgreedChange = jest.fn();
  const r = render({ onAgreedChange });
  act(() => { byId(r, "biometric-checkbox").props.onPress(); });
  expect(onAgreedChange).toHaveBeenCalledWith(true);
  const ticked = render({ agreed: true, onAgreedChange });
  expect(byId(ticked, "biometric-checkbox").props.accessibilityState).toEqual({ checked: true });
  act(() => { byId(ticked, "biometric-checkbox").props.onPress(); });
  expect(onAgreedChange).toHaveBeenLastCalledWith(false);
});

test("the link opens the Privacy Policy section", () => {
  const r = render();
  act(() => { byId(r, "biometric-policy-link").props.onPress(); });
  expect(openLegalLink).toHaveBeenCalledWith("https://shareswap.app/privacy#identity-verification-and-face-matching");
  expect(biometricPolicyUrl(consent.policyPath)).toBe("https://shareswap.app/privacy#identity-verification-and-face-matching");
});

test("once agreed at the current wording it says so and shows no checkbox; with no consent data it shows nothing", () => {
  const agreed = render({ consent: { ...consent, consented: true, consentedAt: "2026-11-09T12:00:00.000Z" } });
  expect(byId(agreed, "biometric-agreed")).toBeTruthy();
  expect(agreed.root.findAll((n) => n.props.testID === "biometric-checkbox")).toHaveLength(0);
  expect(render({ consent: undefined }).toJSON()).toBeNull();
});
