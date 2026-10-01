---
name: Local browser-test sessions
description: Constraints for authenticated Playwright tests that run a local HTTP API against the development database.
---

Authenticated browser integration tests must use a real server session, but the normal cross-site cookie policy cannot be used unchanged on a local HTTP test server. Enable an explicit test-only cookie mode and keep the normal secure policy as the default.

**Why:** Secure, SameSite=None session cookies are correct behind Replit's HTTPS proxy but browsers reject them on a local HTTP Playwright origin. Fully mocking authentication misses session, CSRF, authorization, and server-route regressions.

**How to apply:** Gate the local cookie override and any fixture/fault routes behind an explicit E2E server mode. Seed uniquely named records, authenticate through the real login route, and inject failures only after authz checks. Cleanup must remove both request-linked rows and user-scoped side effects that may omit the request ID (such as rewards, achievements, or their notifications), after success and before the next run. Do not let orphan cleanup delete another parallel test's active fixture.

Scan for abandoned browser fixtures before each fixture setup, not just once when the test server starts; share a scan already in progress and protect registered live fixtures.

**Why:** A browser run can be interrupted after the server's initial scan and after a completed return has generated user-scoped rewards. A one-time scan leaves these records behind until the server restarts.

**How to apply:** Any E2E fixture registry that can outlive a browser test should permit repeated orphan scans while excluding fixtures held by concurrent tests.

Run tests that restart a separate API sequentially with other suites using the same database. Separate ports and processes do not isolate persistent fixture cleanup.

**Why:** Restart destroys the process-local active registry. Another API's still-live fixtures can look abandoned to the restarted server's scan. A survival control for restart tests must live outside the orphan naming pattern, not merely in the old registry.

**How to apply:** Keep restart checks in a separate sequential test command until database or durable run-level isolation exists. Use uniquely named control data and restore its cleanup eligibility in a finally block.

Protect in-flight fixture creation before its first asynchronous step, not only after registration. Evaluate live protection after the orphan scan reads candidates.

**Why:** A scan can observe committed users before their fixture enters the active registry. A protection snapshot taken before the query can also miss setups that start while that query is pending.

**How to apply:** Reserve unique fixture identities synchronously, retain protection through commit and registration, and release it on every exit. Regression tests should pause after commit but before registration while a second setup completes its scan.