/** AgentMail inboxes as the `MailProvider` behind `config.email`. */

import { randomBytes } from 'node:crypto';
import type { MailLease, MailProvider, MailSummary } from 'e2e';
import { raceAbort } from 'e2e/engine';
import { AgentMailRejected, agentMailApi, E2E_EXPIRES_KEY, E2E_INBOX_KEY, type AgentMailApi } from './client.ts';

const AGENTMAIL_API_KEY = 'AGENTMAIL_API_KEY';

/** The `clientId` of the inbox aliases come from when none is named: created once per organization, then reused by every run. */
const SHARED_INBOX_CLIENT_ID = 'e2e-shared-inbox';

/**
 * How long an inbox of its own may live before a later run sweeps it: a run
 * killed before it released one would otherwise hold the plan's inbox quota
 * for good. Far longer than an attempt, a serial group, or an `e2e mcp`
 * session runs.
 */
const INBOX_TTL_MS = 6 * 60 * 60 * 1000;

/** The budget of creating the shared inbox, which every caller waits on, whoever asked first. */
const SHARED_INBOX_MS = 30_000;

/**
 * How far before its lease an alias's listing starts: AgentMail stamps a
 * message with its own clock, which may run behind this machine's.
 */
const CLOCK_SKEW_MS = 60_000;

export type AgentMailOptions =
  | {
      /**
       * `alias` (default): each address is a plus-address of one shared
       * inbox, `<inbox>+e2e-3f9a2c1b7d@agentmail.to`. Nothing is created per
       * address, so any number of workers fit the free plan's three inboxes.
       * An address reads only mail whose To or Cc names it exactly, and its
       * mail is deleted when its attempt ends. The app under test must accept
       * a `+` in an address.
       */
      readonly isolation?: 'alias' | undefined;
      /** The inbox aliases come from; default an `e2e` inbox created in the organization on first use and reused by every run. */
      readonly inboxId?: string | undefined;
      readonly domain?: never;
      readonly displayName?: never;
    }
  | {
      /**
       * `inbox`: a new inbox per address, deleted when its attempt ends. Each
       * one counts against the plan's inbox limit while it lives; one a
       * killed run left behind is deleted by a later run six hours on.
       */
      readonly isolation: 'inbox';
      readonly inboxId?: never;
      /** A verified custom domain; default `agentmail.to`. */
      readonly domain?: string | undefined;
      readonly displayName?: string | undefined;
    };

interface AgentMailLease extends MailLease {
  /** The inbox the address receives in. */
  readonly inboxId: string;
  /** An alias shares its inbox: a message counts only when its To or Cc names the address. */
  readonly alias: boolean;
  /** Where the listing starts. */
  readonly since: Date;
}

/**
 * AgentMail for `email: agentMail()`: each address a plus-address alias of
 * one shared inbox, or with `isolation: 'inbox'` an inbox of its own.
 * `AGENTMAIL_API_KEY` comes from the environment.
 */
export function agentMail(options: AgentMailOptions = {}): MailProvider<AgentMailLease> {
  const clients = new Map<string, AgentMailApi>();
  const sharedInboxes = new Map<AgentMailApi, Promise<string>>();
  const swept = new Set<AgentMailApi>();
  const clientFor = (): AgentMailApi => {
    const apiKey = process.env[AGENTMAIL_API_KEY]?.trim();
    if (apiKey === undefined || apiKey === '') throw new AgentMailRejected(`${AGENTMAIL_API_KEY} is not set; create a key at https://console.agentmail.to`);
    let client = clients.get(apiKey);
    if (client === undefined) {
      client = agentMailApi(apiKey);
      clients.set(apiKey, client);
    }
    return client;
  };
  const sharedInbox = (client: AgentMailApi, signal: AbortSignal): Promise<string> => {
    let inbox = sharedInboxes.get(client);
    if (inbox === undefined) {
      // Shared by every caller, so it runs under a budget of its own rather than the first caller's signal.
      inbox = client.createInbox({ clientId: SHARED_INBOX_CLIENT_ID, displayName: 'e2e' }, AbortSignal.timeout(SHARED_INBOX_MS));
      inbox.catch(() => sharedInboxes.delete(client));
      sharedInboxes.set(client, inbox);
    }
    return raceAbort(inbox, signal, 'creating the shared inbox');
  };
  /** Deletes the inboxes of their own that runs left behind past their time, once per process; best effort. */
  const sweep = async (client: AgentMailApi, signal: AbortSignal): Promise<void> => {
    if (swept.has(client)) return;
    swept.add(client);
    const now = Date.now();
    const stale = (await client.e2eInboxes(signal).catch(() => [])).filter((inbox) => Date.parse(inbox.expiresAt) < now);
    await Promise.allSettled(stale.map((inbox) => client.deleteInbox(inbox.inboxId, signal)));
  };
  /** The recipients a listed message names, bare and lowercased. */
  const recipients = (summary: MailSummary): string[] =>
    [...summary.to, ...(summary.cc ?? [])].map((value) => (/<([^<>\s]+)>\s*$/u.exec(value)?.[1] ?? value).trim().toLowerCase());
  const received = async (lease: AgentMailLease, signal: AbortSignal): Promise<MailSummary[]> => {
    const listed = await clientFor().received(lease.inboxId, lease.since, signal);
    return lease.alias ? listed.filter((summary) => recipients(summary).includes(lease.address)) : listed;
  };
  return {
    name: 'agentmail',
    async acquire({ signal, runId }) {
      const client = clientFor();
      const since = new Date(Date.now() - CLOCK_SKEW_MS);
      if (options.isolation === 'inbox') {
        await sweep(client, signal);
        const inboxId = await client.createInbox(
          {
            clientId: `e2e-${randomBytes(12).toString('hex')}`,
            ...(options.domain === undefined ? {} : { domain: options.domain }),
            ...(options.displayName === undefined ? {} : { displayName: options.displayName }),
            metadata: { [E2E_INBOX_KEY]: true, [E2E_EXPIRES_KEY]: new Date(Date.now() + INBOX_TTL_MS).toISOString(), e2e_run: runId },
          },
          signal,
        );
        return { address: inboxId, inboxId, alias: false, since };
      }
      const base = options.inboxId ?? (await sharedInbox(client, signal));
      const at = base.lastIndexOf('@');
      if (at <= 0 || base.slice(0, at).includes('+')) {
        throw new AgentMailRejected(`inboxId ${JSON.stringify(base)} is not an AgentMail inbox address; name the inbox itself, not an alias of it`);
      }
      const alias = `${base.slice(0, at)}+e2e-${randomBytes(5).toString('hex')}${base.slice(at)}`.toLowerCase();
      return { address: alias, inboxId: base, alias: true, since };
    },
    async release(lease, { signal }) {
      const client = clientFor();
      if (!lease.alias) {
        await client.deleteInbox(lease.inboxId, signal);
        return;
      }
      // An alias's codes and links would otherwise sit in the shared inbox for good.
      const mail = await received(lease, signal);
      await Promise.all(mail.map((summary) => client.deleteMessage(lease.inboxId, summary.id, signal)));
    },
    list: (lease, { signal }) => received(lease, signal),
    read: (lease, id, { signal }) => clientFor().message(lease.inboxId, id, signal),
  };
}
