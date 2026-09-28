import 'reflect-metadata';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { GroqLlmProvider } from '../../../src/services/providers/llm/GroqLlmProvider';
import type { LlmMessage } from '../../../src/services/providers/llm/ILlmProvider';

/**
 * Regression: GroqLlmProvider.doGenerateStream with no reasoning params called
 * `super.generateStream(...)` — the LlmProviderBase template wrapper — instead
 * of `super.doGenerateStream(...)`. The wrapper re-dispatches `doGenerateStream`
 * via virtual dispatch straight back into the Groq override: infinite
 * recursion, `RangeError: Maximum call stack size exceeded` after ~185 ms,
 * one provider_call_logs row per recursion level, and — when the call happens
 * through a fire-and-forget callback (voice turn filler LLM) — an unhandled
 * rejection that kills the process.
 *
 * The base URL points at a dead local port: the recursion (pre-fix) happens
 * before any network activity, and post-fix the attempt fails fast with a
 * connection error. Either way the error must never be a stack overflow.
 */

const DEAD_BASE_URL = 'http://127.0.0.1:9';

const MESSAGES: LlmMessage[] = [
  { role: 'system', content: 'You are a test assistant.' },
  { role: 'user', content: 'Hello' },
];

function createProvider(settings: Record<string, unknown>): GroqLlmProvider {
  return new GroqLlmProvider({ apiKey: 'fake-key', baseUrl: DEAD_BASE_URL }, settings as never);
}

async function streamOnce(provider: GroqLlmProvider): Promise<unknown> {
  provider.setOnError(() => Promise.resolve());
  try {
    await provider.generateStream(MESSAGES);
    return null;
  } catch (error) {
    return error;
  }
}

function assertNotStackOverflow(error: unknown): void {
  expect(error, 'generateStream should reject (dead endpoint)').to.be.instanceOf(Error);
  const message = (error as Error).message;
  expect(message, `must not be a stack overflow, got: ${message}`).to.not.include('Maximum call stack size exceeded');
}

describe('GroqLlmProvider streaming (super-call regression)', () => {
  it('rejects with a connection error, not a stack overflow, when no reasoning params are set', async function () {
    this.timeout(10_000);
    const provider = createProvider({ model: 'openai/gpt-oss-20b' });
    await provider.init();

    const error = await streamOnce(provider);

    assertNotStackOverflow(error);
  });

  it('still rejects with a connection error (not a stack overflow) when reasoning params are set', async function () {
    this.timeout(10_000);
    const provider = createProvider({ model: 'openai/gpt-oss-20b', includeReasoning: true });
    await provider.init();

    const error = await streamOnce(provider);

    assertNotStackOverflow(error);
  });
});
