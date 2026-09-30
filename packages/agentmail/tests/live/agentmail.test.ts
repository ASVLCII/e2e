/**
 * `agentMail()` against the real AgentMail API: an alias of the shared inbox
 * receives mail an inbox of its own sends it through the SDK, reads it, and
 * deletes it on release, and the inbox is deleted on release too. Needs
 * `AGENTMAIL_API_KEY`; sends one email and holds two inboxes while it runs
 * (the shared one, which stays, and a temporary one).
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { AgentMailClient } from 'agentmail';
import { describe, expect, it } from 'vitest';
import { agentMail } from '../../src/index.ts';

const context = { signal: AbortSignal.timeout(90_000), runId: 'live' };

describe.skipIf(process.env['AGENTMAIL_API_KEY'] === undefined)('agentMail() live', () => {
  it('delivers from an inbox to an alias, reads it, and deletes both on release', async () => {
    const aliases = agentMail();
    const inboxes = agentMail({ isolation: 'inbox' });
    const recipient = await aliases.acquire(context);
    const sender = await inboxes.acquire(context);
    try {
      expect(recipient.address).toMatch(/\+e2e-[0-9a-f]{10}@/u);
      await new AgentMailClient({}).inboxes.messages.send(sender.inboxId, { to: [recipient.address], subject: 'Live check', text: 'Your code is 424242.' });
      let listed = await aliases.list(recipient, context);
      for (let polls = 0; listed.length === 0 && polls < 30; polls += 1) {
        await sleep(2_000);
        listed = await aliases.list(recipient, context);
      }
      expect(listed.map((summary) => summary.subject)).toEqual(['Live check']);
      const message = await aliases.read(recipient, listed[0]!.id, context);
      expect(message.text).toContain('Your code is 424242.');
      expect(message.from).toContain(sender.address);
    } finally {
      await inboxes.release(sender, context);
      await aliases.release(recipient, context);
    }
    expect(await aliases.list(recipient, context)).toEqual([]);
  });
});
