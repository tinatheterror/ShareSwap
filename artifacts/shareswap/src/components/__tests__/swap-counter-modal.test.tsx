import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SwapCounterModal } from "../swap-counter-modal";

// Round two of a swap counter: the person countering sees the other person's current counter preselected, not the original offer.

const item = (id: number, name: string, ownerId: number, tier = 2) => ({ id, name, photos: [], tier, shareCoinPrice: "10", originalValue: "", ownerId });
const OWNER = 1;
const REQUESTER = 2;
const ownerItems = [item(10, "Tent A", OWNER), item(11, "Tent B", OWNER), item(12, "Tent C", OWNER)];
const requesterItems = [item(20, "Stove X", REQUESTER), item(21, "Stove Y", REQUESTER)];

let viewerIsOwner = false;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    // No partnerId means the signed-in person's own items.
    const partner = /partnerId=(\d+)/.exec(url)?.[1] ?? String(viewerIsOwner ? OWNER : REQUESTER);
    const list = partner === String(OWNER) ? ownerItems : requesterItems;
    return { ok: true, json: async () => list } as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function request(over: Record<string, unknown> = {}) {
  return {
    id: 5, itemId: 10, requestType: "SWAP", status: "PENDING", counterRound: 1, counterNote: null,
    item: item(10, "Tent A", OWNER),
    owner: { id: OWNER, username: "olive", displayName: "Olive" },
    requester: { id: REQUESTER, username: "remy", displayName: "Remy" },
    swapOfferedItemIds: [20], swapOfferedItems: [{ id: 20, name: "Stove X", photos: [], tier: 2 }],
    counterSwapOwnerItemIds: [11], counterSwapRequesterItemIds: [21],
    ...over,
  } as any;
}

function open(req: any, isOwner: boolean) {
  viewerIsOwner = isOwner;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SwapCounterModal open onClose={() => {}} request={req} currentUserId={isOwner ? OWNER : REQUESTER} isOwner={isOwner} isPending={false} onSubmit={() => {}} />
    </QueryClientProvider>,
  );
}

const isSelected = (name: string) => {
  // The name can also appear in the header; the card is the one in the grid.
  const card = screen.getAllByText(name).map((el) => el.closest("div.cursor-pointer")).find(Boolean) as HTMLElement;
  return /border-\[#0DCEA1\]|border-amber-400/.test(card.className);
};

describe("SwapCounterModal preselection", () => {
  it("the requester countering back (round two) sees the owner's counter preselected on both sides", async () => {
    open(request(), false);
    await waitFor(() => expect(screen.getAllByText("Tent B").length).toBeGreaterThan(0));
    expect(isSelected("Tent B")).toBe(true);   // the owner's counter
    expect(isSelected("Stove Y")).toBe(true);  // the requester item the owner countered with
    expect(isSelected("Tent A")).toBe(false);  // the original listing is not
    expect(isSelected("Stove X")).toBe(false); // nor the original offer
  });

  it("the owner countering back sees the requester's counter preselected on both sides", async () => {
    open(request({ counterRound: 1, counterProposedBy: REQUESTER }), true);
    await waitFor(() => expect(screen.getAllByText("Stove Y").length).toBeGreaterThan(0));
    expect(isSelected("Tent B")).toBe(true);
    expect(isSelected("Stove Y")).toBe(true);
    expect(isSelected("Tent A")).toBe(false);
    expect(isSelected("Stove X")).toBe(false);
  });

  it("a first counter starts from the original offer", async () => {
    open(request({ counterRound: 0, counterSwapOwnerItemIds: [], counterSwapRequesterItemIds: [] }), true);
    await waitFor(() => expect(screen.getAllByText("Tent A").length + screen.getAllByText("Stove X").length).toBeGreaterThan(2));
    await waitFor(() => expect(() => isSelected("Tent A")).not.toThrow());
    expect(isSelected("Tent A")).toBe(true);
    expect(isSelected("Stove X")).toBe(true);
  });

  it("a first counter also starts with the extra items the requester asked for, not just the listing item", async () => {
    open(request({
      counterRound: 0, counterSwapOwnerItemIds: [], counterSwapRequesterItemIds: [],
      swapRequestedItemIds: [12], swapRequestedItems: [{ id: 12, name: "Tent C", photos: [], tier: 2 }],
    }), true);
    await waitFor(() => expect(screen.getAllByText("Tent C").length).toBeGreaterThan(0));
    expect(isSelected("Tent A")).toBe(true);  // the listing item
    expect(isSelected("Tent C")).toBe(true);  // the extra item asked for
    expect(isSelected("Tent B")).toBe(false); // an item nobody asked for
  });

  it("a counter item that is missing from the eligible lists is still shown, selected", async () => {
    open(request({
      counterSwapOwnerItemIds: [99], counterSwapOwnerItems: [{ id: 99, name: "Tent Z", photos: [], tier: 2 }],
      counterSwapRequesterItemIds: [98], counterSwapRequesterItems: [{ id: 98, name: "Stove W", photos: [], tier: 2 }],
    }), false);
    await waitFor(() => expect(screen.getAllByText("Stove Y").length).toBeGreaterThan(0));
    expect(isSelected("Tent Z")).toBe(true);
    expect(isSelected("Stove W")).toBe(true);
    expect(isSelected("Tent B")).toBe(false);
  });

  it("when the request is refreshed with a new round while the modal is open, the new counter is preselected", async () => {
    viewerIsOwner = false;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (req: any) => (
      <QueryClientProvider client={client}>
        <SwapCounterModal open onClose={() => {}} request={req} currentUserId={REQUESTER} isOwner={false} isPending={false} onSubmit={() => {}} />
      </QueryClientProvider>
    );
    const first = request({ counterRound: 0, counterSwapOwnerItemIds: [], counterSwapRequesterItemIds: [] });
    const { rerender } = render(view(first));
    await waitFor(() => expect(screen.getAllByText("Tent B").length).toBeGreaterThan(0));
    expect(isSelected("Tent A")).toBe(true);
    await act(async () => { rerender(view(request({ counterRound: 1 }))); });
    await waitFor(() => expect(isSelected("Tent B")).toBe(true));
    expect(isSelected("Stove Y")).toBe(true);
    expect(isSelected("Tent A")).toBe(false);
  });
});
