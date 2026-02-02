import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, SafetySetting } from '@google/genai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { LlmProviderBase } from './LlmProviderBase';
import { ImageContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage, TextContent } from './ILlmProvider';
import { logger } from '../../../utils/logger';

extendZodWithOpenApi(z);

/**
 * Schema for Google Gemini-specific configuration
 */
export const geminiLlmProviderConfigSchema = z.object({
  apiKey: z.string().describe('Google API key'),
});

export type GeminiLlmProviderConfig = z.infer<typeof geminiLlmProviderConfigSchema>;

/**
 * Schema for Google Gemini LLM settings
 * Used with Gemini models and Vertex AI
 */
export const geminiLlmSettingsSchema = z.object({
  model: z.string().min(1).describe('Model name (e.g., gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  defaultTopK: z.number().int().positive().optional().describe('Default top-k for generation'),
  timeout: z.number().int().positive().optional().describe('Request timeout in milliseconds'),
  safetySettings: z.array(z.unknown()).optional().describe('Safety settings configuration'),
}).openapi('GeminiLlmSettings');

export type GeminiLlmSettings = z.infer<typeof geminiLlmSettingsSchema>;

/**
 * Google Gemini LLM provider implementation
 * Supports both streaming and non-streaming generation with multi-modal messages
 * Uses the new @google/genai SDK for Gemini 2.5+ models
 */
export class GeminiLlmProvider extends LlmProviderBase<GeminiLlmProviderConfig> {
  private client?: GoogleGenAI;
  private settings: GeminiLlmSettings;

  constructor(config: GeminiLlmProviderConfig, settings: GeminiLlmSettings) {
    super(config);
    this.settings = settings;
  }

  /**
   * Initialize the Gemini provider
   */
  async init(): Promise<void> {
    await super.init();

    this.client = new GoogleGenAI({ apiKey: this.config.apiKey });

    logger.info(`Google Gemini LLM provider initialized with model: ${this.settings.model}`);
  }

  /**
   * Generate a non-streaming response
   */
  async generate(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    const mergedOptions = this.applyDefaultOptions(options);
    const { systemInstruction, contents } = this.convertToGeminiMessages(messages);

    try {
      logger.info(`Generating Gemini completion with model: ${this.settings.model}`);

      const result = await this.client.models.generateContent({
        model: this.settings.model,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: mergedOptions.maxTokens,
          temperature: mergedOptions.temperature,
          topP: mergedOptions.topP,
          topK: this.settings.defaultTopK,
          stopSequences: mergedOptions.stopSequences,
          safetySettings: this.settings.safetySettings,
        },
      });

      const text = result.text || '';
      
      const llmResult: LlmGenerationResult = {
        id: `gemini-${Date.now()}`,
        content: text,
        role: 'assistant',
        finishReason: this.mapFinishReason(result.candidates?.[0]?.finishReason),
        usage: result.usageMetadata ? {
          promptTokens: result.usageMetadata.promptTokenCount || 0,
          completionTokens: result.usageMetadata.candidatesTokenCount || 0,
          totalTokens: result.usageMetadata.totalTokenCount || 0,
        } : undefined,
        metadata: {
          model: this.settings.model,
          finishReason: result.candidates?.[0]?.finishReason,
          safetyRatings: result.candidates?.[0]?.safetyRatings,
        },
      };

      await this.notifyComplete(llmResult);
      return llmResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Gemini generation error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Generate a streaming response
   */
  async generateStream(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<void> {
    this.ensureInitialized();
    this.validateMessages(messages);

    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    const mergedOptions = this.applyDefaultOptions(options);
    const { systemInstruction, contents } = this.convertToGeminiMessages(messages);

    try {
      logger.info(`Starting Gemini streaming completion with model: ${this.settings.model}`);

      const stream = await this.client.models.generateContentStream({
        model: this.settings.model,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: mergedOptions.maxTokens,
          temperature: mergedOptions.temperature,
          topP: mergedOptions.topP,
          topK: this.settings.defaultTopK,
          stopSequences: mergedOptions.stopSequences,
          safetySettings: this.settings.safetySettings,
        },
      });

      let fullContent = '';
      let finalFinishReason: string | undefined;
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let generationId: string | undefined;

      for await (const chunk of stream) {
        const chunkText = chunk.text || '';
        if (chunkText) {
          fullContent += chunkText;
          generationId = generationId || `gemini-${Date.now()}`;
          await this.notifyChunk(chunkText, generationId, 'assistant', null);
        }

        // Track finish reason and usage
        if (chunk.candidates?.[0]?.finishReason) {
          finalFinishReason = chunk.candidates[0].finishReason;
        }

        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount || promptTokens;
          completionTokens = chunk.usageMetadata.candidatesTokenCount || completionTokens;
          totalTokens = chunk.usageMetadata.totalTokenCount || totalTokens;
        }
      }

      // Notify completion
      const llmResult: LlmGenerationResult = {
        id: generationId || `gemini-${Date.now()}`,
        content: fullContent,
        role: 'assistant',
        finishReason: this.mapFinishReason(finalFinishReason),
        usage: {
          promptTokens,
          completionTokens,
          totalTokens,
        },
        metadata: {
          model: this.settings.model,
          finishReason: finalFinishReason,
        },
      };

      await this.notifyComplete(llmResult);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Gemini streaming error: ${errorMessage}`);
      await this.notifyError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Convert our message format to Gemini's format
   * Gemini uses "user" and "model" roles, and system instructions are separate
   */
  private convertToGeminiMessages(messages: LlmMessage[]): { systemInstruction?: string; contents: Content[] } {
    let systemInstruction: string | undefined;
    const contents: Content[] = [];

    for (const msg of messages) {
      // Extract system message separately
      if (msg.role === 'system') {
        const systemContent = typeof msg.content === 'string' ? msg.content : this.extractTextContent([msg]);
        systemInstruction = systemInstruction ? `${systemInstruction}\n\n${systemContent}` : systemContent;
        continue;
      }

      // Convert role (Gemini uses "user" and "model" instead of "assistant")
      const role = msg.role === 'assistant' ? 'model' : 'user';

      // Convert content
      if (typeof msg.content === 'string') {
        contents.push({
          role,
          parts: [{ text: msg.content }],
        });
      } else {
        // Multi-modal content
        const parts: Part[] = [];

        for (const content of msg.content) {
          if (content.type === 'text') {
            parts.push({
              text: (content as TextContent).text,
            });
          } else if (content.type === 'image') {
            const imageContent = content as ImageContent;
            if (imageContent.source.type === 'url' && imageContent.source.url) {
              // Gemini supports image URLs via fileData
              // Note: This requires the URL to be accessible
              parts.push({
                fileData: {
                  mimeType: imageContent.source.mimeType || 'image/jpeg',
                  fileUri: imageContent.source.url,
                },
              });
            } else if (imageContent.source.type === 'base64' && imageContent.source.data) {
              parts.push({
                inlineData: {
                  mimeType: imageContent.source.mimeType || 'image/jpeg',
                  data: imageContent.source.data,
                },
              });
            }
          } else if (content.type === 'json') {
            // Convert JSON to text
            parts.push({
              text: JSON.stringify((content as any).data),
            });
          }
        }

        contents.push({
          role,
          parts,
        });
      }
    }

    return { systemInstruction, contents };
  }

  /**
   * Map Gemini's finish reason to our format
   */
  private mapFinishReason(reason?: string): 'stop' | 'length' | 'tool_calls' | 'content_filter' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
