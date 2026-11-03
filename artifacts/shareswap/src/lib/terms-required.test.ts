import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("a write refused for unaccepted Terms", () => {
  it("surfaces the code and refetches the user so the acceptance screen opens", async () => {
    document.cookie = "x-csrf-token=abc";
    // The module fetches a CSRF token as it loads, so the fake fetch must exist before it is imported.
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).includes("csrf-token")
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ code: "TERMS_ACCEPTANCE_REQUIRED", message: "Please accept the updated Terms of Service and Community Guidelines to continue." }), { status: 403 }),
    ));
    vi.resetModules();
    const { apiRequest, queryClient } = await import("./queryClient");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await expect(apiRequest("POST", "/api/messages", { content: "hi" })).rejects.toMatchObject({ status: 403, code: "TERMS_ACCEPTANCE_REQUIRED" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/user"] });
  });
});
