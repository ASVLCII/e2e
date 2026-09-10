# @e2edev/github

## 0.1.0

### Minor Changes

- [#246](https://github.com/tester-army/e2e/pull/246) [`a0a4df0`](https://github.com/tester-army/e2e/commit/a0a4df01b463dd6117d44e0844a81880f7a4abdb) Thanks [@okwasniewski](https://github.com/okwasniewski)! - The GitHub reporter. `reporters: ['list', github()]` posts one pull request
  comment per run from GitHub Actions and keeps it current across reruns: the
  counts, the run-level errors, one row per test that did not simply pass with
  its error and the evidence it left, the passed tests folded away, links to
  each test's source at the PR head and to the workflow run where the artifacts
  are. The same text goes to the job summary, pull request or not. It reads
  `GITHUB_TOKEN` (or `GH_TOKEN`) and the event when the run finishes; `key`
  tells matrix replicas' comments apart. Off
  GitHub Actions, on a push, or without a token it posts nothing and says so in
  one summary row. `renderComment` is exported so another host can render the
  same comment from a report-1 document.
