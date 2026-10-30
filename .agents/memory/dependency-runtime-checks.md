---
name: Dependency runtime checks
description: Non-obvious runtime compatibility checks needed during security upgrades.
---

Validate the running development watcher after Expo tooling upgrades, not only
Expo Doctor and static export.

**Why:** Expo SDK 54's CLI expects Metro watcher changes with an `eventsQueue`.
Metro 0.83.8 changed that event shape. The upgrade passed Doctor and exported
successfully, but a file change crashed the development server. Keep the
SDK-pinned Metro where possible and adapt isolated dependency API differences.

**How to apply:** After changing Metro or its dependencies, compile a bundle,
trigger a watched-file change, and verify the development server remains alive.
Native SDK alignment checks are necessary but not sufficient.

Verify the actual bundled API startup after validator-library upgrades.

**Why:** Zod v4 source imports and typechecks worked while the esbuild-generated
API failed at startup with a schema-constructor initialization error. Keeping
Zod's entry points in one external runtime graph avoided the circular
initialization problem.

**How to apply:** Keep runtime module identity consistent across shared schemas
and their consumers; check the built server's health endpoint, not only unit
tests that execute TypeScript source.
