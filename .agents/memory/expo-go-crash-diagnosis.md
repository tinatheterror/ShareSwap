---
name: Expo Go crash diagnosis workflow
description: How to efficiently diagnose "Something went wrong" crashes in Expo Go when you can't attach a debugger.
---

## The rule
"Try Again" in Expo Go's error boundary re-runs the **cached** JS bundle — it does NOT fetch a new bundle from Metro. To get updated code on device, the user must **shake → Reload** from the dev menu.

**Why:** Expo Go stores a local bundle copy. The error boundary's "Try Again" calls ErrorRecovery.recover() on the local copy. Only a manual Reload or closing+reopening the project triggers a Metro re-fetch.

**Exception:** A custom `ErrorFallback` that calls `reloadAppAsync()` from expo DOES trigger a full bundle re-download — but Expo Go's built-in error screen does not.

## Diagnosis trick — inline error display
Temporarily add to `ErrorFallback` in `__DEV__` mode:
```tsx
{__DEV__ && (
  <View style={{ borderWidth:1, borderColor:"#ef4444", borderRadius:8, padding:12, width:"100%" }}>
    <Text style={{ color:"#ef4444", fontSize:13 }}>{error.message}</Text>
  </View>
)}
```
The user can read the exact crash message from the screen without needing a remote debugger or Metro log access.

## Native console.log streaming
In Expo Go, `console.log/error` from the native JS runtime streams back to the Metro terminal — but only when the device is actively connected and the bundle was freshly loaded from Metro (not from cache).
