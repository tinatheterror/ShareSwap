import { apiGet, apiPost, onSessionExpired, setApiSession } from "../api";
import { resumeDestination } from "../sessionNavigation";

function response(status: number, body: unknown = {}): Response {
  return {
    status, ok: status >= 200 && status < 300, statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone: () => response(status, body),
  } as Response;
}

const mockFetch = jest.fn();
let expired: jest.Mock;
let unsubscribe: () => void;
const originalFetch = global.fetch;

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
  setApiSession(false);
  expired = jest.fn();
  unsubscribe = onSessionExpired(expired);
});
afterEach(() => { unsubscribe(); global.fetch = originalFetch; });

test("a first signed-out visit is not treated as expiration", async () => {
  mockFetch.mockResolvedValue(response(401));
  await expect(apiGet("/api/user")).rejects.toMatchObject({ status: 401 });
  expect(expired).not.toHaveBeenCalled();
});

test("chat expiration emits once and blocks subsequent protected polling and actions", async () => {
  setApiSession(true);
  mockFetch.mockResolvedValue(response(401));
  await Promise.allSettled([apiGet("/api/messages/2"), apiGet("/api/requests")]);
  expect(expired).toHaveBeenCalledTimes(1);
  const networkCalls = mockFetch.mock.calls.length;
  for (let i = 0; i < 4; i++) {
    await expect(apiGet("/api/messages/2")).rejects.toMatchObject({ status: 401 });
    await expect(apiGet("/api/requests")).rejects.toMatchObject({ status: 401 });
  }
  await expect(apiPost("/api/messages/2", { content: "hello" })).rejects.toMatchObject({ status: 401 });
  expect(mockFetch).toHaveBeenCalledTimes(networkCalls);
});

test("bad credentials are not a session expiration", async () => {
  setApiSession(true);
  mockFetch.mockResolvedValueOnce(response(200, { csrfToken: "test-only" }))
    .mockResolvedValueOnce(response(401, { error: "Invalid credentials" }));
  await expect(apiPost("/api/login", {})).rejects.toThrow("Invalid credentials");
  expect(expired).not.toHaveBeenCalled();
});

test("sign-in and its verification still work after expiration, then polling resumes", async () => {
  setApiSession(true);
  mockFetch.mockResolvedValueOnce(response(401));
  await expect(apiGet("/api/messages/2")).rejects.toMatchObject({ status: 401 });
  mockFetch.mockResolvedValueOnce(response(200, { csrfToken: "test-only" }))
    .mockResolvedValueOnce(response(200, { id: 1 }))
    .mockResolvedValueOnce(response(200, { id: 1 }));
  await apiPost("/api/login", {});
  await expect(apiGet("/api/user", { sessionProbe: true })).resolves.toEqual({ id: 1 });
  setApiSession(true);
  mockFetch.mockResolvedValueOnce(response(200, []));
  await expect(apiGet("/api/messages/2")).resolves.toEqual([]);
  expect(expired).toHaveBeenCalledTimes(1);
});

test("a late 401 from the previous session cannot expire a new sign-in", async () => {
  setApiSession(true);
  let resolve!: (value: Response) => void;
  mockFetch.mockReturnValueOnce(new Promise<Response>((r) => { resolve = r; }));
  const pending = apiGet("/api/messages/2");
  setApiSession(true);
  resolve(response(401));
  await expect(pending).rejects.toMatchObject({ status: 401 });
  expect(expired).not.toHaveBeenCalled();
});

test("late JSON bodies cannot restore private query data after expiration", async () => {
  setApiSession(true);
  let resolve!: (value: unknown) => void;
  const delayed = response(200);
  delayed.json = () => new Promise((r) => { resolve = r; });
  mockFetch.mockResolvedValueOnce(delayed);
  const pending = apiGet("/api/requests");
  // Allow fetch and apiRequest to finish so JSON reading has started.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  mockFetch.mockResolvedValueOnce(response(401));
  await expect(apiGet("/api/messages/2")).rejects.toMatchObject({ status: 401 });
  resolve([{ private: true }]);
  await expect(pending).rejects.toMatchObject({ status: 401 });
});

test("a 401 after CSRF refresh follows the same expiration path", async () => {
  setApiSession(true);
  mockFetch.mockResolvedValueOnce(response(200, { csrfToken: "test-only" }))
    .mockResolvedValueOnce(response(403, { error: "CSRF token invalid" }))
    .mockResolvedValueOnce(response(200, { csrfToken: "test-refresh" }))
    .mockResolvedValueOnce(response(401));
  await expect(apiPost("/api/messages/2", {})).rejects.toMatchObject({ status: 401 });
  expect(expired).toHaveBeenCalledTimes(1);
});

test("public browsing is still available after expiration", async () => {
  setApiSession(true);
  mockFetch.mockResolvedValueOnce(response(401));
  await expect(apiGet("/api/messages/2")).rejects.toMatchObject({ status: 401 });
  mockFetch.mockResolvedValueOnce(response(200, []));
  await expect(apiGet("/api/items")).resolves.toEqual([]);
});

test("only the same user can resume a safe local screen; actions are not replayed", () => {
  expect(resumeDestination("/chat/2?requestId=42", "1", 1)).toBe("/chat/2?requestId=42");
  expect(resumeDestination("/chat/2?requestId=42", "1", 3)).toBe("/(tabs)");
  for (const url of ["https://example.com", "//example.com", "/login", "/chat/2?confirmReturn=1", "/api/requests/42/return"]) {
    expect(resumeDestination(url, "1", 1)).toBe("/(tabs)");
  }
});