---
name: Request chat deep links
description: Preserve request identity when routing item notifications to a chat, including push taps.
---

An alert about a specific item must open the conversation scoped to its request, not merely the chat with the other member. For new pushes, include the chat partner and request ID. For older alerts with only a request ID, resolve the partner from the recipient's request inbox, including archived conversations.

**Why:** Two item requests can involve the same pair of people. A partner-only deep link loses which item the alert is about, while resolving an older alert through a broad requests feed can fail even when the request's inbox entry is available.

**How to apply:** Any request-linked notification or push should carry a request ID through the final chat route. Verify taps for both current and archived requests and for multiple requests with one partner.