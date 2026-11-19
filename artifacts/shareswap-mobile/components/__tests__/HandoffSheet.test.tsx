import React from "react";
import { act } from "react";
import renderer from "react-test-renderer";
import { HandoffSheet } from "../HandoffSheet";
import { apiGet } from "@/lib/api";

// Code-only handoff screens: the requester enters the code or reports a problem; the owner sees the same code or reports a problem.

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: "s", Warning: "w" } }));
jest.mock("@/hooks/useRequestChangeHaptics", () => ({ markOwnConfirm: jest.fn() }));
jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({ primary: "#0DCEA1", foreground: "#111", mutedForeground: "#666", card: "#fff", muted: "#f5f5f5", border: "#ddd", background: "#fff" }),
}));
jest.mock("@/lib/api", () => ({ apiGet: jest.fn(), apiPost: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

const state = (over: Record<string, unknown> = {}) => ({
  hideManualConfirm: true, reportProblem: true, oneCode: true, autoConfirm: false,
  role: "requester", otherName: "Olive", locked: false, lockedUntil: null, minutesRemaining: 0, ...over,
});

function mockApi(stateBody: object, pin: object = { pin: "4821", pinUsed: false, expired: false }) {
  (apiGet as jest.Mock).mockImplementation((path: string) =>
    Promise.resolve(path.endsWith("/handoff-code-state") ? stateBody : pin));
}

async function render(role: "owner" | "borrower") {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <HandoffSheet visible onClose={jest.fn()} onSuccess={jest.fn()} requestId={7} userRole={role} itemName="Tent" />,
    );
  });
  return tree;
}

const texts = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

beforeEach(() => jest.clearAllMocks());

test("requester: asks the owner by name for the code, one helper line, report a problem, no manual confirm", async () => {
  mockApi(state());
  const out = texts(await render("borrower"));
  expect(out).toContain("Ask Olive for the handoff code");
  expect(out).toContain("Only enter the code once you have the item.");
  expect(out).toContain("Report a problem");
  expect(out).not.toContain("Confirm without code");
});

test("requester: with HANDOFF_HIDE_MANUAL_CONFIRM off, 'Confirm without code' comes back", async () => {
  mockApi(state({ hideManualConfirm: false, reportProblem: false }));
  const out = texts(await render("borrower"));
  expect(out).toContain("Confirm without code");
  expect(out).toContain("Item was not received?");
});

test("requester: during a lockout it says how long, and offers no entry boxes", async () => {
  mockApi(state({ locked: true, minutesRemaining: 12 }));
  const tree = await render("borrower");
  expect(texts(tree)).toContain("Too many tries. Try again in 12 minutes.");
  expect(tree.root.findAllByProps({ keyboardType: "number-pad" })).toHaveLength(0);
});

test("owner: always shows the code with the in-person or chat line, and can report a problem", async () => {
  mockApi(state({ role: "owner", otherName: "Remy" }));
  const out = texts(await render("owner"));
  expect(out).toContain("4821");
  expect(out).toContain("You can show this in person or send it in chat once you've handed the item over.");
  expect(out).toContain("Report a problem");
  expect(out).not.toContain("automatically in 24 hours");
});
