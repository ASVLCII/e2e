# @e2e-dev/agentmail

[AgentMail](https://agentmail.to) inboxes for [`e2e`](https://www.npmjs.com/package/e2e):
real email addresses for tests and the agent, behind `config.email`.

```bash
npm install --save-dev @e2e-dev/agentmail
```

```ts title="e2e.config.ts"
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { agentMail } from '@e2e-dev/agentmail';

export default {
  targets: [{ engine: web({ url: 'https://staging.example.com' }) }],
  email: agentMail(),
} satisfies E2EConfig;
```

```ts title="tests/signup.e2e.ts"
import { expect, test } from 'e2e';

test('a new account verifies its email', async ({ app, screen, email }) => {
  const inbox = await email.inbox();
  await app.open('/signup');
  await screen.getByLabel('Email').fill(inbox.address);
  await screen.getByRole('button', { name: 'Create account' }).click();
  const message = await inbox.waitForMessage({ subject: 'Verify your email' });
  await screen.getByLabel('Verification code').fill(/code is (\d{6})/.exec(message.text)![1]!);
  await screen.getByRole('button', { name: 'Verify' }).click();
  await expect(screen.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
```

For a deployed site that sends real mail. An app running locally, whose SMTP
you control, is better served by `maildev()` from `e2e`: no account, and
delivery in milliseconds.

`AGENTMAIL_API_KEY` comes from the environment. By default every address is a
plus-address alias (`<inbox>+e2e-...@agentmail.to`, so the site must accept a
`+`) of one shared `e2e` inbox, created in your organization on
first use, so any number of workers fit the free plan's three inboxes. An alias
reads only mail whose To or Cc names it exactly, and its mail is deleted when
its attempt ends. `agentMail({ inboxId })` aliases an inbox you already have;
`agentMail({ isolation: 'inbox', domain, displayName })` creates an inbox per
address, deletes it when the attempt ends, and sweeps one a killed run left
behind six hours later.

`pnpm --filter @e2e-dev/agentmail run test:live` runs the provider against the
real API with `AGENTMAIL_API_KEY` set; it sends two emails.

Full documentation lives at [e2e.tester.army/docs/email](https://e2e.tester.army/docs/email).

## License

Apache-2.0
