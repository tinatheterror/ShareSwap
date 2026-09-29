---
name: Expo web CSRF cookies
description: Cookie-policy constraint for authenticated mutations from an Expo web host to a separate API host.
---

Authenticated Expo mutations require the session cookie and double-submit CSRF cookie to use compatible cross-site policies, and the token endpoint must persist any newly created session before signing the token. A CSRF `403` followed by `401` after refreshing the token can mean the user's session has expired, not that the underlying action failed.

**Why:** Expo web and the API can be hosted on different Replit hosts. A cross-site session cookie may authenticate reads successfully while a stricter CSRF cookie is withheld. After an expired session, an unpersisted replacement session also changes IDs between token issuance and the retry, causing another invalid-token 403. On the return action, the first rejected POST was `403` but the retry and subsequent reads were `401`; the server never reached the return handler.

**How to apply:** When mutations fail CSRF validation, inspect the live token endpoint's `Set-Cookie` attributes and confirm a token fetched with a cookie jar passes CSRF on the next request. Keep native tokens session-local rather than persistent, and return JSON for CSRF errors. If retry ends in `401`, offer an explicit sign-in path in the affected screen; a native alert alone is not a reliable error display on Expo web.