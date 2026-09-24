---
'e2e': patch
---

The run summary's `Duration` row repeats a span of a minute or more as minutes and seconds beside the seconds it printed alone (`682.97s (11m 23s)`), so a long run reads without arithmetic. The startup split shares that parenthetical (`(11m 23s, startup 43.00s)`) instead of opening a second one; a run under a minute prints as before.
