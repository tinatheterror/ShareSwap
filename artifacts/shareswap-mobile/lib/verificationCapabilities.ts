// What the signed-in person may do is decided by the server (see api-server verification.ts) and
// arrives as flags on /api/user. The app only reads them; it never works out verification itself.

export type MissingVerification = "email" | "id" | "card";

export type CapabilityFlag = "canSwap" | "canClaimGift" | "canList" | "canBorrow" | "canRent";

export interface VerificationCapabilities {
  canSwap: boolean;
  canClaimGift: boolean;
  canList: boolean;
  canBorrow: boolean;
  canRent: boolean;
  missing: MissingVerification[];
}

// The signed-in user, whose type may not declare the flags the server adds.
type MaybeCapabilities = object | null | undefined;

/** The flags the server sent, or null when it sent none (an older server): then the server still enforces. */
export function readCapabilities(source: MaybeCapabilities): VerificationCapabilities | null {
  const user = source as Partial<VerificationCapabilities> | null | undefined;
  if (!user || typeof user.canSwap !== "boolean") return null;
  return {
    canSwap: user.canSwap,
    canClaimGift: user.canClaimGift === true,
    canList: user.canList === true,
    canBorrow: user.canBorrow === true,
    canRent: user.canRent === true,
    missing: Array.isArray(user.missing) ? user.missing : [],
  };
}

/** True when the server said this action is locked; false when allowed or when the flags are unknown. */
export function isLocked(user: MaybeCapabilities, flag: CapabilityFlag): boolean {
  const capabilities = readCapabilities(user);
  return capabilities !== null && !capabilities[flag];
}

export function needsEmailVerification(user: MaybeCapabilities): boolean {
  return readCapabilities(user)?.missing.includes("email") === true;
}

export type VerificationPrompt =
  | { kind: "email" }
  | { kind: "id-and-card"; missing: { idVerified: boolean; paymentVerified: boolean } };

/** The prompt to show for a locked action, or null when the action is allowed. */
export function promptFor(user: MaybeCapabilities, flag: CapabilityFlag): VerificationPrompt | null {
  if (!isLocked(user, flag)) return null;
  const missing = readCapabilities(user)?.missing ?? [];
  if (missing.includes("email")) return { kind: "email" };
  return {
    kind: "id-and-card",
    // The gate modal lists a step when its flag is false, so "missing" maps to false.
    missing: { idVerified: !missing.includes("id"), paymentVerified: !missing.includes("card") },
  };
}
