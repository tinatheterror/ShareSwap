---
name: Expo web CSRF cookies
description: Cookie-policy constraint for authenticated mutations from an Expo web host to a separate API host.
---

Authenticated Expo web mutations require the session cookie and double-submit CSRF cookie to use compatible cross-site policies.

**Why:** Expo web and the API can be hosted on different Replit hosts. A cross-site session cookie may authenticate reads successfully while a stricter CSRF cookie is withheld, causing every mutation to fail with an invalid-token 403 even after fetching a fresh token.

**How to apply:** When authenticated reads work but mutations fail CSRF validation, inspect the live token endpoint's `Set-Cookie` attributes. Ensure both cookies are secure and cross-site compatible; do not debug the feature route until the token and cookie pair reaches the API.