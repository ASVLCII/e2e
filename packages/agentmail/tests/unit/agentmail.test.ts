/**
 * `agentMail()` against a mocked `agentmail` SDK: aliases of one shared
 * inbox created once by `clientId`, listings that keep only mail naming the
 * alias exactly, mail deleted on release, inboxes of their own tagged, swept,
 * and deleted, and errors worded for a test log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentMail } from '../../src/index.ts';
import { org, sdk } from './fake-agentmail.ts';

// The provider loads the SDK on first use, after this module's imports are bound.
vi.mock('agentmail', () => sdk);

const context = { signal: new AbortController().signal, runId: 'run-1' };

beforeEach(() => {
  org.reset();
  vi.stubEnv('AGENTMAIL_API_KEY', 'am_test_key');
  // A call that got past the mock would reach the real API with the stub key.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('the unit tests never reach the network')));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('agentMail() aliases', () => {
  it('leases lowercase plus-addresses of one shared inbox, created once by clientId', async () => {
    const provider = agentMail();
    const first = await provider.acquire(context);
    const second = await provider.acquire(context);
    expect(first).toMatchObject({ inboxId: 'inbox1@agentmail.to', address: expect.stringMatching(/^inbox1\+e2e-[0-9a-f]{10}@agentmail\.to$/u), alias: true });
    expect(second.address).not.toBe(first.address);
    expect(org.created).toEqual([{ clientId: 'e2e-shared-inbox', displayName: 'e2e' }]);
    expect(org.apiKeys).toEqual(['am_test_key']);
    await agentMail().acquire(context);
    expect(org.inboxes.size).toBe(1);
  });

  it('lists only mail whose To or Cc names the alias exactly, from its lease on, across pages', async () => {
    const provider = agentMail();
    org.inboxes.set('qa@agentmail.to', { clientId: undefined, metadata: undefined, messages: [] });
    org.deliver('qa@agentmail.to', { to: ['qa@agentmail.to'], subject: 'Before the lease' });
    const mine = await agentMail({ inboxId: 'qa@agentmail.to' }).acquire(context);
    const theirs = await agentMail({ inboxId: 'qa@agentmail.to' }).acquire(context);
    org.deliver(mine.inboxId, { to: [`"${mine.address}" <${theirs.address}>`], subject: 'Display name names mine, sent to theirs' });
    org.deliver(mine.inboxId, { to: ['someone@acme.test'], cc: [`Me <${mine.address.toUpperCase()}>`], subject: 'Cc, uppercased' });
    for (const subject of ['One', 'Two']) org.deliver(mine.inboxId, { to: [mine.address], subject, text: `${subject} body` });
    org.listedAfter = [];
    const listed = await provider.list(mine, context);
    expect(listed.map((summary) => summary.subject)).toEqual(['Cc, uppercased', 'One', 'Two']);
    expect(org.listedAfter).toEqual([mine.since, mine.since, mine.since]);
    expect((await provider.list(theirs, context)).map((summary) => summary.subject)).toEqual(['Display name names mine, sent to theirs']);
    expect(listed[1]).toMatchObject({ id: expect.any(String), receivedAt: expect.any(Date), cc: [] });
    await expect(provider.read(mine, listed[1]!.id, context)).resolves.toMatchObject({ subject: 'One', text: 'One body' });
  });

  it('deletes the alias\'s mail on release, and nothing else', async () => {
    const provider = agentMail();
    const mine = await provider.acquire(context);
    const theirs = await provider.acquire(context);
    org.deliver(mine.inboxId, { to: [mine.address], subject: 'Code' });
    org.deliver(mine.inboxId, { to: [theirs.address], subject: 'Theirs' });
    await provider.release(mine, context);
    expect(org.deleted).toEqual([]);
    expect(org.inboxes.get(mine.inboxId)!.messages.map((message) => message.subject)).toEqual(['Theirs']);
  });

  it('rejects an alias as the base, and a missing key, as not retryable', async () => {
    org.inboxes.set('qa@agentmail.to', { clientId: undefined, metadata: undefined, messages: [] });
    await expect(agentMail({ inboxId: 'qa+x@agentmail.to' }).acquire(context)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('not an alias of it') });
    vi.stubEnv('AGENTMAIL_API_KEY', '');
    await expect(agentMail().acquire(context)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('AGENTMAIL_API_KEY is not set') });
  });
});

describe('agentMail() releasing a message two aliases received', () => {
  it('keeps it for the other alias, whichever worker holds it, until the sweep of mail past its time', async () => {
    const worker1 = agentMail();
    const worker2 = agentMail();
    const me = await worker1.acquire(context);
    const teammate = await worker2.acquire(context);
    org.deliver(me.inboxId, { to: [teammate.address], cc: [me.address], subject: 'Invite' });
    await worker1.release(me, context);
    expect((await worker2.list(teammate, context)).map((summary) => summary.subject)).toEqual(['Invite']);
    await worker2.release(teammate, context);
    expect(org.inboxes.get(me.inboxId)!.messages.map((message) => message.subject)).toEqual(['Invite']);
  });

  it('sweeps alias mail older than any attempt lives in the background, not again within the hour, and nothing else', async () => {
    org.inboxes.set('qa@agentmail.to', { clientId: undefined, metadata: undefined, messages: [] });
    org.clock = Date.now() - 7 * 60 * 60 * 1000;
    for (const n of [1, 2, 3]) org.deliver('qa@agentmail.to', { to: [`qa+e2e-00000000${n}0@agentmail.to`], subject: `Old ${n}` });
    org.deliver('qa@agentmail.to', { to: ['qa@agentmail.to'], subject: 'Old, to the inbox itself' });
    org.clock = Date.now();
    org.deliver('qa@agentmail.to', { to: ['qa+e2e-0000000040@agentmail.to'], subject: 'Recent' });
    const provider = agentMail({ inboxId: 'qa@agentmail.to' });
    await provider.acquire(context);
    await vi.waitFor(() => expect(org.inboxes.get('qa@agentmail.to')!.messages.map((message) => message.subject)).toEqual(['Old, to the inbox itself', 'Recent']));
    const deleted = org.deletedMessages.length;
    await provider.acquire(context);
    expect(org.deletedMessages).toHaveLength(deleted);
  });
});

describe('agentMail() reading', () => {
  it('refuses, as not retryable, a message id its alias was not sent', async () => {
    const provider = agentMail();
    const mine = await provider.acquire(context);
    const theirs = await provider.acquire(context);
    const delivered = org.deliver(mine.inboxId, { to: [theirs.address], subject: 'Theirs' });
    await expect(provider.read(mine, delivered.messageId, context)).rejects.toMatchObject({ retryable: false, message: `message ${delivered.messageId} was not sent to ${mine.address}` });
    await expect(provider.read(theirs, delivered.messageId, context)).resolves.toMatchObject({ subject: 'Theirs' });
  });
});

describe('agentMail({ isolation: "inbox" })', () => {
  it('creates a tagged inbox per lease and deletes it on release, one already gone included', async () => {
    const provider = agentMail({ isolation: 'inbox', domain: 'acme.test', displayName: 'QA' });
    const lease = await provider.acquire(context);
    expect(lease).toMatchObject({ inboxId: 'inbox1@acme.test', address: 'inbox1@acme.test', alias: false });
    expect(org.created).toEqual([
      {
        clientId: expect.stringMatching(/^e2e-[0-9a-f]{24}$/u),
        domain: 'acme.test',
        displayName: 'QA',
        metadata: { e2e: true, e2e_expires_at: expect.any(String), e2e_run: 'run-1' },
      },
    ]);
    org.deliver(lease.inboxId, { to: [lease.address], subject: 'Hi' });
    expect((await provider.list(lease, context)).map((summary) => summary.subject)).toEqual(['Hi']);
    await provider.release(lease, context);
    await provider.release(lease, context);
    expect(org.deleted).toEqual(['inbox1@acme.test']);
  });

  it('sweeps again on the next acquire when a sweep could not list the inboxes', async () => {
    org.inboxes.set('stale@agentmail.to', { clientId: 'e2e-old', metadata: { e2e: true, e2e_expires_at: new Date(Date.now() - 1000).toISOString() }, messages: [] });
    const provider = agentMail({ isolation: 'inbox' });
    org.failNext(503, { message: 'Unavailable' });
    await provider.acquire(context);
    expect(org.deleted).toEqual([]);
    await provider.acquire(context);
    expect(org.deleted).toEqual(['stale@agentmail.to']);
  });

  it('makes concurrent acquires wait on one sweep, and sweeps again when a deletion failed', async () => {
    org.inboxes.set('stale@agentmail.to', { clientId: 'e2e-old', metadata: { e2e: true, e2e_expires_at: new Date(Date.now() - 1000).toISOString() }, messages: [] });
    const provider = agentMail({ isolation: 'inbox' });
    org.failNext(503, { message: 'Unavailable' }, 'inboxes.delete');
    await Promise.all([provider.acquire(context), provider.acquire(context)]);
    expect(org.inboxListings).toBe(1);
    expect(org.deleted).toEqual([]);
    await provider.acquire(context);
    expect(org.inboxListings).toBe(2);
    expect(org.deleted).toEqual(['stale@agentmail.to']);
    await provider.acquire(context);
    expect(org.inboxListings).toBe(2);
  });

  it('sweeps again an hour on, for a long-lived process such as an e2e mcp server', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const provider = agentMail({ isolation: 'inbox' });
      await provider.acquire(context);
      await provider.acquire(context);
      expect(org.inboxListings).toBe(1);
      vi.setSystemTime(Date.now() + 61 * 60 * 1000);
      await provider.acquire(context);
      expect(org.inboxListings).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sweeps inboxes of its own a killed run left past their time, then not again within the hour', async () => {
    org.inboxes.set('stale@agentmail.to', { clientId: 'e2e-old', metadata: { e2e: true, e2e_expires_at: new Date(Date.now() - 1000).toISOString() }, messages: [] });
    org.inboxes.set('live@agentmail.to', { clientId: 'e2e-new', metadata: { e2e: true, e2e_expires_at: new Date(Date.now() + 60_000).toISOString() }, messages: [] });
    org.inboxes.set('mine@agentmail.to', { clientId: undefined, metadata: undefined, messages: [] });
    const provider = agentMail({ isolation: 'inbox' });
    await provider.acquire(context);
    await provider.acquire(context);
    expect(org.deleted).toEqual(['stale@agentmail.to']);
    expect([...org.inboxes.keys()]).toEqual(expect.arrayContaining(['live@agentmail.to', 'mine@agentmail.to']));
  });
});

describe('errors', () => {
  it('words a rejected key, a quota, and a server failure, marking which a retry will not fix', async () => {
    const provider = agentMail({ isolation: 'inbox' });
    const lease = await provider.acquire(context);
    org.failNext(403, { message: 'Forbidden' });
    await expect(provider.list(lease, context)).rejects.toMatchObject({ retryable: false, message: 'AgentMail rejected AGENTMAIL_API_KEY; create a key at https://console.agentmail.to' });
    org.failNext(403, { name: 'LimitExceededError', message: 'Inbox limit exceeded', fix: 'Your plan\'s inbox limit is 3.' });
    await expect(provider.acquire(context)).rejects.toMatchObject({ retryable: false, message: 'AgentMail answered 403: Inbox limit exceeded Your plan\'s inbox limit is 3.' });
    org.failNext(503, { message: 'Unavailable' });
    const transient = await provider.list(lease, context).catch((cause: unknown) => cause);
    expect(transient).toMatchObject({ message: 'AgentMail answered 503: Unavailable' });
    expect((transient as { retryable?: unknown }).retryable).toBeUndefined();
  });
});
