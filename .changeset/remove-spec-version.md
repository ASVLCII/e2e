---
'e2e': minor
---

Breaking: `specVersion` is gone from the config. The runner version is the format version, so a config that still sets `specVersion` fails with `INVALID_CONFIG` telling you to remove it. The report's `run.specVersion` and the replay cache key are unchanged.
