# @e2e-dev/decision

## 0.2.0

### Minor Changes

- [#937](https://github.com/tester-army/e2e/pull/937) [`f1a1ac2`](https://github.com/tester-army/e2e/commit/f1a1ac241042c089ae773213c4e4f0da34f2f3d8) Thanks [@outof-place](https://github.com/outof-place)! - `decisionExecutor({ providerOptions })` sends provider options with every decide call, the completion checks included, such as `{ gateway: { zeroDataRetention: true } }` for Vercel AI Gateway. They reach the decision model only: the text model keeps the agents entry's `providerOptions`. A value that does not map provider names to option objects fails config load with `INVALID_CONFIG`.

## 0.1.0

### Minor Changes

- [#775](https://github.com/tester-army/e2e/pull/775) [`d1f2089`](https://github.com/tester-army/e2e/commit/d1f2089081219ab0a8a07d49adb0195623738b40) Thanks [@guhcostan](https://github.com/guhcostan)! - Add `@e2e-dev/decision`, an executor that runs `agent.act` and `agent.assert`
  through a decision model instead of an LLM. It takes any AI SDK decision
  model with choice distributions (`evaluationModel()` instances too) and
  decides through `experimental_decide`, so it needs `ai` 7.0.128 or later. One
  call per action fans out the operation and target questions; a small
  language model writes field values when the choice is `type`. Tests stay
  plain natural language with no params. Probability and confidence gates are
  off by default. A model id string or a language model fails config load with
  `INVALID_CONFIG`.
