import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { useQuery } from "@tanstack/react-query";
import DisputeEvidenceScreen from "@/app/dispute-evidence";
import NotificationsScreen from "@/app/notifications";
import { apiRequest } from "@/lib/api";
import { evidenceBody, evidenceProblem } from "@/lib/disputeEvidence";

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockNotifications: any[] = [];

jest.mock("expo-router", () => ({ useRouter: () => mockRouter, router: { push: jest.fn() } }));
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn(), useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("expo-image-picker", () => ({ requestMediaLibraryPermissionsAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#0DCEA1", primaryForeground: "#002319", foreground: "#0c0a09", mutedForeground: "#78716c", card: "#fff", muted: "#f5f5f4", border: "#e7e5e4", accent: "#f5f5f4", background: "#F3F4F6", success: "#16a34a", destructive: "#dc2626", radius: 14 }),
}));
jest.mock("@/lib/api", () => ({ apiGet: jest.fn(), apiRequest: jest.fn() }));
jest.mock("@/hooks/useNotifications", () => ({
  useNotifications: () => ({ notifications: mockNotifications, unreadCount: 0, markAllRead: jest.fn(), markRead: jest.fn() }),
}));
jest.mock("@/lib/notificationChat", () => ({ resolveNotificationChatPath: jest.fn(async () => "/chat/9"), buildNotificationChatPath: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("lucide-react-native", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return new Proxy({}, { get: () => (props: object) => mockReact.createElement(View, props) });
});

const pending = { disputeId: "du_1", requestId: 5, itemName: "Cordless drill", dueBy: "2026-12-01T00:00:00.000Z", requestedAt: "2026-11-20T00:00:00.000Z" };

function render(element: React.ReactElement) {
  let instance!: renderer.ReactTestRenderer;
  act(() => { instance = renderer.create(element); });
  return instance;
}
const byId = (r: renderer.ReactTestRenderer, id: string) => r.root.findAll((n) => n.props.testID === id && typeof n.type === "string" ? true : n.props.testID === id)[0];
const text = (r: renderer.ReactTestRenderer) => JSON.stringify(r.toJSON());

beforeEach(() => {
  jest.clearAllMocks();
  (useQuery as jest.Mock).mockReturnValue({ data: { requests: [pending] }, isLoading: false });
});

test("evidenceProblem needs a note or a photo and respects the limits", () => {
  expect(evidenceProblem("  ", 0)).toMatch(/note, a photo/);
  expect(evidenceProblem("x", 0)).toBeNull();
  expect(evidenceProblem("", 1)).toBeNull();
  expect(evidenceProblem("x".repeat(4001), 0)).toMatch(/too long/);
  expect(evidenceProblem("x", 11)).toMatch(/at most 10/);
  expect(evidenceBody("  hi ", ["/u/a.jpg"])).toEqual({ note: "hi", photoUrls: ["/u/a.jpg"] });
});

test("the screen shows the pending dispute with the plain explanation", () => {
  const r = render(<DisputeEvidenceScreen />);
  const t = text(r);
  expect(t).toContain("Cordless drill");
  expect(t).toContain("You will not be charged");
  expect(t).toContain("We need your evidence by");
});

test("sending needs a note or a photo, then posts the note to the dispute's evidence endpoint", async () => {
  (apiRequest as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  const r = render(<DisputeEvidenceScreen />);
  await act(async () => { byId(r, "evidence-submit").props.onPress(); });
  expect(text(r)).toContain("Add a note, a photo, or both.");
  expect(apiRequest).not.toHaveBeenCalled();

  act(() => { byId(r, "evidence-note").props.onChangeText("Borrower signed for it."); });
  await act(async () => { byId(r, "evidence-submit").props.onPress(); });
  expect(apiRequest).toHaveBeenCalledWith("POST", "/api/disputes/du_1/evidence", { note: "Borrower signed for it.", photoUrls: [] });
  expect(byId(r, "evidence-sent")).toBeTruthy();
});

test("a failed send shows the error and keeps the form", async () => {
  (apiRequest as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ message: "Dispute not found" }) });
  const r = render(<DisputeEvidenceScreen />);
  act(() => { byId(r, "evidence-note").props.onChangeText("x"); });
  await act(async () => { byId(r, "evidence-submit").props.onPress(); });
  expect(text(r)).toContain("Dispute not found");
  expect(byId(r, "evidence-submit")).toBeTruthy();
});

test("tapping the evidence-request notification opens the evidence screen, not the chat", async () => {
  mockNotifications = [{ id: 1, userId: 2, type: "dispute_evidence_requested", title: "Please send us your evidence", message: "m", requestId: 5, itemId: null, isRead: true, createdAt: new Date().toISOString() }];
  const r = render(<NotificationsScreen />);
  const row = r.root.findAll((n) => typeof n.props.onPress === "function")
    .find((n) => n.findAll((c) => Array.isArray(c.children) && c.children.includes("Please send us your evidence")).length > 0)!;
  await act(async () => { await row.props.onPress(); });
  expect(mockRouter.push).toHaveBeenCalledWith("/dispute-evidence");
});
