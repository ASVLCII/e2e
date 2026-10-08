---
"@e2e-dev/web": patch
---

A node located inside a frame reports its box in the page's viewport, as an observed one does, so `tap({ position })` and `toHaveScreenshot` on it land on the node instead of where it sits inside the frame.
