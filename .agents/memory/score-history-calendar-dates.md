---
name: Score-history calendar dates
description: The calendar-date rule for reputation and score activity displays.
---

Score-history activity is displayed using its **UTC calendar day** (`Mon DD, YYYY`) on every client. Missing or invalid timestamps display an en dash rather than a substituted or invalid date.

**Why:** A recorded activity near UTC midnight must retain one stable calendar date across web and native clients, regardless of the member's local timezone.

**How to apply:** Reuse this rule for score-history and reputation-activity date displays that represent the recorded activity day. Do not apply it to interfaces intended to show the member's local time of day.