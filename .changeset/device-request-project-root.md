---
"@e2e-dev/mobile": minor
---

A `DeviceProvider`'s `acquire` request carries `projectRoot`, the directory the config's relative paths resolve against, so a provider reads project files there instead of `process.cwd()`.
