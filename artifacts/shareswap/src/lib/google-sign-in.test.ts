import { describe, expect, it } from "vitest";
import { googleSignInHref, isEmbeddedBrowser } from "./google-sign-in";

describe("Google sign-in outside embedded preview", () => {
  it("detects a standalone browser", () => {
    const page = {};
    expect(isEmbeddedBrowser({ self: page, top: page })).toBe(false);
  });

  it("detects an embedded preview", () => {
    expect(isEmbeddedBrowser({ self: {}, top: {} })).toBe(true);
  });

  it("opens outside a frame even when the parent cannot be inspected", () => {
    expect(isEmbeddedBrowser({
      self: {},
      get top() { throw new Error("Cross-origin frame"); },
    })).toBe(true);
  });

  it("keeps sign-in on the current app instead of a published host", () => {
    expect(googleSignInHref("", "/")).toBe("/api/auth/google");
    expect(googleSignInHref("", "/shareswap/")).toBe("/shareswap/api/auth/google");
  });

  it("preserves and safely encodes referral codes", () => {
    expect(googleSignInHref(" A&B ", "/")).toBe("/api/auth/google?ref=A%26B");
    expect(googleSignInHref("  ", "/")).toBe("/api/auth/google");
  });
});