---
'e2e': minor
---

`secrets.get(name)` works in `e2e.config.ts`: called before a run exists, it returns a reference by name for an engine option to hold, and the config load fails with `INVALID_CONFIG` when no `secrets` entry or credential has the name. An engine declares the handles its options hold in `defineEngine({ secrets })` and reads each value in `startAttempt` through the new `EngineAttemptContext.resolveSecret(secret)`, which runs a provider fresh and registers the value for redaction before it returns. `e2e/engine` exports `isSecret`. Code that builds an `EngineAttemptContext` itself, such as an engine's own tests, now passes `resolveSecret`. The config docs show `process.loadEnvFile('.env')` for loading an env file.
