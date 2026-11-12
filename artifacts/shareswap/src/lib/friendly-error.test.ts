import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  friendlyMessage,
  isNetworkFailure,
  messageForStatus,
} from "./friendly-error";

const REF = "SS-1A2B3C4D";

describe("friendlyMessage", () => {
  test("keeps a deliberate 4xx sentence", () => {
    expect(friendlyMessage(400, { error: "Pick a date in the future." })).toBe("Pick a date in the future.");
    expect(friendlyMessage(401, { message: "Invalid email or password." })).toBe("Invalid email or password.");
  });

  test("a bare error code is not shown", () => {
    expect(friendlyMessage(400, { error: "CONNECT_NOT_ENABLED" })).toBe(GENERIC_ERROR_MESSAGE);
    expect(friendlyMessage(400, { error: "CONNECT_NOT_ENABLED", message: "Payout setup is not available right now." })).toBe("Payout setup is not available right now.");
  });

  test.each([
    'relation "item_requests" does not exist',
    "connect ECONNREFUSED 10.0.0.1:443",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "duplicate key value violates unique constraint",
    "<html><body>Bad gateway</body></html>",
    "Unexpected token < in JSON at position 0",
  ])("technical text is replaced: %s", (technical) => {
    expect(friendlyMessage(400, { error: technical })).toBe(messageForStatus(400));
    expect(friendlyMessage(500, { error: technical })).toBe(GENERIC_ERROR_MESSAGE);
  });

  test("a 5xx shows the server's shielded text with its reference id", () => {
    expect(friendlyMessage(500, { error: "Something went wrong on our side. Please try again in a moment.", referenceId: REF }))
      .toBe(`Something went wrong on our side. Please try again in a moment. (Reference: ${REF})`);
  });

  test("a 5xx without a reference id (a proxy or old server) is the generic text, never the body", () => {
    expect(friendlyMessage(502, { error: "upstream connect error or disconnect/reset before headers" })).toBe(GENERIC_ERROR_MESSAGE);
    expect(friendlyMessage(500, null)).toBe(GENERIC_ERROR_MESSAGE);
  });
});

describe("isNetworkFailure", () => {
  test("recognises what browsers throw", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error("x"), { status: 400 }))).toBe(false);
  });
});

describe("apiRequest errors (web)", () => {
  const originalFetch = globalThis.fetch;
  let apiRequest: typeof import("./queryClient").apiRequest;

  beforeEach(async () => {
    vi.resetModules();
    // The module fetches a CSRF token as soon as it loads.
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) as typeof fetch;
    ({ apiRequest } = await import("./queryClient"));
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("a non-JSON 500 never shows its body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("Internal Server Error: ECONNREFUSED at db.js:12", { status: 500 })) as typeof fetch;
    const err = await apiRequest("GET", "/api/items").catch((e: any) => e);
    expect(err.status).toBe(500);
    expect(err.message).toBe(GENERIC_ERROR_MESSAGE);
  });

  test("a body's message cannot overwrite the friendly text, and the reference id shows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Something went wrong on our side. Please try again in a moment.", message: 'relation "x" does not exist', referenceId: REF }), { status: 500 }),
    ) as typeof fetch;
    const err = await apiRequest("GET", "/api/items").catch((e: any) => e);
    expect(err.message).toContain(`(Reference: ${REF})`);
    expect(err.message).not.toContain("relation");
    expect(err.referenceId).toBe(REF);
  });

  test("a deliberate 4xx message and code survive", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "TERMS_ACCEPTANCE_REQUIRED", error: "Please accept the updated Terms to continue." }), { status: 403 }),
    ) as typeof fetch;
    const err = await apiRequest("GET", "/api/user").catch((e: any) => e);
    expect(err.code).toBe("TERMS_ACCEPTANCE_REQUIRED");
    expect(err.message).toBe("Please accept the updated Terms to continue.");
  });

  test("a failed fetch becomes one readable message", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as typeof fetch;
    const err = await apiRequest("GET", "/api/items").catch((e: any) => e);
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(err.code).toBe("NETWORK_ERROR");
  });
});
