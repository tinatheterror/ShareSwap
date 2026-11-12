import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";

/**
 * Sign in with Apple on iOS. The app asks Apple for an identity token bound to a nonce: Apple gets the SHA-256 of a
 * random value, and the server gets the raw value, so a stolen token cannot be replayed. Android has no native Apple
 * sign-in, so it (and the web build) uses the server's redirect flow in a browser: Android opens the system browser and
 * the server sends it back into the app with a one-time token.
 */

export type AppleSignInPayload = {
  identityToken: string;
  authorizationCode: string;
  /** The raw nonce; Apple was given its SHA-256 hex. */
  nonce: string;
  /** Present only the first time this Apple ID authorizes ShareSwap. */
  fullName?: { givenName: string | null; familyName: string | null };
};

/** The person closed the Apple sheet. Not an error worth showing. */
export class AppleSignInCancelled extends Error {
  constructor() {
    super("Apple sign-in was cancelled");
    this.name = "AppleSignInCancelled";
  }
}

type Credential = Pick<AppleAuthentication.AppleAuthenticationCredential, "identityToken" | "authorizationCode" | "fullName">;

/** What the server needs from Apple's credential. Throws when Apple returned no token. */
export function appleSignInPayload(credential: Credential, rawNonce: string): AppleSignInPayload {
  if (!credential.identityToken || !credential.authorizationCode) throw new Error("Apple did not return a sign-in token. Please try again.");
  const name = credential.fullName;
  const hasName = !!(name?.givenName || name?.familyName);
  return {
    identityToken: credential.identityToken,
    authorizationCode: credential.authorizationCode,
    nonce: rawNonce,
    ...(hasName ? { fullName: { givenName: name?.givenName ?? null, familyName: name?.familyName ?? null } } : {}),
  };
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** iOS uses Apple's sheet; everything else goes through the browser redirect. */
export const appleSignInUsesBrowser = () => Platform.OS !== "ios";

export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return true;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Where the app remembers which Apple ID signed in on this device (the credential's `user`), to ask Apple later whether it was revoked. */
export const APPLE_USER_KEY = "appleUserId";

/**
 * True when Apple says this device's Apple ID no longer authorizes ShareSwap (the person removed the app under Settings > Apple
 * Account > Sign in with Apple, or the Apple ID is gone). Only REVOKED and NOT_FOUND count: TRANSFERRED, AUTHORIZED, a failed
 * lookup or a non-iOS device never sign anyone out.
 */
export async function appleCredentialRevoked(appleUser: string): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    const state = await AppleAuthentication.getCredentialStateAsync(appleUser);
    return state === AppleAuthentication.AppleAuthenticationCredentialState.REVOKED || state === AppleAuthentication.AppleAuthenticationCredentialState.NOT_FOUND;
  } catch {
    return false;
  }
}

/** Shows Apple's sheet and returns what to send to POST /api/auth/apple/native (plus `appleUser`, which stays on the device). */
export async function requestAppleCredential(): Promise<AppleSignInPayload & { appleUser: string }> {
  const rawNonce = toHex(await Crypto.getRandomBytesAsync(32));
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashedNonce,
    });
    return { ...appleSignInPayload(credential, rawNonce), appleUser: credential.user };
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_REQUEST_CANCELED") throw new AppleSignInCancelled();
    throw error;
  }
}
