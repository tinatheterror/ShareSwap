---
name: Always-mounted RN components surface missing imports immediately
description: React Native components that always render on a screen (even when not "open") will crash the entire screen if they have any undefined JS reference — the crash is NOT deferred until the component is actually shown.
---

## The rule
If a component is rendered unconditionally on a screen (e.g. `<BorrowRequestSheet isOpen={false} />`), any undefined reference inside it (missing import, wrong variable name) will crash the parent screen immediately on mount — not when the user opens the sheet.

**Why:** React evaluates JSX for every rendered component, even when a `Modal visible={false}` hides the visual output. `TextInput is not defined` throws at render time whether the modal is visible or not.

**How to apply:** When a new screen crashes with "X is not defined" and you can't see the reference in the screen file itself, check every component that always-mounts on that screen (modals, sheets, selectors rendered without conditional guards).

## Debugging workflow
1. Make `ErrorFallback` show `error.message` inline in `__DEV__` mode — the user can read it without needing a remote debugger.
2. The exact "X is not defined" text immediately points to the missing import.
3. `grep -n "X" <component>.tsx` to confirm usage without import.
