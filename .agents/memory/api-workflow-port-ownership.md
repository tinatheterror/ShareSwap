---
name: API workflow port ownership
description: Diagnosing sign-in verification errors when the managed API workflow fails on an occupied port.
---

A login-time "Unable to verify this request" message can reflect API unavailability, not a broken CSRF implementation. A failed managed API workflow can coexist with an older process from the same artifact that still listens on the API port, making endpoint checks appear intermittently healthy.

**Why:** A screenshot was captured while the API was unavailable, then a later listener served the token endpoint even though the managed workflow had failed with `EADDRINUSE`. Editing login or CSRF code would not have fixed the workflow conflict.

**How to apply:** Check the managed API workflow state, the live token endpoint through the development proxy, and the listening process's working directory/ancestry before changing auth code. If a stale listener owns the port, stop that process and restart the existing managed workflow once, then verify the token endpoint and a safe anonymous login probe.

The same stale-child problem can affect Expo: a restart may report success because an older Metro process still owns the expected port, while the new process waits at an interactive alternative-port prompt.

**Why:** Workflow status and an open port do not prove that the restarted process is serving the current preview.

**How to apply:** Confirm actual readiness in Metro's logs, verify the existing listener belongs to the same artifact, and stop only that stale process before restarting the managed workflow. Do not accept a different port or create a duplicate workflow.