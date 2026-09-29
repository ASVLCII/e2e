---
'@e2e-dev/web': minor
---

`web({ basicAuth: { username, password } })` takes `password: secrets.get(name)` for a `secrets` entry. The engine resolves it when each attempt starts, so a provider can rotate it, and the runner redacts the value from reports, logs, what the agent reads, and the Playwright trace, which records the context's credentials, like any configured secret.
