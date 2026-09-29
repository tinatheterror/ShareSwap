---
name: Shared E2E fault injection
description: Why browser tests that inject cleanup failures should not run concurrently against one API process.
---

Keep E2E tests that deliberately fail fixture cleanup serial when they share a server process with other fixture-setup tests; alternatively isolate the server and its in-memory fixture state per test.

**Why:** Parallel browser workers share the same API process. A simulated cleanup failure in one test can make another test's fixture setup fail. Also, the authentication throttle persists in the database across test-server restarts, so repeated fault-injection runs can reach its per-IP cap even when earlier runs passed.

**How to apply:** When adding fault-injection scenarios to a shared-server browser suite, account for server-global fixture state before allowing parallel execution. Keep E2E-only login behavior isolated from production throttling.