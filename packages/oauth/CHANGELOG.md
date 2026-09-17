# @e2edev/oauth

## 0.1.0-canary-20260917213813

### Minor Changes

- [#335](https://github.com/tester-army/e2e/pull/335) [`15081f3`](https://github.com/tester-army/e2e/commit/15081f306837ebe1040fbcb2e63bd2efe283faaa) Thanks [@okwasniewski](https://github.com/okwasniewski)! - Sign in with a personal subscription instead of an API key. The new `@e2edev/oauth` package runs the OAuth flows for ChatGPT Plus/Pro (the Codex sign-in, browser or device code), GitHub Copilot (the GitHub CLI's login or a device flow for your OAuth App), and SuperGrok / X Premium+ (device code), stores the tokens in `~/.config/e2e/oauth.json`, refreshes them ahead of expiry, and exposes each plan as an AI SDK model: `chatgpt('gpt-5.5')`, `copilot('claude-sonnet-5')`, `grok('grok-4')`. The e2e CLI gains `e2e login <provider>` and `e2e logout`, and `e2e init` offers the three subscriptions next to the gateways.
