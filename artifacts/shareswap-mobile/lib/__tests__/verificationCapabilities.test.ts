import {
  isLocked,
  needsEmailVerification,
  promptFor,
  readCapabilities,
  type CapabilityFlag,
} from "../verificationCapabilities";

const ALL: CapabilityFlag[] = ["canSwap", "canClaimGift", "canList", "canBorrow", "canRent"];

const unverified = { canSwap: false, canClaimGift: false, canList: false, canBorrow: false, canRent: false, missing: ["email", "id", "card"] };
const account = { canSwap: true, canClaimGift: true, canList: true, canBorrow: false, canRent: false, missing: ["id", "card"] };
const idOnlyAccount = { ...account, missing: ["card"] };
const full = { canSwap: true, canClaimGift: true, canList: true, canBorrow: true, canRent: true, missing: [] };

describe("verification capabilities from the server", () => {
  it("unverified: everything is locked and the prompt asks for the email first", () => {
    for (const flag of ALL) {
      expect(isLocked(unverified, flag)).toBe(true);
      expect(promptFor(unverified, flag)).toEqual({ kind: "email" });
    }
    expect(needsEmailVerification(unverified)).toBe(true);
  });

  it("verified account: swap, claim and list are open; borrow and rent ask for ID and card", () => {
    for (const flag of ["canSwap", "canClaimGift", "canList"] as const) {
      expect(isLocked(account, flag)).toBe(false);
      expect(promptFor(account, flag)).toBeNull();
    }
    for (const flag of ["canBorrow", "canRent"] as const) {
      expect(isLocked(account, flag)).toBe(true);
      expect(promptFor(account, flag)).toEqual({
        kind: "id-and-card",
        missing: { idVerified: false, paymentVerified: false },
      });
    }
    expect(needsEmailVerification(account)).toBe(false);
  });

  it("only lists what is still missing for the gate modal", () => {
    expect(promptFor(idOnlyAccount, "canBorrow")).toEqual({
      kind: "id-and-card",
      missing: { idVerified: true, paymentVerified: false },
    });
  });

  it("fully verified: nothing is locked", () => {
    for (const flag of ALL) {
      expect(isLocked(full, flag)).toBe(false);
      expect(promptFor(full, flag)).toBeNull();
    }
    expect(readCapabilities(full)?.missing).toEqual([]);
  });

  it("does not guess when the server sent no flags: nothing is locked and the server decides", () => {
    expect(readCapabilities({ id: 1 })).toBeNull();
    expect(isLocked({ id: 1 }, "canBorrow")).toBe(false);
    expect(promptFor(null, "canBorrow")).toBeNull();
    expect(needsEmailVerification(undefined)).toBe(false);
  });
});
