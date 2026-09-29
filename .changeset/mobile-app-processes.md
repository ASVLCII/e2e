---
'@e2e-dev/mobile': minor
---

`mobile()` takes `command`, `readyUrl`, and `services`, the same app process declaration `web()` has: the runner starts Metro (or any dev server a development build loads from) and the app's backend services before the first test and stops them on every exit path. A device has no URL, so `readyUrl` is required beside `command`. Until now a device suite that needed these rebuilt the engine handle through `defineEngine` to add them.
