import { apiGet, apiPost, setApiSession } from "../api";
import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  friendlyMessage,
  isNetworkFailure,
  messageForStatus,
} from "../friendlyError";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "9.9.9" }, nativeBuildVersion: "42" },
}));

function response(status: number, body: unknown, raw?: string): Response {
  const text = raw ?? JSON.stringify(body);
  return {
    status, ok: status >= 200 && status < 300, statusText: "",
    json: async () => body,
    text: async () => text,
    clone: () => response(status, body, raw),
  } as Response;
}

const mockFetch = jest.fn();
const originalFetch = global.fetch;
beforeEach(() => { mockFetch.mockReset(); global.fetch = mockFetch; setApiSession(false); });
afterEach(() => { global.fetch = originalFetch; });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fail(p: Promise<unknown>): Promise<any> {
  try { await p; } catch (e) { return e; }
  throw new Error("expected the request to fail");
}

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

  test("a malformed reference id is ignored", () => {
    expect(friendlyMessage(500, { error: "Something went wrong.", referenceId: "<script>" })).toBe("Something went wrong.");
  });

  test("status text for a body that is not JSON", () => {
    expect(friendlyMessage(404, null)).toBe("We couldn't find that.");
    expect(friendlyMessage(429, null)).toMatch(/Too many requests/);
    expect(friendlyMessage(413, null)).toMatch(/too large/);
  });
});

describe("isNetworkFailure", () => {
  test("recognises what fetch throws on React Native and in browsers", () => {
    expect(isNetworkFailure(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error("x"), { status: 400 }))).toBe(false);
    expect(isNetworkFailure("nope")).toBe(false);
  });
});

describe("apiRequest errors", () => {
  test("a non-JSON 500 never shows its body", async () => {
    mockFetch.mockResolvedValue(response(500, null, "Internal Server Error: ECONNREFUSED at db.js:12"));
    const err = await fail(apiGet("/api/items"));
    expect(err.status).toBe(500);
    expect(err.message).toBe(GENERIC_ERROR_MESSAGE);
  });

  test("an HTML error page never shows its markup", async () => {
    mockFetch.mockResolvedValue(response(502, null, "<!DOCTYPE html><html><body>Bad Gateway</body></html>"));
    const err = await fail(apiGet("/api/items"));
    expect(err.message).toBe(GENERIC_ERROR_MESSAGE);
  });

  test("a body's message cannot overwrite the friendly text", async () => {
    mockFetch.mockResolvedValue(response(500, { error: "relation \"x\" does not exist", message: "pg: boom" }));
    const err = await fail(apiGet("/api/items"));
    expect(err.message).toBe(GENERIC_ERROR_MESSAGE);
  });

  test("the reference id reaches the message and the error", async () => {
    mockFetch.mockResolvedValue(response(500, { error: "Something went wrong on our side. Please try again in a moment.", referenceId: REF }));
    const err = await fail(apiGet("/api/items"));
    expect(err.message).toContain(`(Reference: ${REF})`);
    expect(err.referenceId).toBe(REF);
  });

  test("structured fields and a deliberate 4xx message survive", async () => {
    mockFetch.mockResolvedValue(response(403, { code: "TERMS_ACCEPTANCE_REQUIRED", error: "Please accept the updated Terms to continue." }));
    const err = await fail(apiGet("/api/user"));
    expect(err.code).toBe("TERMS_ACCEPTANCE_REQUIRED");
    expect(err.message).toBe("Please accept the updated Terms to continue.");
  });

  test("a failed fetch becomes one readable message", async () => {
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));
    const err = await fail(apiGet("/api/items"));
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(err.code).toBe("NETWORK_ERROR");
  });

  test("a failed CSRF fetch on a write is also readable", async () => {
    setApiSession(true);
    mockFetch.mockRejectedValue(new TypeError("Network request failed"));
    const err = await fail(apiPost("/api/items", { name: "x" }));
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE);
  });
});
