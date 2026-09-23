---
'@e2edev/web': minor
---

`web()` no longer accepts `command`, `readyUrl`, or `services`: the processes that serve the app are the target's, declared as `targets: [{ engine: web({ url }), app: { command, readyUrl, services } }]`. Passing one is `INVALID_CONFIG` with a pointer there. `url`, `environment`, and `identity` stay as the defaults the engine brings.
