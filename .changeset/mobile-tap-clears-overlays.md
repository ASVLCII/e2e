---
'@e2e-dev/mobile': patch
---

A touch on a control a sticky footer covers lifts the control clear first. When a named node drawn after the control's vertical list, in its lower half, covers the control's centre, the list is panned up just far enough (at most a quarter of its height, up to three times) and the control found again before the tap, fill, or other touch goes out. Before, `scrollUntilVisible` could stop with the control peeking out under a sticky footer, and the tap at its centre landed on the footer. A control the screen lists more than once is left where it is, and an uncovered control costs nothing extra: the check reads the snapshot the control was just resolved from.
