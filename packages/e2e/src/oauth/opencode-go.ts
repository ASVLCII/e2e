/**
 * `opencodeGo('kimi-k3')`: an OpenCode Go subscription as an AI SDK model.
 * Go serves each model over the API of its family, so the instance is the
 * AI SDK model for that API pointed at Go: `@ai-sdk/openai`'s Responses
 * model for GPT, Grok, and Muse Spark, `@ai-sdk/anthropic`'s Messages model
 * for MiniMax and Qwen 3.8 Flash, and `@ai-sdk/openai-compatible`'s chat
 * model for the rest. Each package is imported on the first call, so a project installs
 * only the one its model needs.
 *
 * Go asks a client to name itself in the user agent and to send one stable
 * `x-opencode-session` per conversation. The runner sends a conversation id
 * on every model call (`SESSION_HEADER`); the fetch here copies it into
 * OpenCode's header.
 */

import { randomUUID } from 'node:crypto';
import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { SESSION_HEADER, USER_AGENT } from '../internal/client-identity.ts';
import { OAuthError } from './errors.ts';
import { withoutServerStorage } from './responses.ts';
import type { FetchFunction } from './types.ts';

const GO_API_URL = 'https://opencode.ai/zen/go/v1';
/**
 * The output limit of every model Go serves over Messages (models.dev). The
 * Anthropic SDK does not know these models and would cap a call that sets no
 * limit, such as an act turn, at 4096 tokens, too few for a reasoning model.
 */
const MESSAGES_MAX_OUTPUT_TOKENS = 131_072;
const OPENCODE_SESSION_HEADER = 'x-opencode-session';

/** The API a Go model is served over: `/responses`, `/messages`, or `/chat/completions`. */
type Protocol = 'responses' | 'messages' | 'chat';

export function opencodeGo(modelId: string): LanguageModelV4 {
  const protocol = protocolFor(modelId);
  const fetch = goFetch(() => process.env['OPENCODE_API_KEY']);
  let model: Promise<LanguageModelV4> | undefined;
  const settle = () => (model ??= createModel(modelId, protocol, fetch));
  return {
    specificationVersion: 'v4',
    provider: `opencode-go.${protocol}`,
    modelId,
    supportedUrls: {},
    doGenerate: async (callOptions) => (await settle()).doGenerate(callOptions),
    doStream: async (callOptions) => (await settle()).doStream(callOptions),
  };
}

/**
 * The API a model is served over, as models.dev lists it for `opencode-go`:
 * the catalog OpenCode itself routes by, so the requests look like its own.
 */
function protocolFor(modelId: string): Protocol {
  if (/^(?:gpt-|grok-|muse-spark-)/u.test(modelId)) return 'responses';
  if (modelId.startsWith('minimax-') || modelId === 'qwen3.8-flash') return 'messages';
  return 'chat';
}

/**
 * Sends each request with the key in place of the constructor's placeholder
 * (as a bearer token, and as `x-api-key` where the Anthropic SDK sends one),
 * the e2e user agent ahead of the SDK's when the runner did not set it, and
 * the conversation id as `x-opencode-session`: the runner's, or one per model
 * instance for a caller outside the runner. The key is read per request, so a
 * config without it loads and only a model call fails.
 */
function goFetch(apiKey: () => string | undefined, upstream: FetchFunction = globalThis.fetch): FetchFunction {
  const instanceSession = randomUUID();
  return async (input, init) => {
    const key = apiKey();
    if (key === undefined || key === '') {
      throw new OAuthError('MISCONFIGURED', 'OPENCODE_API_KEY is not set; copy your OpenCode Go key from https://opencode.ai/auth');
    }
    const request = new Request(input, init);
    const headers = new Headers(request.headers);
    headers.set('authorization', `Bearer ${key}`);
    if (headers.has('x-api-key')) headers.set('x-api-key', key);
    const agent = headers.get('user-agent') ?? '';
    if (!agent.startsWith('e2e/')) headers.set('user-agent', `${USER_AGENT} ${agent}`.trim());
    if (!headers.has(OPENCODE_SESSION_HEADER)) headers.set(OPENCODE_SESSION_HEADER, headers.get(SESSION_HEADER) ?? instanceSession);
    return upstream(new Request(request, { headers }));
  };
}

/**
 * The AI SDK model for `protocol`, importing its package only now. The key
 * header each SDK sets is replaced per request; the value only satisfies the
 * constructor.
 */
async function createModel(modelId: string, protocol: Protocol, fetch: FetchFunction): Promise<LanguageModelV4> {
  const name = `opencode-go.${protocol}`;
  switch (protocol) {
    case 'responses': {
      const { createOpenAI } = await load(() => import('@ai-sdk/openai'), '@ai-sdk/openai', modelId);
      return withoutServerStorage(createOpenAI({ apiKey: 'go', baseURL: GO_API_URL, fetch, name }).responses(modelId));
    }
    case 'messages': {
      const { createAnthropic } = await load(() => import('@ai-sdk/anthropic'), '@ai-sdk/anthropic', modelId);
      return withOutputLimit(createAnthropic({ apiKey: 'go', baseURL: GO_API_URL, fetch, name })(modelId), MESSAGES_MAX_OUTPUT_TOKENS);
    }
    case 'chat': {
      const { createOpenAICompatible } = await load(() => import('@ai-sdk/openai-compatible'), '@ai-sdk/openai-compatible', modelId);
      return createOpenAICompatible({ apiKey: 'go', baseURL: GO_API_URL, fetch, name, includeUsage: true }).chatModel(modelId);
    }
  }
}

/** Sends `limit` as the output limit of a call that sets none. */
function withOutputLimit(model: LanguageModelV4, limit: number): LanguageModelV4 {
  const limited = (options: LanguageModelV4CallOptions): LanguageModelV4CallOptions => ({ ...options, maxOutputTokens: options.maxOutputTokens ?? limit });
  return {
    specificationVersion: model.specificationVersion,
    provider: model.provider,
    modelId: model.modelId,
    get supportedUrls() {
      return model.supportedUrls;
    },
    doGenerate: (options) => model.doGenerate(limited(options)),
    doStream: (options) => model.doStream(limited(options)),
  };
}

/** Imports the package a protocol needs, naming it when it is not installed. */
async function load<Module>(importer: () => Promise<Module>, specifier: string, modelId: string): Promise<Module> {
  try {
    return await importer();
  } catch (cause) {
    throw new OAuthError('MISCONFIGURED', `OpenCode Go serves ${modelId} through ${specifier}; install it`, { cause });
  }
}
