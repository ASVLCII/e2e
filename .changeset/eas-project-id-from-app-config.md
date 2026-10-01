---
"@e2e-dev/eas": minor
---

`easSimulators()` takes `projectId` from the app config when the option is absent: `extra.eas.projectId`, the id `eas init` writes, read from `app.config.json` or `app.json` beside `e2e.config.ts`, or from a dynamic `app.config.ts` (or `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`) as the project's own `expo config --type public` evaluates it in the run's environment, without `.env` files, as eas-cli runs it. It reads the config once per run, before the first session starts; a config that links no project fails the lease naming the file. `projectId` is optional now and still wins when it is passed. Reading it needs the `@e2e-dev/mobile` that passes `projectRoot` to device providers.
