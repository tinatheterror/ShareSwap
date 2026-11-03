import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const identify = vi.fn();
const setCustomFields = vi.fn();
const init = vi.fn();

beforeEach(() => {
  vi.resetModules();
  identify.mockReset();
  setCustomFields.mockReset();
  init.mockReset();
  (window as any).uj = { init, identify, setCustomFields, showWidget: vi.fn() };
  (window as any).__userjotInitialized = false;
  vi.stubEnv("VITE_USERJOT_PROJECT_ID", "project-1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as any).uj;
});

describe("the website feedback widget", () => {
  it("is told only the internal user id: no name, email, page URL or other fields", async () => {
    const { useUserJot } = await import("./use-userjot");
    renderHook(() => useUserJot({ userId: 42 }));
    expect(init).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith({ id: "42" });
    expect(Object.keys(identify.mock.calls[0][0])).toEqual(["id"]);
    expect(setCustomFields).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out visitor or when no project is configured", async () => {
    const { useUserJot } = await import("./use-userjot");
    renderHook(() => useUserJot({ userId: undefined }));
    expect(identify).not.toHaveBeenCalled();
    vi.stubEnv("VITE_USERJOT_PROJECT_ID", "");
    renderHook(() => useUserJot({ userId: 42 }));
    expect(identify).not.toHaveBeenCalled();
  });
});
