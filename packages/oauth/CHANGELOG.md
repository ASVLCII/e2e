# @e2edev/oauth

## 0.1.0-canary-20260921154506

### Patch Changes

- [#373](https://github.com/tester-army/e2e/pull/373) [`ca5e619`](https://github.com/tester-army/e2e/commit/ca5e6196b620165dcabc383c1aaf35c44cf22690) Thanks [@okwasniewski](https://github.com/okwasniewski)! - Relicense from MIT to Apache-2.0. The package ships the license text and a `NOTICE` file.

- [#374](https://github.com/tester-army/e2e/pull/374) [`2b6d78f`](https://github.com/tester-army/e2e/commit/2b6d78f5a2a967d56b7aae2253288ac0fcd5871b) Thanks [@okwasniewski](https://github.com/okwasniewski)! - `chatgpt()` models work again. The Codex backend now answers its Responses stream with no `content-type` header, so the stream reached the AI SDK unfolded and every call failed with `MODEL_PROVIDER_FAILED: Invalid JSON response`; it also sends the final event with an empty `output`. The fold recognizes the stream by its body and assembles the output from the streamed items.

## 0.1.0-canary-20260917213813

### Minor Changes

- [#335](https://github.com/tester-army/e2e/pull/335) [`15081f3`](https://github.com/tester-army/e2e/commit/15081f306837ebe1040fbcb2e63bd2efe283faaa) Thanks [@okwasniewski](https://github.com/okwasniewski)! - Sign in with a personal subscription instead of an API key. The new `@e2edev/oauth` package runs the OAuth flows for ChatGPT Plus/Pro (the Codex sign-in, browser or device code), GitHub Copilot (the GitHub CLI's login or a device flow for your OAuth App), and SuperGrok / X Premium+ (device code), stores the tokens in `~/.config/e2e/oauth.json`, refreshes them ahead of expiry, and exposes each plan as an AI SDK model: `chatgpt('gpt-5.5')`, `copilot('claude-sonnet-5')`, `grok('grok-4')`. The e2e CLI gains `e2e login <provider>` and `e2e logout`, and `e2e init` offers the three subscriptions next to the gateways.
