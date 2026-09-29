---
'e2e': minor
---

`tests` globs take `!` exclusions: `tests: ['tests/**/*.e2e.ts', '!tests/wip/**']` runs every test file except those under `tests/wip/`. A file runs when an including glob matches it and no exclusion does, in any order, and discovery never reads a directory an exclusion takes whole. A list of only exclusions fails with `INVALID_CONFIG`.
