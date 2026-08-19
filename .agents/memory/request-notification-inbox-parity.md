---
name: Request notification inbox parity
description: Keeps request lifecycle alerts visible in both the notification bell and the unified inbox.
---

Every notification tied to a request must be created as a request-linked alert and must also produce unread activity for that request in the unified inbox, even when the originating flow has no separate chat lifecycle message. Time-sensitive alerts also need live-session and native-push delivery when available; a chat message alone is not a notification.

**Why:** Transaction updates can be raised by manual actions, automated deadlines, or payment workflows. If only the bell receives the alert, users who rely on the inbox can miss material changes.

**How to apply:** Persist a notification with the request ID, notify connected clients, and send an opt-in push for material updates. Treat unread request-linked notifications as inbox activity at the inbox aggregation layer, without duplicating lifecycle chat messages. When a user opens that request thread, clear the matching notification alerts as well as unread messages.