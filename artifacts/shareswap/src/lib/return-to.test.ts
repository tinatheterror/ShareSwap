import { describe, expect, it } from "vitest";
import { rememberReturnTo, safeReturnTo, takeReturnTo } from "./return-to";

const memory = () => {
  const data = new Map<string, string>();
  return { setItem: (k: string, v: string) => void data.set(k, v), getItem: (k: string) => data.get(k) ?? null, removeItem: (k: string) => void data.delete(k) };
};

describe("safeReturnTo", () => {
  it("accepts a plain path on this site", () => {
    expect(safeReturnTo("/delete-account")).toBe("/delete-account");
    expect(safeReturnTo("/")).toBe("/");
  });

  it("refuses anything that could leave the site or carry markup", () => {
    for (const bad of ["https://evil.example/x", "//evil.example", "/\\evil", "javascript:alert(1)", "/a?b=c", "/a#b", "delete-account", "", null, undefined]) {
      expect(safeReturnTo(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("remembering the page across a sign-in", () => {
  it("keeps a safe path once, and forgets an unsafe one", () => {
    const storage = memory();
    rememberReturnTo("?returnTo=%2Fdelete-account", storage);
    expect(takeReturnTo(storage)).toBe("/delete-account");
    expect(takeReturnTo(storage)).toBeNull();

    rememberReturnTo("?returnTo=https%3A%2F%2Fevil.example", storage);
    expect(takeReturnTo(storage)).toBeNull();
  });
});
