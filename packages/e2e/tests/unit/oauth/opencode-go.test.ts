import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerHints } from '../../../src/agent/model/provider-hints.ts';
import { USER_AGENT } from '../../../src/internal/client-identity.ts';
import { opencodeGo } from '../../../src/oauth/opencode-go.ts';
import { json, useServers, useVendor, type Received } from './helpers/server.ts';

const serve = useServers(afterEach);
const vendor = useVendor(afterEach);

/** A Go stand-in that answers each API in its own shape and records what it was sent. */
async function go() {
  return serve((request, response) => {
    if (request.url.endsWith('/responses')) {
      return json(response, 200, {
        id: 'resp_1',
        created_at: 1,
        model: 'gpt-6-luna',
        output: [{ type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'responses', annotations: [] }] }],
        usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      });
    }
    if (request.url.endsWith('/messages')) {
      return json(response, 200, {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'qwen3.8-max',
        content: [{ type: 'text', text: 'messages' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 7, output_tokens: 3 },
      });
    }
    return json(response, 200, {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 0,
      model: 'kimi-k3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'chat' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
    });
  });
}

describe('opencodeGo', () => {
  it.each([
    { modelId: 'gpt-6-luna', path: '/zen/go/v1/responses', text: 'responses' },
    { modelId: 'grok-4.7', path: '/zen/go/v1/responses', text: 'responses' },
    { modelId: 'qwen3.8-flash', path: '/zen/go/v1/messages', text: 'messages' },
    { modelId: 'minimax-m3', path: '/zen/go/v1/messages', text: 'messages' },
    { modelId: 'kimi-k3', path: '/zen/go/v1/chat/completions', text: 'chat' },
    { modelId: 'qwen3.8-max', path: '/zen/go/v1/chat/completions', text: 'chat' },
  ])('calls $modelId over $path with the key, the e2e user agent, and the runner\'s session', async ({ modelId, path, text }) => {
    const server = await go();
    vendor(server, {});
    vi.stubEnv('OPENCODE_API_KEY', 'go-key');

    const result = await generateText({ model: opencodeGo(modelId), prompt: 'hi', headers: { 'x-session-affinity': 'step-1' } });

    expect(result.text).toBe(text);
    const [sent] = server.requests as [Received];
    expect(sent.url).toBe(path);
    expect(sent.headers['authorization']).toBe('Bearer go-key');
    expect(sent.headers['x-opencode-session']).toBe('step-1');
    expect(sent.headers['user-agent']?.startsWith(`${USER_AGENT} `)).toBe(true);
    expect(sent.headers['user-agent']).toContain(' ai/');
    if (path.endsWith('/messages')) expect(sent.headers['x-api-key']).toBe('go-key');
    if (path.endsWith('/responses')) expect(JSON.parse(sent.body)).toMatchObject({ store: false });
  });

  it('lifts the Anthropic SDK\'s 4096-token cap on a Messages call that sets no limit, and keeps a set one', async () => {
    const server = await go();
    vendor(server, {});
    vi.stubEnv('OPENCODE_API_KEY', 'go-key');

    await generateText({ model: opencodeGo('minimax-m3'), prompt: 'act turn' });
    await generateText({ model: opencodeGo('minimax-m3'), prompt: 'judgment', maxOutputTokens: 512 });

    expect(server.requests.map((request) => JSON.parse(request.body).max_tokens)).toEqual([131_072, 512]);
  });

  it('carries the runner\'s prompt-cache breakpoint on a Messages model', async () => {
    const server = await go();
    vendor(server, {});
    vi.stubEnv('OPENCODE_API_KEY', 'go-key');
    const model = opencodeGo('qwen3.8-flash');

    await generateText({ model, instructions: providerHints(model).instructions('rules'), prompt: 'hi' });

    expect(JSON.parse(server.requests[0]!.body).system).toEqual([{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } }]);
  });

  it('keeps one session per model instance for a caller outside the runner', async () => {
    const server = await go();
    vendor(server, {});
    vi.stubEnv('OPENCODE_API_KEY', 'go-key');
    const model = opencodeGo('kimi-k3');

    await generateText({ model, prompt: 'one' });
    await generateText({ model, prompt: 'two' });
    await generateText({ model: opencodeGo('kimi-k3'), prompt: 'other' });

    const sessions = server.requests.map((request) => request.headers['x-opencode-session']);
    expect(sessions[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sessions[1]).toBe(sessions[0]);
    expect(sessions[2]).not.toBe(sessions[0]);
  });

  it('sends nothing without OPENCODE_API_KEY, never another provider\'s key', async () => {
    const server = await go();
    vendor(server, {});
    vi.stubEnv('OPENCODE_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', 'sk-openai');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant');

    for (const modelId of ['gpt-6-luna', 'minimax-m3', 'kimi-k3']) {
      await expect(generateText({ model: opencodeGo(modelId), prompt: 'hi', maxRetries: 0 })).rejects.toMatchObject({
        code: 'MISCONFIGURED',
        message: 'OPENCODE_API_KEY is not set; copy your OpenCode Go key from https://opencode.ai/auth',
      });
    }
    expect(server.requests).toEqual([]);
  });

  it('names the protocol it calls before the first call', () => {
    expect(opencodeGo('gpt-6-luna')).toMatchObject({ provider: 'opencode-go.responses', modelId: 'gpt-6-luna' });
    expect(opencodeGo('minimax-m3')).toMatchObject({ provider: 'opencode-go.messages' });
    expect(opencodeGo('glm-5.3')).toMatchObject({ provider: 'opencode-go.chat' });
  });
});
