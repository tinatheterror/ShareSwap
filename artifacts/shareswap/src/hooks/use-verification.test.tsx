import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/hooks/use-auth";
import { useVerification } from "./use-verification";

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const levels = {
  unverified: { canSwap: false, canClaimGift: false, canList: false, canBorrow: false, canRent: false, missing: ["email", "id", "card"] },
  account: { canSwap: true, canClaimGift: true, canList: true, canBorrow: false, canRent: false, missing: ["id", "card"] },
  full: { canSwap: true, canClaimGift: true, canList: true, canBorrow: true, canRent: true, missing: [] },
};

function hookFor(user: object | null) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthContext.Provider value={{ user: user as any, isLoading: false, error: null } as any}>{children}</AuthContext.Provider>
  );
  return renderHook(() => useVerification(), { wrapper });
}

describe("useVerification follows the server's flags", () => {
  it("unverified: every action is blocked with a verify-your-email prompt", () => {
    toast.mockClear();
    const { result } = hookFor(levels.unverified);
    const action = vi.fn();
    for (const flag of ["canSwap", "canClaimGift", "canList", "canBorrow", "canRent"] as const) {
      result.current.requireCapability(flag, action);
    }
    expect(action).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(5);
    expect(toast.mock.calls[0][0].title).toBe("Verify your email first");
  });

  it("verified account: swap, claim and list run; borrow and rent are blocked without the email prompt", () => {
    toast.mockClear();
    const { result } = hookFor(levels.account);
    const allowed = vi.fn();
    for (const flag of ["canSwap", "canClaimGift", "canList"] as const) result.current.requireCapability(flag, allowed);
    expect(allowed).toHaveBeenCalledTimes(3);

    const blocked = vi.fn();
    result.current.requireCapability("canBorrow", blocked);
    result.current.requireCapability("canRent", blocked);
    expect(blocked).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("fully verified: everything runs", () => {
    const { result } = hookFor(levels.full);
    const action = vi.fn();
    for (const flag of ["canSwap", "canClaimGift", "canList", "canBorrow", "canRent"] as const) {
      result.current.requireCapability(flag, action);
    }
    expect(action).toHaveBeenCalledTimes(5);
    expect(result.current.capabilities?.missing).toEqual([]);
  });
});
