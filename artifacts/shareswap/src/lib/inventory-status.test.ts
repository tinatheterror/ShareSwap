import { describe, expect, it } from "vitest";
import { getInventoryStatus } from "./inventory-status";

const gift = (status: string) => ({ id: 1, requestType: "GIFT", status });
const base = { id: 1, name: "x", photos: [], isAvailable: false, isSwapped: false, isGifted: false, listingExpiresAt: null, activeRequest: null } as any;

describe("an item that was given away or swapped is never 'unavailable' (so never offers a relist)", () => {
  it("shows Gifted when the server says it was gifted, even if a later request outranks the gift", () => {
    const item = { ...base, isGifted: true, activeRequest: { id: 2, requestType: "BORROW", status: "COMPLETED_EARLY" } };
    expect(getInventoryStatus(item).status).toBe("gifted");
  });
  it("shows Gifted when the completed gift is the request on the item", () => {
    expect(getInventoryStatus({ ...base, activeRequest: gift("COMPLETED") }).status).toBe("gifted");
  });
  it("shows Swapped for an item flagged swapped, even if it is listed again", () => {
    expect(getInventoryStatus({ ...base, isSwapped: true, isAvailable: true }).status).toBe("swapped");
  });
  it("still shows an ordinary unlisted item as Unavailable (the only status with a Relist button)", () => {
    expect(getInventoryStatus(base).status).toBe("unavailable");
  });
});
