---
name: Native app live-API mismatch
description: Distinguishing an outdated published backend from a broken native return-confirmation screen.
---

When a phone chat displays an inbox fallback but no owner action, check the published API separately from the development API. A published route returning an HTML "Cannot GET" 404 while the development route returns an authentication 401 to the same anonymous probe means the live backend is missing that route; changing only the native UI cannot make it work.

**Why:** A return-requested item existed in the development database and the live inbox still loaded, but the published full-requests endpoint errored and its lifecycle endpoint was not registered. Development workflow logs from an unrelated signed-out preview could have led to a false diagnosis of an expired owner session.

**How to apply:** Obtain the verified published URL, compare harmless anonymous route responses across live and dev, and inspect live logs before changing client authorization logic. A stale published build needs publishing; do not manually confirm a physical return or mutate deposit state to bypass a missing owner action. If there is no Replit-managed production database, do not assume Publish will migrate an external database.

Do not equate an installed native development build with a development backend connection. Correlate the phone's failing request and timestamp with development versus deployment logs before changing provider setup.

**Why:** Phone screenshots described as development-build errors were traced to production: Stripe's development connector was unavailable to the deployment while read-only Stripe authentication succeeded in the development workspace. Persona independently rejected inquiry creation permissions. These were separate environment and provider-authorization failures, not missing native payment or camera modules.