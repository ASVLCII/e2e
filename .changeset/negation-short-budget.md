---
"e2e": patch
---

A negated assertion passes at the deadline when every sample held it, which is how the expect reference already said a `{ timeout }` shorter than the 1000 ms grace window passes. The window is timed from when the first sample returns, so under a short budget, or one a slow read ate into, it ended after the deadline. The assertion then failed with an `ASSERTION_FAILED` whose `observed:` line agreed with the expectation (`expected: not visible`, `observed: no node`). `{ timeout: 1000 }` could fail this way too, depending on how read latency lined up with the 100 ms poll interval. A budget that one read outlasts is now judged on that read. Matchers built on `pollCondition` from `e2e/engine`, such as `expect(browser)`, get the same fix.
