import { inject } from 'tsyringe';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { Llama, LlamaModel, ChatHistoryItem } from 'node-llama-cpp';
import { LlamaChatSession, LlamaContext } from 'node-llama-cpp';
import { LlmProviderBase } from './LlmProviderBase';
import { LlamaCppInstanceManager } from './LlamaCppInstanceManager';
import { logger } from '../../../utils/logger';
import type { LlmMessage, LlmGenerationOptions, LlmGenerationResult } from './ILlmProvider';
import type { LlmModelInfo } from '../ProviderCatalogService';
import path from 'node:path';

extendZodWithOpenApi(z);

export const nodeLlamaCppLlmProviderConfigSchema = z.strictObject({
  modelPath: z.string().min(1).describe('Path to GGUF model file'),
  contextSize: z.number().int().positive().optional().describe('Context window size in tokens'),
  gpuLayers: z.number().int().min(0).optional().describe('Number of layers to offload to GPU (0 = CPU only)'),
  threads: z.number().int().positive().optional().describe('Number of CPU threads for inference'),
  batchSize: z.number().int().positive().optional().describe('Batch size for token processing'),
  flashAttention: z.boolean().optional().describe('Enable flash attention optimization'),
});

export type NodeLlamaCppLlmProviderConfig = z.infer<typeof nodeLlamaCppLlmProviderConfigSchema>;

export const nodeLlamaCppLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model identifier (used for display)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
}).openapi('NodeLlamaCppLlmSettings');

export type NodeLlamaCppLlmSettings = z.infer<typeof nodeLlamaCppLlmSettingsSchema>;

export class NodeLlamaCppLlmProvider extends LlmProviderBase<NodeLlamaCppLlmProviderConfig> {
  protected settings: NodeLlamaCppLlmSettings;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;

  constructor(
    config: NodeLlamaCppLlmProviderConfig,
    settings: NodeLlamaCppLlmSettings,
    @inject(LlamaCppInstanceManager) private readonly instanceManager: LlamaCppInstanceManager,
  ) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> {
    await super.init();
    const launchOptions = {
      gpuLayers: this.config?.gpuLayers,
      flashAttention: this.config?.flashAttention,
    };
    const { model, llama } = await this.instanceManager.acquireModel(this.config!.modelPath, launchOptions);
    this.model = model;
    this.llama = llama;
    logger.info({ modelPath: this.config!.modelPath, filename: this.model.filename }, 'NodeLlamaCppLlmProvider initialized');
  }

  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.ensureInitialized();
    const applied = this.applyOptions(options);
    const history = this.convertToChatHistory(messages);
    const lastUserMessage = this.extractLastUserMessage(messages);

    const { context, session } = await this.createSession();
    try {
      session.setChatHistory(history);
      const grammar = applied.outputFormat === 'json' ? await this.llama!.getGrammarFor('json') : undefined;
      const response = await session.prompt(lastUserMessage, {
        onTextChunk: (chunk: string) => {
          void this.notifyChunk(chunk, this.generateId(), 'assistant');
        },
        maxTokens: applied.maxTokens,
        temperature: applied.temperature,
        topP: applied.topP,
        grammar,
      });

      const result: LlmGenerationResult = {
        id: this.generateId(),
        content: [{ contentType: 'text', text: response }],
        role: 'assistant',
        finishReason: 'stop',
      };
      await this.notifyComplete(result);
      return result;
    } finally {
      session.dispose();
      await context.dispose();
    }
  }

  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    this.ensureInitialized();
    const applied = this.applyOptions(options);
    const history = this.convertToChatHistory(messages);
    const lastUserMessage = this.extractLastUserMessage(messages);

    const { context, session } = await this.createSession();
    try {
      session.setChatHistory(history);
      await this.notifyStarted();
      const grammar = applied.outputFormat === 'json' ? await this.llama!.getGrammarFor('json') : undefined;
      let accumulated = '';
      const id = this.generateId();

      const response = await session.prompt(lastUserMessage, {
        onTextChunk: (chunk: string) => {
          accumulated += chunk;
          void this.notifyChunk(chunk, id, 'assistant');
        },
        maxTokens: applied.maxTokens,
        temperature: applied.temperature,
        topP: applied.topP,
        grammar,
      });

      const result: LlmGenerationResult = {
        id,
        content: [{ contentType: 'text', text: accumulated }],
        role: 'assistant',
        finishReason: 'stop',
      };
      await this.notifyChunk('', id, 'assistant', 'stop');
      await this.notifyComplete(result);
    } finally {
      session.dispose();
      await context.dispose();
    }
  }

  async cleanup(): Promise<void> {
    await super.cleanup();
    if (this.config?.modelPath) {
      this.instanceManager.releaseModel(this.config.modelPath);
    }
    this.model = null;
    this.llama = null;
  }

  async enumerateModels(): Promise<LlmModelInfo[]> {
    if (!this.model) {
      return [];
    }
    const name = this.model.filename ?? this.settings.model ?? path.basename(this.config?.modelPath ?? 'unknown');
    return [{
      id: this.settings.model,
      displayName: name,
      supportsToolCalling: false,
      supportsJsonOutput: true,
      supportsStreaming: true,
    }];
  }

  async moderateUserInput(_input: string): Promise<{ flagged: boolean; categories: string[] }> {
    return { flagged: false, categories: [] };
  }

  private convertToChatHistory(messages: LlmMessage[]): ChatHistoryItem[] {
    const history: ChatHistoryItem[] = [];
    for (const msg of messages) {
      const text = typeof msg.content === 'string' ? msg.content : this.extractTextFromContent(msg.content);
      if (!text) continue;
      if (msg.role === 'system') {
        history.push({ type: 'system' as const, text });
      } else if (msg.role === 'user') {
        history.push({ type: 'user' as const, text });
      } else if (msg.role === 'assistant') {
        history.push({ type: 'model' as const, response: [text] });
      }
    }
    return history;
  }

  private extractLastUserMessage(messages: LlmMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const content = messages[i].content;
        if (typeof content === 'string') return content;
        return this.extractTextFromContent(content as Array<{ type: string; text?: string }>);
      }
    }
    return '';
  }

  private extractTextFromContent(content: Array<{ type: string; text?: string }>): string {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join(' ');
  }

  private applyOptions(options?: LlmGenerationOptions): {
    maxTokens: number;
    temperature: number | undefined;
    topP: number | undefined;
    outputFormat: string;
  } {
    return {
      maxTokens: options?.maxTokens ?? this.settings.defaultMaxTokens ?? 1024,
      temperature: options?.metadata?.temperature as number | undefined ?? this.settings.defaultTemperature,
      topP: options?.metadata?.topP as number | undefined ?? this.settings.defaultTopP,
      outputFormat: options?.outputFormat ?? 'text',
    };
  }

  private async createSession(): Promise<{ context: LlamaContext; session: LlamaChatSession }> {
    if (!this.model) {
      throw new Error('Model not loaded. Call init() before generating.');
    }
    const context = await this.model.createContext();
    const sequence = context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence });
    return { context, session };
  }

  private generateId(): string {
    return `node-llama-cpp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
