---
'@e2e-dev/web': minor
---

A browser provider can record the attempts it serves: `BrowserProvider.record(lease, context)` starts the service's own recording of the leased browser (the whole window, tabs and address bar) once the attempt's page is open, and its file or link becomes the attempt's video in place of the page screencast. A provider that cannot record leaves `record` out. `web({ video: { size, quality } })` sets the screencast's frame size and JPEG quality.
