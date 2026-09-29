---
'e2e': minor
---

Breaking: the `TraceCacheStore` type is now `CacheStore`, and the docs and the CLI call the cache the replay cache. The `cache` config key and its options are unchanged; a `cache.store` built against the old name only needs its type import renamed.
