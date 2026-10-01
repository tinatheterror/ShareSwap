import assert from "node:assert/strict";
import test from "node:test";
import { resolveGoogleOAuthCallbackURL } from "./google-oauth-config";

test("explicit development callback overrides the published custom domain", () => {
  assert.equal(
    resolveGoogleOAuthCallbackURL({
      GOOGLE_OAUTH_CALLBACK_URL: "https://test-project.replit.dev/api/auth/google/callback",
      CUSTOM_DOMAIN: "shareswap.app",
    }),
    "https://test-project.replit.dev/api/auth/google/callback",
  );
});

test("production keeps its custom-domain callback without a development override", () => {
  assert.equal(
    resolveGoogleOAuthCallbackURL({ CUSTOM_DOMAIN: "shareswap.app" }),
    "https://shareswap.app/api/auth/google/callback",
  );
});

test("existing published fallback remains compatible", () => {
  assert.equal(
    resolveGoogleOAuthCallbackURL({}),
    "https://share-swap-mvp.replit.app/api/auth/google/callback",
  );
});

test("explicit callback is trimmed and cannot be replaced by a request host", () => {
  assert.equal(
    resolveGoogleOAuthCallbackURL({
      GOOGLE_OAUTH_CALLBACK_URL: " https://test-project.replit.dev/api/auth/google/callback ",
    }),
    "https://test-project.replit.dev/api/auth/google/callback",
  );
});

test("invalid or ambiguous callbacks fail explicitly", () => {
  for (const url of [
    "not-a-url",
    "http://example.com/api/auth/google/callback",
    "https://user:password@example.com/api/auth/google/callback",
    "https://example.com/somewhere-else",
    "https://example.com/api/auth/google/callback?next=evil",
    "https://example.com/api/auth/google/callback#token",
  ]) {
    assert.throws(() => resolveGoogleOAuthCallbackURL({ GOOGLE_OAUTH_CALLBACK_URL: url }));
  }
});