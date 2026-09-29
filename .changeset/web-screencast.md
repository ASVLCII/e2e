---
'@e2e-dev/web': minor
---

Breaking: `web({ video: { size, quality } })` is now `web({ screencast: { size, quality } })`, and the `WebVideoOptions` type is `WebScreencastOptions`. The options shape the page screencast; which attempts record is still the `video` mode on the config or a target. A config that still passes `web({ video })` fails with `INVALID_CONFIG` naming `screencast`.
