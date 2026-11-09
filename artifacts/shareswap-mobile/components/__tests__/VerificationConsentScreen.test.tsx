import React from "react";
import { act } from "react";
import { Linking } from "react-native";
import renderer from "react-test-renderer";
import { useQuery } from "@tanstack/react-query";
import VerificationScreen from "@/app/verification";
import { apiRequest } from "@/lib/api";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
  useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }),
  // A mutation that runs its function when mutateAsync is called, like the real one.
  useMutation: (opts: any) => ({ mutateAsync: async (v?: unknown) => { try { return await opts.mutationFn(v); } catch (e) { opts.onError?.(e); throw e; } }, mutate: jest.fn(), isPending: false }),
}));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#0DCEA1", primaryForeground: "#002319", foreground: "#0c0a09", mutedForeground: "#78716c", card: "#fff", muted: "#f5f5f4", border: "#e7e5e4", accent: "#f5f5f4", background: "#F3F4F6", success: "#16a34a", destructive: "#dc2626", radius: 14 }),
}));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
jest.mock("@/lib/api", () => ({ apiGet: jest.fn(), apiRequest: jest.fn(), BASE_URL: "https://app.example" }));
jest.mock("@/lib/legalLinks", () => ({ PRIVACY_URL: "https://shareswap.app/privacy", openLegalLink: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});

const consent = {
  version: "2026-11-09",
  notice: "Persona will collect your ID images and a selfie to match your face to your ID. ShareSwap receives only the result and your name.",
  checkboxLabel: "I agree to ShareSwap and Persona collecting and using my ID and face data for identity verification.",
  policyPath: "/privacy#identity-verification-and-face-matching",
  consented: false,
  consentedAt: null,
};
const status = { status: "unverified", legalFullName: null, submittedAt: null, verifiedAt: null, failureReason: null };

function mount(state: Record<string, unknown>) {
  (useQuery as jest.Mock).mockImplementation(({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "biometric-consent" ? { data: state, isLoading: false } : { data: status, isLoading: false, refetch: jest.fn() });
  let r!: renderer.ReactTestRenderer;
  act(() => { r = renderer.create(<VerificationScreen />); });
  return r;
}
const byId = (r: renderer.ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id)[0];
const press = async (r: renderer.ReactTestRenderer, id: string) => { await act(async () => { await byId(r, id).props.onPress(); }); };
const calls = () => (apiRequest as jest.Mock).mock.calls.map(([method, url, body]) => `${method} ${url}${body ? ` ${JSON.stringify(body)}` : ""}`);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
  (apiRequest as jest.Mock).mockImplementation(async (_m: string, url: string) => ({ ok: true, json: async () => (url === "/api/persona/create-inquiry" ? { inquiryId: "inq_1" } : {}) }));
});

test("Start Verification is disabled until the box is ticked, and pressing it sends nothing before then", async () => {
  const r = mount(consent);
  expect(byId(r, "start-verification").props.disabled).toBe(true);
  await press(r, "start-verification");
  expect(calls()).toEqual([]);
  act(() => { byId(r, "biometric-checkbox").props.onPress(); });
  expect(byId(r, "start-verification").props.disabled).toBe(false);
});

test("records the agreement for the version shown, then starts the Persona inquiry and opens it", async () => {
  const r = mount(consent);
  act(() => { byId(r, "biometric-checkbox").props.onPress(); });
  await press(r, "start-verification");
  expect(calls()).toEqual([
    `POST /api/biometric-consent ${JSON.stringify({ version: "2026-11-09", agreed: true })}`,
    "POST /api/persona/create-inquiry",
  ]);
  expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining("https://inquiry.withpersona.com/verify?inquiry-id=inq_1"));
});

test("does not start the inquiry or open Persona when the agreement cannot be recorded", async () => {
  (apiRequest as jest.Mock).mockImplementation(async (_m: string, url: string) =>
    url === "/api/biometric-consent" ? { ok: false, json: async () => ({ message: "The notice has changed. Please read it again." }) } : { ok: true, json: async () => ({ inquiryId: "inq_1" }) });
  const r = mount(consent);
  act(() => { byId(r, "biometric-checkbox").props.onPress(); });
  await press(r, "start-verification");
  expect(calls().some((c) => c.includes("create-inquiry"))).toBe(false);
  expect(Linking.openURL).not.toHaveBeenCalled();
  expect(JSON.stringify(r.toJSON())).toContain("The notice has changed");
});

test("with consent already recorded there is no checkbox and the inquiry starts directly", async () => {
  const r = mount({ ...consent, consented: true, consentedAt: "2026-11-09T12:00:00.000Z" });
  expect(byId(r, "biometric-checkbox")).toBeUndefined();
  expect(byId(r, "start-verification").props.disabled).toBe(false);
  await press(r, "start-verification");
  expect(calls()).toEqual(["POST /api/persona/create-inquiry"]);
});
