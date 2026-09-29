---
name: Trust level follows current score
description: Current trust tier is based on score, not the highest tier previously achieved.
---

Every change to a trust score must update the persisted level in the same database write or transaction. Read-facing level labels should derive from the current score to tolerate old mismatched records.

**Why:** A score deduction left a member below the Community Pillar threshold while a stored level still called them Community Pillar. Different screens then disagreed despite showing the same score.

**How to apply:** When adding score-changing flows or showing a level, use the shared threshold definition; test both upward and downward threshold crossings, including penalties.