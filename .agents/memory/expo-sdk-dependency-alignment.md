---
name: Expo SDK dependency alignment
description: Why Expo-native dependencies and the Jest preset must stay aligned with the app's Expo SDK major.
---

Keep Expo-native packages, including `expo-notifications`, and `jest-expo` on versions compatible with the installed Expo SDK major.

**Why:** A newer SDK major of an Expo-native package can install its own incompatible native dependencies, creating duplicate native modules and causing development-client launch failures even when Metro can bundle JavaScript.

**How to apply:** After changing Expo dependencies, run Expo's dependency check and Expo Doctor. Resolve all SDK-version mismatches and duplicate-native-module findings before investigating application code. For ShareSwap Mobile previews, also ensure the API workflow is running because authentication bootstrap depends on it. On Expo web, bypass native splash-screen blocking and native-only tab implementations. Keep the root gesture-handler container at `flex: 1`; without it, a cold web render can collapse the navigation tree to zero height while Metro and React report no exception.