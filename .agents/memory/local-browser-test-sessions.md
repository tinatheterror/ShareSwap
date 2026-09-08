---
name: Local browser-test sessions
description: Constraints for authenticated Playwright tests that run a local HTTP API against the development database.
---

Authenticated browser integration tests must use a real server session, but the normal cross-site cookie policy cannot be used unchanged on a local HTTP test server. Enable an explicit test-only cookie mode and keep the normal secure policy as the default.

**Why:** Secure, SameSite=None session cookies are correct behind Replit's HTTPS proxy but browsers reject them on a local HTTP Playwright origin. Fully mocking authentication misses session, CSRF, authorization, and server-route regressions.

**How to apply:** Gate the local cookie override and any fixture/fault routes behind an explicit E2E server mode. Seed uniquely named records, authenticate through the real login route, and inject failures only after authz checks. Cleanup must remove both request-linked rows and user-scoped side effects that may omit the request ID (such as rewards, achievements, or their notifications), after success and before the next run. Do not let orphan cleanup delete another parallel test's active fixture.