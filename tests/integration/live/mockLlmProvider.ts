import 'reflect-metadata';
import { LlmProviderBase } from '../../../src/services/providers/llm/LlmProviderBase';
import type { LlmMessage, LlmGenerationResult, LlmGenerationOptions } from '../../../src/services/providers/llm/ILlmProvider';
import type { LlmModelInfo } from '../../../src/services/providers/ProviderCatalogService';

/**
 * Mock LLM provider for deterministic integration tests.
 *
 * Extends LlmProviderBase (P1-03) so that going through the base's template
 * wrappers produces real provider_call_logs rows when the harness stamps
 * `providerId`/`providerApiType` (ConversationTestHarness does this). When
 * constructed and used directly (unit-level tests) without stamping, recording
 * is a no-op and behavior is identical to the old standalone mock.
 *
 * Usage:
 *   const mock = new MockLlmProvider();
 *   mock.queueResponse('Hello, world!');
 *   mock.queueResponse('How can I help?');
 *   // Each call to generate() pops the next queued response.
 *   // When exhausted, returns the last queued response.
 *
 * Call capture: every generate()/generateStream() call stores the messages array for assertion.
 */
export class MockLlmProvider extends LlmProviderBase<Record<string, unknown>> {
  private responses: LlmGenerationResult[] = [];
  private callIndex = 0;

  /** All messages passed to generate()/generateStream(), in order. */
  public calls: LlmMessage[][] = [];

  /** Public view of the base's protected init flag (tests assert on this). */
  get initialized(): boolean {
    return this.isInitialized();
  }

  constructor() {
    super({});
  }

  /**
   * Queue a text response. Each call pushes a new response in order.
   */
  queueResponse(text: string, options?: { role?: 'assistant' | 'system' | 'user' | 'tool'; finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' }): void {
    this.responses.push({
      id: `mock_${this.responses.length}`,
      content: [{ contentType: 'text', text }],
      role: options?.role ?? 'assistant',
      finishReason: options?.finishReason ?? 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
  }

  /**
   * Queue a structured LlmGenerationResult directly.
   */
  queueResult(result: LlmGenerationResult): void {
    this.responses.push(result);
  }

  async init(): Promise<void> {
    this.initialized = true;
  }

  /** Pops the next queued response (or the last one when exhausted, or an empty one when none queued). */
  private nextResult(): LlmGenerationResult {
    if (this.callIndex < this.responses.length) {
      return this.responses[this.callIndex++];
    }
    if (this.responses.length > 0) {
      return this.responses[this.responses.length - 1];
    }
    return {
      id: `mock_empty_${this.callIndex++}`,
      content: [{ contentType: 'text', text: '' }],
      role: 'assistant',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  protected async doGenerate(messages: LlmMessage[], _options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.calls.push(messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : [...m.content] })));
    return this.nextResult();
  }

  protected async doGenerateStream(messages: LlmMessage[], _options?: LlmGenerationOptions): Promise<void> {
    this.calls.push(messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : [...m.content] })));
    const result = this.nextResult();

    // Feed the base's notify* hooks so streaming stats (TTFT, chunk count, usage)
    // are recorded on the provider_call_logs row.
    await this.notifyStarted();
    const textContent = result.content.find(c => c.contentType === 'text');
    if (textContent) {
      await this.notifyChunk(textContent.text, result.id, result.role, result.finishReason ?? undefined, result.usage);
    }
    await this.notifyComplete(result);
  }

  protected async doEnumerateModels(): Promise<LlmModelInfo[]> {
    return [{ id: 'mock-model', name: 'Mock Model', contextWindow: 128000 }];
  }

  /** Whether moderation should flag input. */
  public moderationFlagged = false;
  public moderationCategories: string[] = [];

  protected async doModerateUserInput(_input: string): Promise<{ flagged: boolean; categories: string[] }> {
    return { flagged: this.moderationFlagged, categories: this.moderationCategories };
  }

  async cleanup(): Promise<void> {
    await super.cleanup();
    this.initialized = false;
  }

  /** Reset all state for a fresh test. */
  reset(): void {
    this.responses = [];
    this.callIndex = 0;
    this.calls = [];
    this.initialized = false;
    this.onChunkCallback = undefined;
    this.onGenerationStartedCallback = undefined;
    this.onGenerationCompletedCallback = undefined;
    this.onErrorCallback = undefined;
  }
}
