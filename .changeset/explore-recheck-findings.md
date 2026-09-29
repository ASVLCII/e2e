---
'e2e': patch
---

`e2e explore` checks a finding before it records it. The runner waits 1.5 seconds and looks at the screen again. If the screen changed from the one the agent reported on, for example a loading state that finished rendering, nothing is recorded, and the agent gets the new screen to report on again or drop. The explorer's instructions also say that a loading screen is not a defect.
