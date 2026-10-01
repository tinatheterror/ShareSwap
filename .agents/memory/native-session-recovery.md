---
name: Native session recovery
description: Safety decisions for restoring navigation after a mobile session expires.
---

After reauthentication, restore a local view only for the same account; do not automatically replay a failed action.

**Why:** A request can finish on the server while another request expires the local session. Replaying payments, messages, or lifecycle changes could duplicate an operation. Switching accounts must not restore another person's conversation or form.

**How to apply:** Keep recovery destinations restricted to known in-app screens and preserve the request identifier for chat. Require the user to review and explicitly submit any action after signing in again.