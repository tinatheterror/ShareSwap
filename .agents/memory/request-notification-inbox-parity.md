---
name: Request notification inbox parity
description: Keeps request lifecycle alerts visible in both the notification bell and the unified inbox.
---

Every notification tied to a request must also produce unread activity for that request in the unified inbox, even when the originating flow has no separate chat lifecycle message.

**Why:** Transaction updates can be raised by manual actions, automated deadlines, or payment workflows. If only the bell receives the alert, users who rely on the inbox can miss material changes.

**How to apply:** Treat unread request-linked notifications as inbox activity at the inbox aggregation layer, without duplicating lifecycle chat messages. When a user opens that request thread, clear the matching notification alerts as well as unread messages.