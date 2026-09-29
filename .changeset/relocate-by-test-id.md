---
"e2e": patch
---

Replay identifies a recorded control by the strongest identity it recorded, degrading from there: its test id first, then an authored element id on web, a control recorded with one is found whatever its label reads now (`Like (0 likes)` that became `Unlike (1 like)`), twins sharing an id resolve by their recorded position and never by label, and only a control without a test id, or whose id is gone, is matched by its label, exactly or by shape (`Reply (0 replies)` finds `Reply (1 reply)`, `Bob · now` finds `Bob · 5m`). End anchors follow the same rule with their labels compared by shape, are the leaves that appeared ranked by durability, and skip relative times and social tallies. An `end-mismatch` hand-off names the anchors the screen did not show in `step.cache.missingAnchors` and in the agent's notice. The replay policy version is bumped, so existing recordings re-record on their next passing run.
