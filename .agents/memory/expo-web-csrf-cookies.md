---
name: Expo web CSRF cookies
description: Cookie-policy constraint for authenticated mutations from an Expo web host to a separate API host.
---

Authenticated Expo mutations require the session cookie and double-submit CSRF cookie to use compatible cross-site policies, and the token endpoint must persist any newly created session before signing the token.

**Why:** Expo web and the API can be hosted on different Replit hosts. A cross-site session cookie may authenticate reads successfully while a stricter CSRF cookie is withheld. After an expired session, an unpersisted replacement session also changes IDs between token issuance and the retry, causing another invalid-token 403.

**How to apply:** When mutations fail CSRF validation, inspect the live token endpoint's `Set-Cookie` attributes and confirm a token fetched with a cookie jar passes CSRF on the next request. Keep native tokens session-local rather than persistent, and return JSON for CSRF errors.