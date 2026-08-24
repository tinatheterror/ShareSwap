---
name: Return-date action sequencing
description: Defines how extensions, late-return notices, and early returns interact during an active borrow.
---

An unresolved extension disables further extension attempts and late-return notices, but must never block the borrower from starting a return. A sent late-return notice disables only another notice; it does not prevent an extension request. An approved free extension prevents another extension request. After an extension is approved, the borrower may send one owner follow-up even once the revised due date has passed, until the return process starts.

**Why:** Owners need one clear return-date decision at a time, while borrowers must always retain an escape hatch to return the item early and be able to communicate when a revised deadline is missed.

**How to apply:** Keep Return available during a pending extension. When return begins, withdraw any pending extension and reject later approval. Include any existing late-return notice in a new extension request so the owner sees the full context. Keep the accepted-extension follow-up action available after the due date, but enforce it as a single borrower-only notice while the borrow is still in progress.