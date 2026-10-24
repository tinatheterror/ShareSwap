import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
import { confirmCheckoutReturn } from "./checkout-return";

describe("confirmCheckoutReturn", () => {
  it("confirms the Checkout session named in the return URL", async () => {
    const post = vi.fn().mockResolvedValue({});
    await confirmCheckoutReturn("?sub_success=true&session_id=cs_live_a1B2", post as any);
    expect(post).toHaveBeenCalledWith("POST", "/api/subscription/confirm", { sessionId: "cs_live_a1B2" });
  });

  it("does nothing without a success flag or with a missing or malformed session id", async () => {
    const post = vi.fn();
    for (const search of ["", "?sub_canceled=true", "?sub_success=true", "?session_id=cs_test_1", "?sub_success=true&session_id=%7BCHECKOUT_SESSION_ID%7D", "?sub_success=true&session_id=sub_123"]) {
      await confirmCheckoutReturn(search, post as any);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it("swallows a failed confirm so the page can still refresh the plan", async () => {
    const post = vi.fn().mockRejectedValue(new Error("500: Failed"));
    await expect(confirmCheckoutReturn("?sub_success=true&session_id=cs_test_1", post as any)).resolves.toBeUndefined();
  });
});
