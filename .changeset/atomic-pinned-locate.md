---
"@e2e-dev/web": patch
---

A locator whose match the page replaces on every animation frame (a field re-rendered each frame) no longer fails with `LOCATOR_NOT_FOUND` "node became stale" on a loaded machine. Locate read each match in a protocol call after the one that found it, so when a frame passed between the two, which a busy runner makes likely every time, the read found the match detached and the locate retried until the action timeout. Each match is now read in the same in-page task that finds it, so the read never sees a replaced element. A `getByLabel` or `getByDisplayValue` match is still pinned to the element that was read.

A `browser.locator` selector with a `*` capture before its last part (`*css=article >> text=Hello`) now fails with `INVALID_LOCATOR` instead of resolving; use `filter({ has })`. A capture rewrites the chain so the elements it returns are never the ones the rest of the locate reads, and composing anything onto such a selector already matched the captured element instead of its descendants.
