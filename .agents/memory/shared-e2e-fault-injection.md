---
name: Shared E2E fault injection
description: Why browser tests that inject cleanup failures should not run concurrently against one API process.
---

Keep E2E tests that deliberately fail fixture cleanup serial when they share a server process with other fixture-setup tests; alternatively isolate the server and its in-memory fixture state per test.

**Why:** Parallel browser workers share the same API process. A simulated cleanup failure in one test can make another test's fixture setup fail. Also, the authentication throttle persists in the database across test-server restarts, so repeated fault-injection runs can reach its per-IP cap even when earlier runs passed.

**How to apply:** When adding fault-injection scenarios to a shared-server browser suite, account for server-global fixture state before allowing parallel execution. Keep E2E-only login behavior isolated from production throttling.

Isolating a test API process does not isolate fixtures from the running development API's database schedulers.

**Why:** A development deadline job acted on an overdue test loan during fixture teardown and inserted request-linked records between child deletion and parent deletion, causing a foreign-key failure despite comprehensive cleanup.

**How to apply:** For tests unrelated to loan deadlines, make borrowed fixture loans ineligible for deadline work before the test waits on polling. Keep overdue fixtures active only when their deadline behavior is part of the scenario.