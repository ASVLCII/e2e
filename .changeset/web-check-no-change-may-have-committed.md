---
'@e2e-dev/web': patch
---

A `check` or `uncheck` whose click left the control unchanged now fails as `ACTION_MAY_HAVE_COMMITTED` instead of `NOT_ACTIONABLE`, since the click reached the app.
