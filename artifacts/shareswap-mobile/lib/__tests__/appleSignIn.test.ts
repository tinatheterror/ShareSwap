jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("expo-apple-authentication", () => ({
  isAvailableAsync: jest.fn(),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock("expo-crypto", () => ({
  getRandomBytesAsync: jest.fn(async () => new Uint8Array(32).fill(171)),
  digestStringAsync: jest.fn(async (_alg: string, value: string) => `sha256(${value})`),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

import * as AppleAuthentication from "expo-apple-authentication";
import { AppleSignInCancelled, appleSignInPayload, requestAppleCredential } from "../appleSignIn";

const signIn = AppleAuthentication.signInAsync as jest.Mock;
const RAW = "ab".repeat(32);

describe("Sign in with Apple payload", () => {
  test("keeps the token and code, and sends the name only when Apple gave one", () => {
    expect(appleSignInPayload({ identityToken: "t", authorizationCode: "c", fullName: null }, "n")).toEqual({ identityToken: "t", authorizationCode: "c", nonce: "n" });
    expect(appleSignInPayload({ identityToken: "t", authorizationCode: "c", fullName: { givenName: null, familyName: null } as never }, "n")).not.toHaveProperty("fullName");
    expect(appleSignInPayload({ identityToken: "t", authorizationCode: "c", fullName: { givenName: "Ana", familyName: null } as never }, "n").fullName).toEqual({ givenName: "Ana", familyName: null });
  });

  test("refuses a credential with no identity token or code", () => {
    expect(() => appleSignInPayload({ identityToken: null, authorizationCode: "c", fullName: null }, "n")).toThrow(/did not return/);
    expect(() => appleSignInPayload({ identityToken: "t", authorizationCode: null, fullName: null }, "n")).toThrow(/did not return/);
  });
});

describe("requestAppleCredential", () => {
  beforeEach(() => signIn.mockReset());

  test("gives Apple the hash of a random nonce and returns the raw nonce for the server", async () => {
    signIn.mockResolvedValue({ identityToken: "t", authorizationCode: "c", fullName: null });
    const payload = await requestAppleCredential();
    expect(payload.nonce).toBe(RAW);
    expect(signIn.mock.calls[0][0].nonce).toBe(`sha256(${RAW})`);
    expect(signIn.mock.calls[0][0].requestedScopes).toEqual([0, 1]);
  });

  test("maps the person closing the sheet to AppleSignInCancelled and passes other errors through", async () => {
    signIn.mockRejectedValue(Object.assign(new Error("x"), { code: "ERR_REQUEST_CANCELED" }));
    await expect(requestAppleCredential()).rejects.toBeInstanceOf(AppleSignInCancelled);
    signIn.mockRejectedValue(new Error("network"));
    await expect(requestAppleCredential()).rejects.toThrow("network");
  });
});
