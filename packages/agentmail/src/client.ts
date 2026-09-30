/** The slice of the AgentMail SDK the provider uses, loaded on first use so a config load never pays for it. */

import type { AgentMail } from 'agentmail';
import type { MailMessage, MailSummary } from 'e2e';

export interface AgentMailApi {
  /** Creates an inbox, or returns the one an earlier create with the same `clientId` made. */
  createInbox(request: AgentMail.inboxes.CreateInboxRequest, signal: AbortSignal): Promise<string>;
  /** Deletes an inbox; one AgentMail no longer knows counts as deleted. */
  deleteInbox(inboxId: string, signal: AbortSignal): Promise<void>;
  /** The organization's inboxes whose metadata marks them as e2e's, with when each one may be swept. */
  e2eInboxes(signal: AbortSignal): Promise<{ readonly inboxId: string; readonly expiresAt: string }[]>;
  /** Every message the inbox received after `after`, or before `before`, oldest first. */
  received(inboxId: string, window: { readonly after: Date } | { readonly before: Date }, signal: AbortSignal): Promise<MailSummary[]>;
  message(inboxId: string, messageId: string, signal: AbortSignal): Promise<MailMessage>;
  /** Deletes a message; one AgentMail no longer knows counts as deleted. */
  deleteMessage(inboxId: string, messageId: string, signal: AbortSignal): Promise<void>;
}

/** Metadata keys that mark an inbox as created by e2e and say when a sweep may delete it. */
export const E2E_INBOX_KEY = 'e2e';
export const E2E_EXPIRES_KEY = 'e2e_expires_at';

/**
 * The listing's filters. A test inbox takes mail from dev SMTP servers and
 * transactional providers whose domain rarely passes SPF or DMARC, and a
 * verification email that lands in spam is still the email the test waits for.
 */
const RECEIVED = {
  labels: ['received'],
  ascending: true,
  includeSpam: true,
  includeUnauthenticated: true,
  limit: 100,
} satisfies AgentMail.inboxes.ListMessagesRequest;

/**
 * Reads the runner polls are not retried by the SDK: its retry sleeps on
 * `Retry-After` past the caller's deadline, and the runner's wait already
 * polls again within its own. Creating an inbox (idempotent by `clientId`)
 * and deleting keep the SDK's retries: nothing retries them above.
 */
const READ = { maxRetries: 0, timeoutInSeconds: 20 } as const;
const WRITE = { timeoutInSeconds: 20 } as const;

/** An AgentMail failure a retry will not fix: a rejected key, a quota, a rejected message. */
export class AgentMailRejected extends Error {
  readonly retryable = false;
}

/** The SDK module, imported once per process by the first call of any client. */
let sdkModule: Promise<typeof import('agentmail')> | undefined;

/** AgentMail for one API key, through the SDK. */
export function agentMailApi(apiKey: string): AgentMailApi {
  let sdk: Promise<{ client: InstanceType<typeof import('agentmail').AgentMailClient>; AgentMailError: typeof import('agentmail').AgentMailError }> | undefined;
  /** The SDK and this key's client, loaded by the first call that needs them. */
  const load = () => (sdk ??= (sdkModule ??= import('agentmail')).then((module) => ({ client: new module.AgentMailClient({ apiKey }), AgentMailError: module.AgentMailError })));
  /** Runs one SDK call, its failure worded for a test log: the API's own message and fix, not its raw JSON. */
  const call = async <T>(run: (client: InstanceType<typeof import('agentmail').AgentMailClient>) => Promise<T>, notFound?: () => T): Promise<T> => {
    const { client, AgentMailError } = await load();
    try {
      return await run(client);
    } catch (cause) {
      if (!(cause instanceof AgentMailError) || cause.statusCode === undefined) throw cause;
      if (cause.statusCode === 404 && notFound !== undefined) return notFound();
      const body = (typeof cause.body === 'object' && cause.body !== null ? cause.body : {}) as { message?: unknown; fix?: unknown; code?: unknown };
      const said = [body.message, body.fix].filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
      if (cause.statusCode === 401 || (cause.statusCode === 403 && body.message === 'Forbidden')) {
        throw new AgentMailRejected('AgentMail rejected AGENTMAIL_API_KEY; create a key at https://console.agentmail.to', { cause });
      }
      const message = `AgentMail answered ${cause.statusCode}${said === '' ? '' : `: ${said}`}`;
      const retryable = cause.statusCode === 408 || cause.statusCode === 429 || cause.statusCode >= 500;
      throw retryable ? new Error(message, { cause }) : new AgentMailRejected(message, { cause });
    }
  };
  return {
    createInbox: (request, signal) => call(async (client) => (await client.inboxes.create(request, { ...WRITE, abortSignal: signal })).inboxId),
    deleteInbox: (inboxId, signal) => call(async (client) => void (await client.inboxes.delete(inboxId, { ...WRITE, abortSignal: signal })), () => undefined),
    e2eInboxes: (signal) =>
      call(async (client) => {
        const found: { inboxId: string; expiresAt: string }[] = [];
        let pageToken: string | undefined;
        do {
          const page = await client.inboxes.list({ limit: 100, ...(pageToken === undefined ? {} : { pageToken }) }, { ...READ, abortSignal: signal });
          for (const inbox of page.inboxes) {
            const expiresAt = inbox.metadata?.[E2E_EXPIRES_KEY];
            if (inbox.metadata?.[E2E_INBOX_KEY] === true && typeof expiresAt === 'string') found.push({ inboxId: inbox.inboxId, expiresAt });
          }
          pageToken = page.nextPageToken;
        } while (pageToken !== undefined);
        return found;
      }),
    received: (inboxId, window, signal) =>
      call(async (client) => {
        const summaries: MailSummary[] = [];
        let pageToken: string | undefined;
        do {
          const page = await client.inboxes.messages.list(inboxId, { ...RECEIVED, ...window, ...(pageToken === undefined ? {} : { pageToken }) }, { ...READ, abortSignal: signal });
          summaries.push(...page.messages.map(summary));
          pageToken = page.nextPageToken;
        } while (pageToken !== undefined);
        return summaries;
      }),
    message: (inboxId, messageId, signal) =>
      call(async (client) => {
        const message = await client.inboxes.messages.get(inboxId, messageId, { ...READ, abortSignal: signal });
        return { ...summary(message), text: message.text, html: message.html };
      }),
    deleteMessage: (inboxId, messageId, signal) => call(async (client) => void (await client.inboxes.messages.delete(inboxId, messageId, { ...WRITE, abortSignal: signal })), () => undefined),
  };
}

/**
 * A listed message. `receivedAt` is when AgentMail stored it, not the sender's
 * `Date` header, which has one-second resolution and is the sender's clock.
 */
function summary(message: AgentMail.MessageItem): MailSummary {
  return {
    id: message.messageId,
    from: message.from,
    to: message.to,
    cc: message.cc ?? [],
    subject: message.subject ?? '',
    receivedAt: message.createdAt,
  };
}
