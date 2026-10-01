---
name: Google OAuth environment boundaries
description: Why Google sign-in must preserve the intended backend/database environment.
---

Google OAuth initiated from development must finish on the development API, with its exact callback URI authorized in the Google OAuth client. Do not route development callbacks through production or assume the two environments share identity records.

**Why:** A production-only callback sent development Google sign-in into a separate production database, creating an empty Google profile with a different handle while the original development profile and transaction history remained intact. Deleting an email/password duplicate did not fix that routing problem. Deleting the new production Google profile would merely let the next production sign-in recreate it.

**How to apply:** Inspect both databases read-only before deleting apparent duplicates. Preserve existing histories and select the right testing environment instead of renaming handles, copying records, or forcing account IDs across databases. Use an explicit, trusted development-only callback configuration; keep production configuration unchanged and retain existing Google-authorized production redirects. Never derive callback URLs from an arbitrary incoming Host header. Verify the outgoing OAuth redirect URI without exposing tokens or credentials, and treat Google-side callback registration as an external prerequisite.

**Preview constraint:** Google sign-in must run in a normal browser tab, not the embedded Replit preview. Continue using the development app in that tab after authentication; an iframe restriction is not evidence that a Google account is absent from development.