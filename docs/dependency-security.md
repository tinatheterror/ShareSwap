# Dependency security maintenance

The active applications use the root pnpm workspace and `pnpm-lock.yaml`.
Do not generate npm lockfiles inside workspace packages: those locks are not used
by pnpm and can retain vulnerable dependencies after the application is updated.

The historical migration archive is a **separate** pnpm workspace. Its former npm
locks have been replaced by `.migration-backup/pnpm-lock.yaml`, with patched
dependency versions and the same local deepmerge fix. Its source is historical,
not a supported alternative application; restoring old source still requires
checking compatibility with current APIs. The archive is excluded from deployed
images. No source or user data was removed.

## Upgrades and compatibility

- Vite stays on the patched 7.3 release line.
- Zod uses patched v4, with compatible form resolvers and validation-error helpers.
- Orval is upgraded and explicitly generates React Query v5 hooks. Run
  `pnpm --filter @workspace/api-spec run codegen` after contract changes.
- Expo stays on SDK 54 and React Native 0.81.5. Security updates must not move
  individual native modules to a different Expo SDK.
- Expo's pinned Metro 0.83.3 has a local compatibility patch to use the
  `image-size` v2 named export and read file inputs as buffers. Moving Expo's
  Metro to 0.83.8 changes file-watcher
  events and crashes the SDK 54 CLI, despite passing Expo Doctor and export.
- UUID 11 provides the security fix while keeping CommonJS `v4` consumers working.
- Zod is external to the API's esbuild bundle and declared as a runtime
  dependency. Bundling its interdependent v4 entry points caused constructor
  initialization failures at API startup even though source-level tests passed.

The security floors in the workspace overrides are for dependencies whose
current direct parents still select older versions. Check the installed graph,
not only top-level package versions, before removing these overrides.

## Local deepmerge fix

There is no upstream fixed release for **GHSA-gcqx-w48m-w2h4** in deepmerge 4.3.1.
`patches/deepmerge@4.3.1.patch`, registered in both pnpm workspaces, filters
`__proto__`, `constructor`, and `prototype` from **both** merge inputs, including
the target-copy path. It covers the package source, CommonJS bundle, and UMD
bundle. Other keys, symbol properties, array strategies, and `.all` retain their
existing behavior.

Version-only scanners still report this advisory once per lockfile; this is not
an unpatched install. No advisory is ignored or hidden from the scanners.
Both lockfiles record the patch hash, and pnpm verifies and reapplies it on
install. Replace the patch with an upstream release when one is available.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm test:dependencies
pnpm --filter @workspace/shareswap test
pnpm --filter @workspace/shareswap-mobile exec jest --runInBand
pnpm --filter @workspace/shareswap-mobile exec expo install --check
pnpm --filter @workspace/shareswap-mobile exec npx --yes expo-doctor
pnpm audit
pnpm --dir .migration-backup audit
```

`test:dependencies` exercises prototype-poisoning payloads through the actual
SendGrid, Expo, and Jest dependency resolutions, normal email construction,
Metro image dimensions, Google Cloud's UUID consumer, Zod/Drizzle validation,
and Express/Multer uploads and size limits. It does not send email, use payment
services, or access the database.

The audits should report only the patched deepmerge advisory, with no other
findings. Their nonzero exit code remains intentional until the scanner can
recognize patches or an upstream fix is released.

The full project typecheck already has unrelated errors. Compare new diagnostics
against the baseline rather than treating those existing errors as introduced
by these upgrades. The native test suites also have a known open-handle problem:
tests complete, but Jest may not exit. Do not remove test cleanup or relax
assertions to work around it.

Full API integration tests require an explicitly approved test database. Keep
the test-database guard in place; dependency verification must not authorize
writes to a shared database merely to make the full suite run.
