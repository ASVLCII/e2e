/**
 * An in-memory AgentMail organization behind the SDK's surface: `sdk` is what
 * `vi.mock('agentmail', ...)` hands the provider, `org` what the test reads.
 * Inboxes are created by `clientId`; received mail is listed oldest first
 * from `after`, the way the API serves it; `failNext` makes the next call
 * fail with a status and body, as `AgentMailError` carries them.
 */

interface FakeMessage {
  readonly messageId: string;
  readonly threadId: string;
  readonly labels: string[];
  readonly timestamp: Date;
  readonly createdAt: Date;
  readonly from: string;
  readonly to: string[];
  readonly cc?: string[];
  readonly subject?: string;
  readonly text?: string;
  readonly html?: string;
}

interface FakeInbox {
  readonly clientId: string | undefined;
  readonly metadata: Record<string, unknown> | undefined;
  readonly messages: FakeMessage[];
}

class AgentMailError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: unknown = {},
  ) {
    super(`Status code: ${statusCode}\nBody: ${JSON.stringify(body)}`);
  }
}

/** The organization every client of the mocked module talks to. */
export const org = {
  apiKeys: [] as string[],
  inboxes: new Map<string, FakeInbox>(),
  created: [] as { clientId?: string; domain?: string; displayName?: string; metadata?: Record<string, unknown> }[],
  deleted: [] as string[],
  deletedMessages: [] as string[],
  listedAfter: [] as (Date | undefined)[],
  failures: [] as AgentMailError[],
  counter: 0,
  clock: 1_790_000_000_000,
  reset(): void {
    this.apiKeys = [];
    this.inboxes.clear();
    this.created = [];
    this.deleted = [];
    this.deletedMessages = [];
    this.listedAfter = [];
    this.failures = [];
    this.counter = 0;
    this.clock = Date.now();
  },
  /** The next SDK call fails with this status and body. */
  failNext(statusCode: number, body: unknown = {}): void {
    this.failures.push(new AgentMailError(statusCode, body));
  },
  /** Delivers an email into `inbox` with these headers, stamped now. */
  deliver(inboxId: string, message: { to: string[]; cc?: string[]; from?: string; subject?: string; text?: string; html?: string }): FakeMessage {
    const inbox = this.inboxes.get(inboxId);
    if (inbox === undefined) throw new Error(`no inbox ${inboxId}`);
    this.counter += 1;
    this.clock += 1000;
    const delivered: FakeMessage = {
      messageId: `<m${this.counter}@mail>`,
      threadId: `t${this.counter}`,
      labels: ['received', 'unread'],
      timestamp: new Date(this.clock - 700),
      createdAt: new Date(this.clock),
      from: message.from ?? 'Acme <noreply@acme.test>',
      to: message.to,
      ...(message.cc === undefined ? {} : { cc: message.cc }),
      ...(message.subject === undefined ? {} : { subject: message.subject }),
      ...(message.text === undefined ? {} : { text: message.text }),
      ...(message.html === undefined ? {} : { html: message.html }),
    };
    inbox.messages.push(delivered);
    return delivered;
  },
};

function failing(): void {
  const failure = org.failures.shift();
  if (failure !== undefined) throw failure;
}

function inboxOf(inboxId: string): FakeInbox {
  const inbox = org.inboxes.get(inboxId);
  if (inbox === undefined) throw new AgentMailError(404, { message: 'Inbox not found' });
  return inbox;
}

type Options = object | undefined;

class AgentMailClient {
  constructor({ apiKey }: { apiKey: string }) {
    org.apiKeys.push(apiKey);
  }

  inboxes = {
    create: async (request: { clientId?: string; domain?: string; displayName?: string; metadata?: Record<string, unknown> } = {}, _options?: Options) => {
      failing();
      org.created.push(request);
      for (const [inboxId, inbox] of org.inboxes) {
        if (request.clientId !== undefined && inbox.clientId === request.clientId) return { inboxId, email: inboxId };
      }
      org.counter += 1;
      const inboxId = `inbox${org.counter}@${request.domain ?? 'agentmail.to'}`;
      org.inboxes.set(inboxId, { clientId: request.clientId, metadata: request.metadata, messages: [] });
      return { inboxId, email: inboxId };
    },
    delete: async (inboxId: string, _options?: Options) => {
      failing();
      inboxOf(inboxId);
      org.inboxes.delete(inboxId);
      org.deleted.push(inboxId);
    },
    list: async (_request: unknown, _options?: Options) => {
      failing();
      return { count: org.inboxes.size, inboxes: [...org.inboxes].map(([inboxId, inbox]) => ({ inboxId, email: inboxId, metadata: inbox.metadata })) };
    },
    messages: {
      list: async (inboxId: string, request: { labels?: string[]; after?: Date; ascending?: boolean; pageToken?: string }, _options?: Options) => {
        failing();
        org.listedAfter.push(request.after);
        const messages = inboxOf(inboxId).messages.filter(
          (message) => (request.labels ?? []).every((label) => message.labels.includes(label)) && (request.after === undefined || message.createdAt > request.after),
        );
        const ordered = request.ascending === true ? messages : messages.toReversed();
        const page = request.pageToken === undefined ? ordered.slice(0, 2) : ordered.slice(2);
        return {
          count: page.length,
          messages: page.map(({ text: _text, html: _html, ...item }) => item),
          ...(request.pageToken === undefined && ordered.length > 2 ? { nextPageToken: 'next' } : {}),
        };
      },
      get: async (inboxId: string, messageId: string, _options?: Options) => {
        failing();
        const message = inboxOf(inboxId).messages.find((candidate) => candidate.messageId === messageId);
        if (message === undefined) throw new AgentMailError(404, { message: 'Message not found' });
        return message;
      },
      delete: async (inboxId: string, messageId: string, _options?: Options) => {
        failing();
        const inbox = inboxOf(inboxId);
        const index = inbox.messages.findIndex((candidate) => candidate.messageId === messageId);
        if (index === -1) throw new AgentMailError(404, { message: 'Message not found' });
        inbox.messages.splice(index, 1);
        org.deletedMessages.push(messageId);
      },
    },
  };
}

/** The mocked module: the two names the provider imports from `agentmail`. */
export const sdk = { AgentMailClient, AgentMailError };
