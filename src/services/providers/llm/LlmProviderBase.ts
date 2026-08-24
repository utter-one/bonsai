import type { ErrorCallback, SimpleCallback } from '../../../types/callbacks';
import { ILlmProvider, LlmChunkCallback, LlmCompleteCallback, LlmGenerationOptions, LlmGenerationResult, LlmMessage } from './ILlmProvider';
import { logger } from '../../../utils/logger';
import { log } from 'handlebars';
import { LlmModelInfo } from '../ProviderCatalogService';
import { MonitoringContext } from '../../monitoring/MonitoringContext';
import { getMetricsRegistry, getProviderCallRecorder } from '../../monitoring/ProviderCallRecorder';
import type { ProviderCallRecord } from '../../monitoring/ProviderCallRecorder';
import type { MetricsRegistry } from '../../monitoring/MetricsRegistry';
import { StreamStats } from '../../monitoring/StreamStats';

/**
 * Abstract base class for LLM provider implementations
 * Provides common functionality for callback management, lifecycle, and error handling.
 *
 * Instrumentation (P1-03): `generate`/`generateStream` are concrete template
 * wrappers that time the call and record exactly one provider_call_logs row
 * + generic metrics per call; subclasses implement `doGenerate`/`doGenerateStream`
 * and feed the base's notify* hooks (chunk timing, finish reason, usage).
 * Provider identity (providerId/apiType/model) is stamped by LlmProviderFactory.
 */
export abstract class LlmProviderBase<TConfig> implements ILlmProvider {
  protected config?: TConfig;
  protected initialized: boolean = false;
  protected onChunkCallback?: LlmChunkCallback;
  protected onGenerationCompletedCallback?: LlmCompleteCallback;
  protected onGenerationStartedCallback?: SimpleCallback;
  protected onErrorCallback?: ErrorCallback;

  /** Stamped by LlmProviderFactory (P1-03) — null when constructed outside the factory. */
  providerId?: string;
  providerApiType?: string;
  providerModel?: string;
  /** Stamped by FailoverLlmProvider (P3-03) for non-primary attempts — the chain's primary id. */
  fallbackOfProviderId?: string;

  /** Per-call streaming accumulator for the in-flight call (provider instances are per use-site). */
  private activeStats: StreamStats | null = null;

  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Initialize the provider with configuration
   * Subclasses should override this and call super.init() first
   */
  async init(): Promise<void> {
    logger.info('Initializing LLM provider...');
    this.initialized = true;
  }

  /**
   * Generate a non-streaming response.
   * Template wrapper — times the call and records one call-log row + metrics;
   * the actual API call lives in `doGenerate`.
   */
  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    const stats = this.beginCall('llm.generate');
    try {
      const result = await this.doGenerate(messages, options);
      this.applyResultToStats(stats, result);
      this.recordCall(stats, null);
      return result;
    } catch (error) {
      this.recordCall(stats, error, 'setup');
      throw error;
    }
  }

  /**
   * Generate a streaming response.
   * Template wrapper — times the call and records one call-log row + metrics
   * (streaming phase fields from the notify* hooks); the actual API call lives
   * in `doGenerateStream`. Errors are rethrown after `notifyError` (subclass
   * contract), so this wrapper's catch is the single recording point.
   */
  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    const stats = this.beginCall('llm.generate');
    try {
      await this.doGenerateStream(messages, options);
      this.recordCall(stats, null);
    } catch (error) {
      // errorPhase: mid_stream once any chunk was delivered (P3 failover boundary)
      this.recordCall(stats, error, stats.delivered ? 'mid_stream' : 'setup');
      throw error;
    }
  }

  /**
   * Generate a non-streaming response.
   * Must be implemented by subclasses (renamed from `generate` — P1-03 template method).
   */
  protected abstract doGenerate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult>;

  /**
   * Generate a streaming response.
   * Must be implemented by subclasses (renamed from `generateStream` — P1-03 template method).
   */
  protected abstract doGenerateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void>;

  /**
   * Set callback for streaming chunks
   */
  setOnChunk(callback: LlmChunkCallback): void {
    this.onChunkCallback = callback;
  }

  /**
   * Set callback for generation completion
   */
  setOnGenerationCompleted(callback: LlmCompleteCallback): void {
    this.onGenerationCompletedCallback = callback;
  }

  /**
   * Set callback for when provider is ready
   */
  setOnGenerationStarted(callback: SimpleCallback): void {
    this.onGenerationStartedCallback = callback;
  }

  /**
   * Set callback for fatal errors
   */
  setOnError(callback: ErrorCallback): void {
    this.onErrorCallback = callback;
  }

  /**
   * Get the current configuration
   */
  getConfig(): TConfig {
    if (!this.config) {
      throw new Error('Provider not initialized - config is undefined');
    }
    return this.config;
  }

  /**
   * Check if provider is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Notify that provider is ready
   */
  protected async notifyStarted(): Promise<void> {
    if (this.onGenerationStartedCallback) {
      try {
        await this.onGenerationStartedCallback();
      } catch (error) {
        logger.error(`Error in generation started callback: ${error}`);
      }
    }
  }

  /**
   * Notify about a streaming chunk
   */
  protected async notifyChunk(content: string, id: string, role?: 'assistant', finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null, usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }): Promise<void> {
    this.activeStats?.onUnit();
    if (usage?.promptTokens != null) this.activeStats.tokensPrompt = usage.promptTokens;
    if (usage?.completionTokens != null) this.activeStats.tokensCompletion = usage.completionTokens;
    if (this.onChunkCallback) {
      try {
        await this.onChunkCallback({ id, content, role, finishReason, usage });
      } catch (error) {
        logger.error(`Error in chunk callback: ${error}`);
      }
    }
  }

  /**
   * Notify about generation completion
   */
  protected async notifyComplete(result: LlmGenerationResult): Promise<void> {
    if (this.activeStats) {
      this.applyResultToStats(this.activeStats, result);
    }
    if (this.onGenerationCompletedCallback) {
      try {
        await this.onGenerationCompletedCallback(result);
      } catch (error) {
        logger.error(`Error in generation completed callback: ${error}`);
      }
    }
  }

  /**
   * Notify about a fatal error
   */
  protected async notifyError(error: Error): Promise<void> {
    logger.error(`LLM provider fatal error: ${error.message}`);
    if (this.onErrorCallback) {
      try {
        await this.onErrorCallback(error);
      } catch (callbackError) {
        logger.error(`Error in error callback: ${callbackError}`);
      }
    }
  }

  /**
   * Releases all resources held by the provider.
   * Subclasses can override this to perform provider-specific cleanup.
   */
  async cleanup(): Promise<void> {
    this.onChunkCallback = undefined;
    this.onGenerationCompletedCallback = undefined;
    this.onGenerationStartedCallback = undefined;
    this.onErrorCallback = undefined;
  }

  /**
   * Ensure provider is initialized before operations
   */
  protected ensureInitialized(): void {
    if (!this.initialized || !this.config) {
      throw new Error('Provider must be initialized before use');
    }
  }

  /**
   * Apply default options from config
   */
  protected applyDefaultOptions(options?: LlmGenerationOptions): LlmGenerationOptions {
    return {
      maxTokens: options?.maxTokens ?? 1024,
      metadata: options?.metadata,
      outputFormat: options?.outputFormat ?? 'text',
    };
  }

  /**
   * Validate messages before sending to provider
   */
  protected validateMessages(messages: LlmMessage[]): void {
    if (!messages || messages.length === 0) {
      throw new Error('Messages array cannot be empty');
    }

    if (messages[0].role !== 'system') {
      throw new Error('First message must have role "system"');
    }

    for (const message of messages) {
      if (!message.role) {
        throw new Error('Message role is required');
      }
      if (!message.content || (typeof message.content === 'string' && message.content.length === 0) || (Array.isArray(message.content) && message.content.length === 0)) {
        throw new Error('Message content cannot be empty');
      }
    }
  }

  /**
   * Extract text content from message (helper for simple text extraction)
   */
  protected extractTextContent(messages: LlmMessage[]): string {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return msg.content;
      }
      return msg.content.filter((c) => c.type === 'text').map((c) => (c as any).text).join(' ');
    }).join('\n');
  }

  /**
   * Enumerate available models from the provider, returning an array of model information.
   * Must be implemented by subclasses to return provider-specific model details.
   * The actual API call lives in `doEnumerateModels` (P1-03 template method).
   */
  async enumerateModels(): Promise<LlmModelInfo[]> {
    const startedAt = Date.now();
    try {
      const models = await this.doEnumerateModels();
      this.recordPlainCall('llm.models', startedAt, null);
      return models;
    } catch (error) {
      this.recordPlainCall('llm.models', startedAt, error);
      throw error;
    }
  }

  protected abstract doEnumerateModels(): Promise<LlmModelInfo[]>;

    /**
     * Moderate user input for content policy violations. Returns whether the input was flagged and any applicable categories.
     * By default, this method throws an error indicating that moderation is not supported. Subclasses can override this to provide actual moderation functionality if supported by the provider.
     * @param input User input to moderate
     * @returns Object containing flagged status and categories of violation
     */
    async moderateUserInput(input: string): Promise<{ flagged: boolean; categories: string[]; }> {
      const startedAt = Date.now();
      try {
        const result = await this.doModerateUserInput(input);
        this.recordPlainCall('llm.moderate', startedAt, null);
        return result;
      } catch (error) {
        // Includes the default "not supported" throw — recorded so unsupported-provider attempts are visible
        this.recordPlainCall('llm.moderate', startedAt, error);
        throw error;
      }
    }

    protected doModerateUserInput(input: string): Promise<{ flagged: boolean; categories: string[]; }> {
      return Promise.reject(new Error('Moderation is not supported by this provider'));
    }

  // --- instrumentation helpers (P1-03) ---

  /** Copies finish reason + usage from a completed result into per-call stats. */
  private applyResultToStats(stats: StreamStats, result: LlmGenerationResult): void {
    if (result.finishReason) stats.finishReason = result.finishReason;
    if (result.usage?.promptTokens != null) stats.tokensPrompt = result.usage.promptTokens;
    if (result.usage?.completionTokens != null) stats.tokensCompletion = result.usage.completionTokens;
  }

  /** Test seam — redirects call-log recording (defaults to the container accessor). */
  protected resolveCallRecorder(): { record(entry: ProviderCallRecord): void } {
    return getProviderCallRecorder();
  }

  /** Test seam — redirects metric publication (defaults to the container accessor). */
  protected resolveMetricsRegistry(): MetricsRegistry | null {
    return getMetricsRegistry();
  }

  /** Resolves the operation for a call: an explicit `llm.*` from MonitoringContext wins, else the default. */
  private resolveOperation(defaultOperation: string): string {
    const ctx = MonitoringContext.current();
    return ctx?.operation?.startsWith('llm.') ? ctx.operation : defaultOperation;
  }

  /** Starts the per-call stats (operation from MonitoringContext if it is an `llm.*` override). */
  private beginCall(defaultOperation: string): StreamStats {
    this.activeStats = new StreamStats(this.resolveOperation(defaultOperation));
    return this.activeStats;
  }

  /** Records the finished call exactly once and clears per-call state. */
  private recordCall(stats: StreamStats, error: unknown, errorPhase?: 'setup' | 'mid_stream'): void {
    this.activeStats = null;
    if (!this.providerId || !this.providerApiType) return; // constructed outside the factory — nothing to attribute to
    const metrics = stats.toCallMetrics();
    if (errorPhase) metrics.errorPhase = errorPhase;
    const recorder = this.resolveCallRecorder();
    recorder.record({
      providerId: this.providerId,
      providerType: 'llm',
      apiType: this.providerApiType,
      operation: stats.operation,
      model: this.providerModel ?? null,
      durationMs: stats.durationMs(),
      ok: error === null,
      error: error ?? undefined,
      fallbackProviderId: this.fallbackOfProviderId ?? null,
      metrics,
    });
    if (error === null) {
      const registry = this.resolveMetricsRegistry();
      const labels: Record<string, unknown> = { provider_id: this.providerId, provider_type: 'llm', operation: stats.operation, ok: true, error_code: 'none' };
      if (stats.chunksCount > 0) {
        if (stats.ttftMs !== null) registry?.observe('llm_ttft_ms', labels, stats.ttftMs);
        registry?.observe('llm_stream_duration_ms', labels, stats.durationMs());
      }
    }
  }

  /** Records a non-streaming call without per-call stats (models/moderate). */
  private recordPlainCall(operation: string, startedAt: number, error: unknown): void {
    if (!this.providerId || !this.providerApiType) return;
    this.resolveCallRecorder().record({
      providerId: this.providerId,
      providerType: 'llm',
      apiType: this.providerApiType,
      operation,
      model: this.providerModel ?? null,
      durationMs: Date.now() - startedAt,
      ok: error === null,
      error: error ?? undefined,
      fallbackProviderId: this.fallbackOfProviderId ?? null,
    });
  }
}
