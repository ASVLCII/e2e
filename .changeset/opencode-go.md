---
'e2e': minor
---

OpenCode Go subscriptions run agent steps: `opencodeGo('<id>')` from `e2e/oauth/opencode-go` reads `OPENCODE_API_KEY` and calls each model over the API Go serves it on (`@ai-sdk/openai` for GPT, Grok, and Muse Spark, `@ai-sdk/anthropic` for MiniMax and Qwen 3.8 Flash, `@ai-sdk/openai-compatible` for the rest), and `e2e init` offers it. Every model call now carries the conversation it belongs to in `x-session-affinity`, one per act step or judgment, which `opencodeGo()` sends to Go as `x-opencode-session`.
