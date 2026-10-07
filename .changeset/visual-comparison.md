---
"e2e": minor
"@e2e-dev/mobile": patch
---

Add `toHaveScreenshot` for visual comparison on every engine that captures pixels: `await expect(screen).toHaveScreenshot('home.png')` compares the screen and `expect(locator).toHaveScreenshot()` one element against a PNG stored beside the test file, one per target and operating system. The first run writes it; `--update-snapshots` (`-u`) rewrites one that differs. Options: `threshold`, `maxDiffPixels`, `maxDiffPixelRatio`, `mask`, `maskColor`, `timeout`. A mismatch attaches the expected, actual, and diff images to the step. On iOS and Android the status bar is held in a fixed state for these screenshots.
