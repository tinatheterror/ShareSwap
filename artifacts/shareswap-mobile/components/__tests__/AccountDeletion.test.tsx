import React, { act } from "react";
import renderer from "react-test-renderer";
import { Alert, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AccountDeletionSheet } from "../AccountDeletionSheet";
import { DeletionPendingBanner } from "../DeletionPendingBanner";
import type { DeletionEligibility } from "@/lib/accountDeletion";

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockLogout = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/hooks/useColors", () => ({ useColors: () => ({ card: "#fff", border: "#ddd", background: "#fff", foreground: "#000", mutedForeground: "#666", muted: "#eee" }) }));
jest.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: 1 }, logout: mockLogout }) }));
jest.mock("@/lib/api", () => ({
  apiGet: (...a: unknown[]) => mockApiGet(...a),
  apiPost: (...a: unknown[]) => mockApiPost(...a),
}));

const base: DeletionEligibility = {
  eligible: true,
  blockers: [],
  autoResolve: { requests: 0 },
  wallet: { available: "0.00", pending: "0.00", tier: "none", forfeitedOnDeletion: "0.00", requiresForfeitAcknowledgement: false, withdrawalOffer: null },
  willEnd: { subscription: false },
};
const forfeit: DeletionEligibility = {
  ...base,
  wallet: { ...base.wallet, available: "0.40", tier: "forfeit", forfeitedOnDeletion: "0.40", requiresForfeitAcknowledgement: true },
};

const text = (tree: renderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join("")).join(" | ");
const byId = (tree: renderer.ReactTestRenderer, id: string) => tree.root.findAllByProps({ testID: id }).filter((n) => typeof n.type === "string" || n.props.onPress);
const press = async (tree: renderer.ReactTestRenderer, id: string) => {
  const node = tree.root.findAllByProps({ testID: id }).find((n) => n.props.onPress);
  if (!node) throw new Error(`nothing to press with testID ${id}`);
  await act(async () => { node.props.onPress(); });
  await settle();
};
const isDisabled = (tree: renderer.ReactTestRenderer, id: string) => !!tree.root.findAllByProps({ testID: id }).find((n) => "disabled" in n.props)?.props.disabled;

// Queries resolve in turns (the banner's second query waits on the first), so let several turns pass.
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};

async function render(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  });
  await settle();
  return { tree, invalidate };
}

beforeEach(() => {
  mockApiGet.mockReset();
  mockApiPost.mockReset();
  mockLogout.mockReset().mockResolvedValue(undefined);
  mockPush.mockReset();
  mockReplace.mockReset();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("AccountDeletionSheet", () => {
  test("shows what blocks the deletion, offers the way to deal with it, and cannot continue", async () => {
    mockApiGet.mockResolvedValue({
      ...base, eligible: false,
      blockers: [{ code: "open_requests", count: 1, message: "Finish or cancel your open rentals, borrows, swaps and gifts first." }],
    });
    const { tree } = await render(<AccountDeletionSheet visible onClose={() => {}} />);
    expect(mockApiGet).toHaveBeenCalledWith("/api/account/deletion-eligibility");
    expect(text(tree)).toContain("Finish or cancel your open rentals");
    expect(text(tree)).toContain("Open transactions");
    expect(isDisabled(tree, "deletion-continue")).toBe(true);
  });

  test("a balance that would be forfeited must be acknowledged before the final step, and the final confirm sends it", async () => {
    mockApiGet.mockResolvedValue(forfeit);
    mockApiPost.mockResolvedValue({ status: "pending_deletion" });
    const onClose = jest.fn();
    const { tree, invalidate } = await render(<AccountDeletionSheet visible onClose={onClose} />);
    expect(byId(tree, "deletion-wallet-forfeit").length).toBeGreaterThan(0);
    expect(text(tree)).toContain("$0.40");
    expect(isDisabled(tree, "deletion-continue")).toBe(true);

    await press(tree, "deletion-forfeit-check");
    expect(isDisabled(tree, "deletion-continue")).toBe(false);
    await press(tree, "deletion-continue");

    expect(isDisabled(tree, "deletion-final-confirm")).toBe(true);
    await press(tree, "deletion-final-check");
    expect(isDisabled(tree, "deletion-final-confirm")).toBe(false);
    await press(tree, "deletion-final-confirm");

    expect(mockApiPost).toHaveBeenCalledWith("/api/account/deletion/request", { acknowledgeForfeit: true });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["account-status"] });
    expect(onClose).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Deletion requested", expect.stringContaining("14 days"));
  });

  test("with no balance there is nothing to acknowledge", async () => {
    mockApiGet.mockResolvedValue(base);
    const { tree } = await render(<AccountDeletionSheet visible onClose={() => {}} />);
    expect(byId(tree, "deletion-forfeit-check")).toHaveLength(0);
    expect(isDisabled(tree, "deletion-continue")).toBe(false);
  });

  test("a $1 to $10 balance explains the waived minimum", async () => {
    mockApiGet.mockResolvedValue({
      ...base,
      wallet: { available: "5.00", pending: "0.00", tier: "offer_withdrawal", forfeitedOnDeletion: "5.00", requiresForfeitAcknowledgement: false, withdrawalOffer: { amount: "5.00", minimumWaived: true, canWithdraw: true } },
    });
    const { tree } = await render(<AccountDeletionSheet visible onClose={() => {}} />);
    expect(text(tree)).toContain("minimum is waived");
    expect(isDisabled(tree, "deletion-continue")).toBe(true);
  });

  test("a refused request goes back to the review and says why", async () => {
    mockApiGet.mockResolvedValue(base);
    mockApiPost.mockRejectedValue(new Error("Finish what is still open before deleting your account."));
    const { tree } = await render(<AccountDeletionSheet visible onClose={() => {}} />);
    await press(tree, "deletion-continue");
    await press(tree, "deletion-final-check");
    await press(tree, "deletion-final-confirm");
    expect(Alert.alert).toHaveBeenCalledWith("Couldn't request deletion", "Finish what is still open before deleting your account.");
    expect(byId(tree, "deletion-continue").length).toBeGreaterThan(0);
  });
});

describe("DeletionPendingBanner", () => {
  const pendingStatus = { accountStatus: "pending_deletion", deletionScheduledFor: "2099-11-13T12:00:00.000Z" };
  const answer = (status: unknown, eligibility: unknown = base) =>
    mockApiGet.mockImplementation(async (path: string) => (path === "/api/account/status" ? status : eligibility));

  test("renders nothing for an account that is not pending deletion", async () => {
    answer({ accountStatus: "active" });
    const { tree } = await render(<DeletionPendingBanner />);
    expect(byId(tree, "deletion-pending-banner")).toHaveLength(0);
  });

  test("shows the date, and Cancel calls the cancel endpoint and refreshes the status", async () => {
    answer(pendingStatus);
    mockApiPost.mockResolvedValue({ status: "active" });
    const { tree, invalidate } = await render(<DeletionPendingBanner />);
    expect(text(tree)).toContain("Your account will be deleted on");
    expect(text(tree)).toContain("2099");
    await press(tree, "deletion-cancel-button");
    expect(mockApiPost).toHaveBeenCalledWith("/api/account/deletion/cancel", {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["account-status"] });
  });

  test("a small balance can be withdrawn from the banner", async () => {
    answer(pendingStatus, {
      ...base,
      wallet: { available: "5.00", pending: "0.00", tier: "offer_withdrawal", forfeitedOnDeletion: "5.00", requiresForfeitAcknowledgement: false, withdrawalOffer: { amount: "5.00", minimumWaived: true, canWithdraw: true } },
    });
    const { tree } = await render(<DeletionPendingBanner />);
    await press(tree, "deletion-withdraw-button");
    expect(mockPush).toHaveBeenCalledWith("/wallet");
  });

  test("Delete now needs its own confirmation, then deletes, signs out and leaves", async () => {
    answer(pendingStatus);
    mockApiPost.mockResolvedValue({ status: "deleted" });
    const { tree } = await render(<DeletionPendingBanner />);
    expect(mockApiPost).not.toHaveBeenCalled();
    await press(tree, "deletion-delete-now-button");
    expect(mockApiPost).not.toHaveBeenCalled();
    await press(tree, "deletion-delete-now-confirm");
    expect(mockApiPost).toHaveBeenCalledWith("/api/account/deletion/confirm", { confirmDeletion: true });
    expect(mockLogout).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  test("Delete now is refused while something still blocks it", async () => {
    answer(pendingStatus, { ...base, eligible: false, blockers: [{ code: "open_claims", message: "A security claim involving you is still open." }] });
    const { tree } = await render(<DeletionPendingBanner />);
    await press(tree, "deletion-delete-now-button");
    expect(text(tree)).toContain("A security claim involving you is still open.");
    expect(isDisabled(tree, "deletion-delete-now-confirm")).toBe(true);
  });
});
