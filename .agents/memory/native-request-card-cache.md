---
name: Native request-card cache behavior
description: Why item-request detail fetches must avoid conditional HTTP responses across native and Expo web.
---

When a native screen expects JSON for a pinned request, do not rely on a conditional HTTP response: a `304` has no JSON body, and a client that always parses JSON treats it as a failed request. A unique URL per refresh avoids stale conditional responses. Do not add a custom `Cache-Control` request header just for this: Expo web runs cross-origin and that header triggered a failing CORS preflight.

**Why:** The chat card fell back to a partial inbox summary while request lookups returned conditional responses. An attempted request-header fix made the Expo web lookup fail at preflight.

**How to apply:** For a native screen that needs a fresh JSON response, keep its query cache key stable for invalidation but make the transport URL unique per fetch. Check both native and Expo web behavior after changing request headers or HTTP caching.