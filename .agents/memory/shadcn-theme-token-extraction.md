---
name: Extracting shadcn theme tokens for cross-platform parity
description: How to get the real, computed shadcn CSS variable values (not just theme.json) when a mobile or other client app needs to match a web app's design tokens exactly.
---

`theme.json` (used by `@replit/vite-plugin-shadcn-theme-json`) only specifies `variant`, `primary`, `appearance`, and `radius`. It does NOT contain the actual neutral palette (background/foreground/muted/border/etc) — those are generated at build/dev time by the plugin based on a base color family (e.g. shadcn's "stone", "slate", "zinc", "gray") and injected into the page as an inline `<style data-vite-theme>` block with `:root { --background: ... }` and `.dark { ... }` HSL values.

Do not assume the neutral family (e.g. don't assume "slate" just because it's a common default) — different projects may use different base families, and a mismatch here (e.g. slate vs stone) is a real, easy-to-miss visual drift between a web app and a companion mobile/native app meant to share the same design system.

**How to apply:** To get the ground-truth values, `curl` the running web dev server's HTML directly (e.g. `curl -s http://localhost:<port>/`) and grep/sed out the `data-vite-theme` style block. This gives exact HSL values for every token in both light and dark mode, which can then be converted to hex and hardcoded into a non-Tailwind client (e.g. a React Native app's color constants) for exact parity.
