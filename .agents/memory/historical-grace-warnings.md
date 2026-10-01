---
name: Historical grace warnings
description: Missing attribution in historical waived-penalty records and the boundary for safe repair.
---

Older grace-pass records may contain only generic user-facing wording, without the original penalty type. Do not assume they all belong to one type or retroactively deduct trust points to compensate for repeated waivers.

**Why:** Before per-user grace eligibility was serialized, warning formatting also discarded the type used by eligibility checks. Fixing future writes does not recover that missing historical attribution, and a warning alone cannot prove the correct penalty or score adjustment.

**How to apply:** Keep future concurrency fixes separate from historical repair. Infer a type only from verified linked review/request evidence, report ambiguous records explicitly, and require reviewed targets before changing historical scores.