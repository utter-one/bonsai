import type { ILlmProvider, LlmMessage, LlmGenerationResult, LlmGenerationOptions, LlmChunk, LlmChunkCallback, SimpleCallback, LlmCompleteCallback, ErrorCallback } from '../../../src/services/providers/llm/ILlmProvider';
import type { LlmModelInfo } from '../../../src/services/providers/ProviderCatalogService';

/**
 * Mock LLM provider for deterministic integration tests.
 *
 * Usage:
 *   const mock = new MockLlmProvider();
 *   mock.queueResponse('Hello, world!');
 *   mock.queueResponse('How can I help?');
 *   // Each call to generate() pops the next queued response.
 *   // When exhausted, returns the last queued response.
 *
 * Call capture: every generate() call stores the messages array for assertion.
 */
export class MockLlmProvider implements ILlmProvider {
  private responses: LlmGenerationResult[] = [];
  private callIndex = 0;
  public initialized = false;

  /** All messages passed to generate(), in order. */
  public calls: LlmMessage[][] = [];

  /** Chunk callback set via setOnChunk. */
  public onChunk: LlmChunkCallback | null = null;
  /** Generation-start callback. */
  public onGenerationStarted: SimpleCallback | null = null;
  /** Generation-completed callback. */
  public onGenerationCompleted: LlmCompleteCallback | null = null;
  /** Error callback. */
  public onError: ErrorCallback | null = null;

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

  async generate(messages: LlmMessage[], _options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.calls.push(messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : [...m.content] })));

    if (this.callIndex < this.responses.length) {
      return this.responses[this.callIndex++];
    }

    // Fallback: return last response (prevents test crashes)
    if (this.responses.length > 0) {
      return this.responses[this.responses.length - 1];
    }

    // No responses queued at all — return empty
    return {
      id: `mock_empty_${this.callIndex++}`,
      content: [{ contentType: 'text', text: '' }],
      role: 'assistant',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async generateStream(messages: LlmMessage[], _options?: LlmGenerationOptions): Promise<void> {
    this.calls.push(messages.map(m => ({ ...m, content: typeof m.content === 'string' ? m.content : [...m.content] })));

    // Pop response directly (don't call generate() to avoid double-incrementing callIndex)
    let result: LlmGenerationResult;
    if (this.callIndex < this.responses.length) {
      result = this.responses[this.callIndex++];
    } else if (this.responses.length > 0) {
      result = this.responses[this.responses.length - 1];
    } else {
      result = {
        id: `mock_empty_${this.callIndex++}`,
        content: [{ contentType: 'text', text: '' }],
        role: 'assistant',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    // Fire generation started callback
    if (this.onGenerationStarted) {
      await this.onGenerationStarted();
    }

    // Simulate streaming via chunk callback
    if (this.onChunk) {
      const textContent = result.content.find(c => c.contentType === 'text');
      if (textContent) {
        await this.onChunk({
          id: result.id,
          content: textContent.text,
          role: result.role,
          finishReason: result.finishReason,
          usage: result.usage,
        });
      }
    }
    // Fire completion callback
    if (this.onGenerationCompleted) {
      await this.onGenerationCompleted(result);
    }
  }

  setOnChunk(callback: LlmChunkCallback): void {
    this.onChunk = callback;
  }

  setOnGenerationStarted(callback: SimpleCallback): void {
    this.onGenerationStarted = callback;
  }

  setOnGenerationCompleted(callback: LlmCompleteCallback): void {
    this.onGenerationCompleted = callback;
  }

  setOnError(callback: ErrorCallback): void {
    this.onError = callback;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async cleanup(): Promise<void> {
    this.initialized = false;
  }

  async enumerateModels(): Promise<LlmModelInfo[]> {
    return [{ id: 'mock-model', name: 'Mock Model', contextWindow: 128000 }];
  }

  /** Whether moderation should flag input. */
  public moderationFlagged = false;
  public moderationCategories: string[] = [];

  async moderateUserInput(_input: string): Promise<{ flagged: boolean; categories: string[] }> {
    return { flagged: this.moderationFlagged, categories: this.moderationCategories };
  }

  /** Reset all state for a fresh test. */
  reset(): void {
    this.responses = [];
    this.callIndex = 0;
    this.calls = [];
    this.initialized = false;
    this.onChunk = null;
    this.onGenerationStarted = null;
    this.onGenerationCompleted = null;
    this.onError = null;
  }
}
