import { describe, expect, it } from "vitest";
import {
  capabilityForRequestType,
  isLocked,
  lockedPrompt,
  needsEmailVerification,
  readCapabilities,
} from "./verification-capabilities";

const unverified = { canSwap: false, canClaimGift: false, canList: false, canBorrow: false, canRent: false, missing: ["email", "id", "card"] };
const account = { canSwap: true, canClaimGift: true, canList: true, canBorrow: false, canRent: false, missing: ["id", "card"] };
const full = { canSwap: true, canClaimGift: true, canList: true, canBorrow: true, canRent: true, missing: [] };

describe("verification capabilities from the server", () => {
  it("an unverified person is locked out of everything and is asked for their email first", () => {
    for (const flag of ["canSwap", "canClaimGift", "canList", "canBorrow", "canRent"] as const) {
      expect(isLocked(unverified as any, flag)).toBe(true);
    }
    expect(lockedPrompt(unverified as any)).toBe("email");
    expect(needsEmailVerification(unverified as any)).toBe(true);
  });

  it("a verified account can swap, claim and list, but borrowing and renting ask for ID and a card", () => {
    expect(isLocked(account as any, "canSwap")).toBe(false);
    expect(isLocked(account as any, "canClaimGift")).toBe(false);
    expect(isLocked(account as any, "canList")).toBe(false);
    expect(isLocked(account as any, "canBorrow")).toBe(true);
    expect(isLocked(account as any, "canRent")).toBe(true);
    expect(lockedPrompt(account as any)).toBe("id-and-card");
    expect(needsEmailVerification(account as any)).toBe(false);
    expect(readCapabilities(account as any)?.missing).toEqual(["id", "card"]);
  });

  it("a fully verified person is not locked from anything", () => {
    for (const flag of ["canSwap", "canClaimGift", "canList", "canBorrow", "canRent"] as const) {
      expect(isLocked(full as any, flag)).toBe(false);
    }
    expect(readCapabilities(full as any)?.missing).toEqual([]);
  });

  it("does not guess when the server sent no flags: nothing is locked and the server decides", () => {
    expect(readCapabilities({ id: 1 } as any)).toBeNull();
    expect(isLocked({ id: 1 } as any, "canBorrow")).toBe(false);
    expect(needsEmailVerification(null)).toBe(false);
  });

  it("maps each request type to the flag that gates it", () => {
    expect(capabilityForRequestType("SWAP")).toBe("canSwap");
    expect(capabilityForRequestType("GIFT")).toBe("canClaimGift");
    expect(capabilityForRequestType("BORROW")).toBe("canBorrow");
    expect(capabilityForRequestType("RENT")).toBe("canRent");
  });
});
