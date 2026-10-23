import React, { act } from "react";
import renderer from "react-test-renderer";
import { Alert, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PendingPlanBanner } from "../PendingPlanBanner";

const mockApiPost = jest.fn();
jest.mock("@expo/vector-icons", () => ({ Feather: () => null }));
jest.mock("@/lib/api", () => ({ apiPost: (...args: unknown[]) => mockApiPost(...args) }));

const pending = { tier: "member" as const, effectiveAt: "2026-11-20T12:00:00.000Z" };

function renderBanner(p: typeof pending | null, currentTier: "free" | "member" | "pro" = "pro") {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, "invalidateQueries");
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <QueryClientProvider client={client}>
        <PendingPlanBanner pending={p} currentTier={currentTier} />
      </QueryClientProvider>,
    );
  });
  return { tree, invalidate };
}

const text = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((n) => [n.props.children].flat().join("")).join(" | ");

beforeEach(() => {
  mockApiPost.mockReset();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

describe("PendingPlanBanner", () => {
  test("shows the pending change with a Keep button named after the current plan", () => {
    const { tree } = renderBanner(pending);
    expect(text(tree)).toContain("Switching to Member on ");
    expect(text(tree)).toContain("Keep Pro");
  });

  test("renders nothing when no change is pending", () => {
    const { tree } = renderBanner(null);
    expect(tree.root.findAllByProps({ testID: "pending-plan-banner" })).toHaveLength(0);
  });

  test("Keep Pro calls keep-plan (no sheet, no body) and refreshes the subscription status", async () => {
    mockApiPost.mockResolvedValue({ released: true });
    const { tree, invalidate } = renderBanner(pending);
    await act(async () => {
      tree.root.findByProps({ testID: "keep-plan-button" }).props.onPress();
    });
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith("/api/subscription/keep-plan", {});
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/subscription/status"] });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test("a failure tells the user and does not refresh as if it worked", async () => {
    mockApiPost.mockRejectedValue(new Error("boom"));
    const { tree, invalidate } = renderBanner(pending);
    await act(async () => {
      tree.root.findByProps({ testID: "keep-plan-button" }).props.onPress();
    });
    expect(Alert.alert).toHaveBeenCalledWith("Couldn't keep your plan", "Please try again.");
    expect(invalidate).not.toHaveBeenCalled();
  });
});
