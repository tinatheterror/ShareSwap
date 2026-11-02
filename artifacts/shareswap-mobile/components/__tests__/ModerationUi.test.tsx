import React, { act } from "react";
import renderer from "react-test-renderer";
import { Alert, Text } from "react-native";

const mockInvalidate = jest.fn();
const mockUseQuery = jest.fn();
const mockRefetchUser = jest.fn().mockResolvedValue(1);
let mockUser: Record<string, unknown> | null = null;

jest.mock("@/hooks/useColors", () => ({
  useColors: () => ({
    primary: "#0d9488", primaryForeground: "#ffffff", foreground: "#0f172a",
    mutedForeground: "#64748b", muted: "#f1f5f9", background: "#ffffff", card: "#ffffff", border: "#e2e8f0",
  }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@expo/vector-icons", () => {
  const { View } = require("react-native");
  const mockReact = require("react");
  return { Feather: (props: object) => mockReact.createElement(View, props) };
});
jest.mock("expo-router", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/lib/api", () => ({ apiPost: jest.fn(), apiGet: jest.fn(), apiDelete: jest.fn(), photoUrl: (p: string) => p }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, refetchUser: mockRefetchUser }) }));
jest.mock("@/lib/legalLinks", () => ({
  openLegalLink: jest.fn(),
  TERMS_URL: "https://shareswap.app/terms",
  GUIDELINES_URL: "https://shareswap.app/community-guidelines",
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
  useQuery: (options: unknown) => mockUseQuery(options),
  useMutation: (options: { mutationFn: (v: unknown) => Promise<unknown>; onSuccess?: () => void; onError?: (e: unknown) => void }) => ({
    isPending: false,
    mutate: (variables: unknown) => options.mutationFn(variables).then(options.onSuccess, options.onError),
  }),
}));
jest.mock("@/lib/moderation", () => ({
  ...jest.requireActual("@/lib/moderation"),
  submitReport: jest.fn(),
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
  fetchBlockedUsers: jest.fn(),
}));

import { ReportSheet } from "@/components/ReportSheet";
import { TermsGate } from "@/components/TermsGate";
import { useModeration } from "@/components/ModerationActions";
import BlockedUsersScreen from "../../app/blocked-users";
import { apiPost } from "@/lib/api";
import { blockUser, submitReport, unblockUser } from "@/lib/moderation";

const find = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findByProps({ testID });
const maybe = (tree: renderer.ReactTestRenderer, testID: string) => tree.root.findAllByProps({ testID });
const press = async (tree: renderer.ReactTestRenderer, testID: string) => { await act(async () => { find(tree, testID).props.onPress(); }); };
const flush = () => act(async () => { await Promise.resolve(); });

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = null;
  mockUseQuery.mockReset();
  (submitReport as jest.Mock).mockResolvedValue({ id: 1, status: "open", alreadyReported: false });
  (blockUser as jest.Mock).mockResolvedValue({ blocked: true });
  (unblockUser as jest.Mock).mockResolvedValue({ blocked: false });
  (apiPost as jest.Mock).mockResolvedValue({});
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

describe("ReportSheet", () => {
  const render = async (props: Partial<React.ComponentProps<typeof ReportSheet>> = {}) => {
    let tree!: renderer.ReactTestRenderer;
    const onClose = jest.fn();
    await act(async () => {
      tree = renderer.create(<ReportSheet visible onClose={onClose} targetType="item" targetId={41} targetLabel="this listing" authorId={7} authorName="Avery" {...props} />);
    });
    return { tree, onClose };
  };

  test("nothing can be sent until a reason is chosen", async () => {
    const { tree } = await render();
    expect(find(tree, "report-submit").props.disabled).toBe(true);
    await press(tree, "report-submit");
    expect(submitReport).not.toHaveBeenCalled();
  });

  test("sends the reason and the note for what is being reported, then thanks the person", async () => {
    const { tree, onClose } = await render();
    await press(tree, "report-reason-scam");
    await act(async () => { find(tree, "report-details").props.onChangeText("Asks for payment outside the app"); });
    expect(find(tree, "report-submit").props.disabled).toBe(false);
    await press(tree, "report-submit");
    expect(submitReport).toHaveBeenCalledWith({ targetType: "item", targetId: 41, reason: "scam", details: "Asks for payment outside the app" });
    expect(blockUser).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Thanks for letting us know", expect.stringContaining("Nobody is told who reported"));
  });

  test("offers to block the author in the same step, and does it only when asked", async () => {
    const { tree } = await render();
    await press(tree, "report-reason-harassment");
    await press(tree, "report-also-block");
    expect(find(tree, "report-also-block").props.accessibilityState).toEqual({ checked: true });
    await press(tree, "report-submit");
    expect(blockUser).toHaveBeenCalledWith(7);
    expect(mockInvalidate).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][1]).toContain("Avery can no longer contact you");
  });

  test("a report with no known author has no block option", async () => {
    const { tree } = await render({ authorId: null });
    expect(maybe(tree, "report-also-block")).toHaveLength(0);
  });

  test("a refusal from the server is shown on the sheet and nothing else happens", async () => {
    (submitReport as jest.Mock).mockRejectedValue(new Error("You've sent a lot of reports. Please try again later."));
    const { tree, onClose } = await render();
    await press(tree, "report-reason-spam");
    await press(tree, "report-submit");
    expect(find(tree, "report-error").props.children).toBe("You've sent a lot of reports. Please try again later.");
    expect(onClose).not.toHaveBeenCalled();
    expect(blockUser).not.toHaveBeenCalled();
    expect(find(tree, "report-submit").props.disabled).toBe(false);
  });

  test("if the report is filed but the block fails, it says so instead of claiming both worked", async () => {
    (blockUser as jest.Mock).mockRejectedValue(new Error("Something broke"));
    const { tree } = await render();
    await press(tree, "report-reason-hate");
    await press(tree, "report-also-block");
    await press(tree, "report-submit");
    expect(submitReport).toHaveBeenCalled();
    expect(alertSpy.mock.calls[0][1]).toContain("couldn't block Avery");
  });
});

describe("TermsGate", () => {
  const render = async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<TermsGate />); });
    return tree;
  };

  test("shows nothing to someone who is signed out or has accepted", async () => {
    expect(maybe(await render(), "terms-gate")).toHaveLength(0);
    mockUser = { id: 1, termsAcceptanceRequired: false, currentTermsVersion: "2026-11-02" };
    expect(maybe(await render(), "terms-gate")).toHaveLength(0);
  });

  test("blocks until the box is ticked, then records the current version and refreshes the user", async () => {
    mockUser = { id: 1, termsAcceptanceRequired: true, currentTermsVersion: "2026-11-02" };
    const tree = await render();
    expect(find(tree, "terms-gate-accept").props.disabled).toBe(true);
    await press(tree, "terms-gate-checkbox");
    expect(find(tree, "terms-gate-accept").props.disabled).toBe(false);
    await press(tree, "terms-gate-accept");
    expect(apiPost).toHaveBeenCalledWith("/api/account/accept-terms", { version: "2026-11-02" });
    expect(mockRefetchUser).toHaveBeenCalled();
  });

  test("says so when the server refuses, and does not pretend it worked", async () => {
    mockUser = { id: 1, termsAcceptanceRequired: true, currentTermsVersion: "2026-11-02" };
    (apiPost as jest.Mock).mockRejectedValue(new Error("The Terms were updated. Please read the latest version and accept again."));
    const tree = await render();
    await press(tree, "terms-gate-checkbox");
    await press(tree, "terms-gate-accept");
    expect(find(tree, "terms-gate-error").props.children).toMatch(/Terms were updated/);
    expect(mockRefetchUser).not.toHaveBeenCalled();
  });
});

describe("Blocked users", () => {
  const people = [
    { userId: 5, username: "ben-handle", displayName: "Ben", profilePhoto: null, blockedAt: "2026-11-01T00:00:00Z" },
    { userId: 6, username: "cara-handle", displayName: null, profilePhoto: null, blockedAt: "2026-11-02T00:00:00Z" },
  ];

  const render = async () => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<BlockedUsersScreen />); });
    return tree;
  };

  test("lists who is blocked, with a name that is never an email address", async () => {
    mockUseQuery.mockReturnValue({ data: people, isLoading: false, error: null, refetch: jest.fn() });
    const tree = await render();
    expect(find(tree, "blocked-user-5")).toBeTruthy();
    expect(find(tree, "blocked-user-6")).toBeTruthy();
    const words = tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join(""));
    expect(words).toContain("Ben");
    expect(words).toContain("cara-handle");
    expect(words.some((w) => w.includes("@"))).toBe(false);
  });

  test("shows an empty state when nobody is blocked", async () => {
    mockUseQuery.mockReturnValue({ data: [], isLoading: false, error: null, refetch: jest.fn() });
    const tree = await render();
    expect(find(tree, "blocked-users-empty")).toBeTruthy();
  });

  test("unblocking asks first, then unblocks and refreshes what a block changes", async () => {
    mockUseQuery.mockReturnValue({ data: people, isLoading: false, error: null, refetch: jest.fn() });
    const tree = await render();
    await press(tree, "unblock-5");
    expect(unblockUser).not.toHaveBeenCalled();
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Unblock Ben?");
    await act(async () => { buttons.find((b: { text: string }) => b.text === "Unblock").onPress(); });
    await flush();
    expect(unblockUser).toHaveBeenCalledWith(5);
    expect(mockInvalidate).toHaveBeenCalled();
  });
});

describe("useModeration", () => {
  function Harness({ onBlocked }: { onBlocked?: () => void }) {
    const moderation = useModeration({ onBlocked });
    return (
      <>
        {moderation.sheet}
        {React.createElement("View", { testID: "menu", onPress: () => moderation.userMenu(9, "Dana") })}
        {React.createElement("View", { testID: "block", onPress: () => moderation.confirmBlock(9, "Dana") })}
        {React.createElement("View", { testID: "report", onPress: () => moderation.report({ targetType: "message", targetId: 3, label: "this message", authorId: 9, authorName: "Dana" }) })}
      </>
    );
  }
  const render = async (onBlocked?: () => void) => {
    let tree!: renderer.ReactTestRenderer;
    await act(async () => { tree = renderer.create(<Harness onBlocked={onBlocked} />); });
    return tree;
  };

  test("blocking asks first, says what it does, then blocks and tells the screen", async () => {
    const onBlocked = jest.fn();
    const tree = await render(onBlocked);
    await press(tree, "block");
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Block Dana?");
    expect(message).toMatch(/full refund and no penalty/);
    expect(blockUser).not.toHaveBeenCalled();
    await act(async () => { await buttons.find((b: { text: string }) => b.text === "Block").onPress(); });
    expect(blockUser).toHaveBeenCalledWith(9);
    expect(mockInvalidate).toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalled();
  });

  test("a failed block does not tell the screen it worked", async () => {
    (blockUser as jest.Mock).mockRejectedValue(new Error("Nope"));
    const onBlocked = jest.fn();
    const tree = await render(onBlocked);
    await press(tree, "block");
    await act(async () => { await alertSpy.mock.calls[0][2].find((b: { text: string }) => b.text === "Block").onPress(); });
    expect(onBlocked).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenLastCalledWith("Couldn't block", "Nope");
  });

  test("the person menu offers report, block and cancel; report opens the sheet for that person", async () => {
    const tree = await render();
    await press(tree, "menu");
    const [title, , buttons] = alertSpy.mock.calls[0];
    expect(title).toBe("Dana");
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(["Report", "Block", "Cancel"]);
    await act(async () => { buttons[0].onPress(); });
    expect(find(tree, "report-sheet")).toBeTruthy();
  });

  test("reporting a message opens the sheet for that message with its author", async () => {
    const tree = await render();
    await press(tree, "report");
    await press(tree, "report-reason-sexual");
    await press(tree, "report-submit");
    expect(submitReport).toHaveBeenCalledWith({ targetType: "message", targetId: 3, reason: "sexual", details: "" });
  });
});
