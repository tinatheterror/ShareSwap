type GoogleOAuthEnvironment = {
  GOOGLE_OAUTH_CALLBACK_URL?: string;
  CUSTOM_DOMAIN?: string;
};

const CALLBACK_PATH = "/api/auth/google/callback";

/** Use trusted runtime configuration, never the incoming request's Host header. */
export function resolveGoogleOAuthCallbackURL(env: GoogleOAuthEnvironment): string {
  const configured = env.GOOGLE_OAUTH_CALLBACK_URL?.trim();
  const candidate = configured || (env.CUSTOM_DOMAIN
    ? `https://${env.CUSTOM_DOMAIN}${CALLBACK_PATH}`
    : "https://share-swap-mvp.replit.app/api/auth/google/callback");

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Google OAuth callback must be a valid HTTPS URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== CALLBACK_PATH ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `Google OAuth callback must be an HTTPS URL ending in ${CALLBACK_PATH}, without credentials, query, or fragment`,
    );
  }
  return url.href;
}