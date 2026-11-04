import { AppleAuthError, appleConfigFromEnv, decryptAppleToken, revokeAppleToken, type AppleClientDeps } from "../apple-auth";

/** What has to be ended on Apple's side before the account's data is erased: the grant ShareSwap holds for this person. */
export type AppleCleanupTarget = {
  userId: number;
  /** apple_links.refresh_token_enc; null when no refresh token was ever kept, so there is nothing to revoke. */
  refreshTokenEnc: string | null;
};

/** Raised when Apple could not be told, so the deletion must wait and be retried (Apple requires the revocation). */
export class AppleCleanupUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleCleanupUnavailableError";
  }
}

/**
 * Revokes the person's Apple refresh token (POST appleid.apple.com/auth/revoke). Safe to repeat: Apple treats an
 * already-revoked token as done. Apple being unreachable, or our own Apple settings being absent, raises
 * AppleCleanupUnavailableError so the deletion is retried later rather than leaving the grant in place. A token we
 * cannot read or that Apple says is invalid is logged and skipped, since retrying could never change that.
 */
export function createAppleCleanup(options: { env?: NodeJS.ProcessEnv } & AppleClientDeps = {}) {
  return async (target: AppleCleanupTarget): Promise<void> => {
    if (!target.refreshTokenEnc) return;
    const env = options.env ?? process.env;
    const config = appleConfigFromEnv(env);
    if (!config) throw new AppleCleanupUnavailableError("The Apple settings are not configured, so the Apple grant cannot be revoked");
    let stored;
    try {
      stored = decryptAppleToken(target.refreshTokenEnc, env);
    } catch (error) {
      if (error instanceof AppleAuthError && error.code === "encryption_key") throw new AppleCleanupUnavailableError(error.message);
      console.error(`[apple] the stored Apple token of user ${target.userId} cannot be read; skipping its revocation`);
      return;
    }
    try {
      await revokeAppleToken(config, { refreshToken: stored.refreshToken, clientId: stored.clientId }, { fetch: options.fetch, now: options.now });
    } catch (error) {
      if (error instanceof AppleAuthError && error.code === "apple_unavailable") throw new AppleCleanupUnavailableError(error.message);
      console.error(`[apple] Apple refused to revoke the token of user ${target.userId}; continuing:`, error instanceof Error ? error.message : error);
    }
  };
}
