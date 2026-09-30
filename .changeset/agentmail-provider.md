---
'@e2e-dev/agentmail': minor
---

`@e2e-dev/agentmail`, the AgentMail provider for `config.email`: `email: agentMail()`. Every address is a plus-address alias of one shared `e2e` inbox, created in the organization on first use and reused by every run, so any number of workers fit the free plan. An alias reads only mail whose To or Cc names it exactly, and its mail is deleted when its attempt ends. `inboxId` aliases an inbox you already have; `isolation: 'inbox'` creates an inbox per address (with `domain` and `displayName`), deletes it when the attempt ends, and a later run sweeps one a killed run left behind after six hours. AgentMail's errors read as its message and fix rather than raw JSON. `AGENTMAIL_API_KEY` comes from the environment.
