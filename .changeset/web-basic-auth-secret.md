---
'@e2e-dev/web': minor
---

`web({ basicAuth: { username, password } })` takes `password: secrets.get(name)` for a `secrets` entry. The engine resolves it when each attempt starts, so a provider can rotate it, and the runner redacts the value from reports, logs, and what the agent reads like any configured secret.
