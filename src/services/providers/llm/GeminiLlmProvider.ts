import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, SafetySetting } from '@google/genai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { LlmProviderBase } from './LlmProviderBase';
import { ImageContent, LlmContent, LlmGenerationOptions, LlmGenerationResult, LlmMessage, TextContent } from './ILlmProvider';
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
  model: z.string().min(1).describe('Model name (e.g., gemini-2.5-flash, gemini-2.5-pro, gemini-3-flash, gemini-3-pro)'),
  defaultMaxTokens: z.number().int().positive().optional().describe('Default maximum tokens for generation (includes thinking tokens for thinking models)'),
  defaultTemperature: z.number().min(0).max(2).optional().describe('Default temperature for generation (0-2)'),
  defaultTopP: z.number().min(0).max(1).optional().describe('Default top-p for generation (0-1)'),
  defaultTopK: z.number().int().positive().optional().describe('Default top-k for generation'),
  
  thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high']).optional().describe('Thinking level for Gemini 3 models. Controls reasoning depth: minimal=chat/high-throughput, low=simple tasks, medium=balanced, high=max reasoning depth.'),
  thinkingBudget: z.number().int().optional().describe('Thinking budget (tokens) for Gemini 2.5 models. Set to -1 for dynamic thinking (default), 0 to disable, or specific token count (128-32768). Use thinkingLevel for Gemini 3.'),
  includeThoughts: z.boolean().optional().describe('Include thought summaries in response. Provides insight into model\'s reasoning process for debugging. Available for all thinking models.'),
  
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
  protected async generateResponse(messages: LlmMessage[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    const { systemInstruction, contents } = this.convertToGeminiMessages(messages);

    logger.info(`Generating Gemini completion with model: ${this.settings.model}`);

    const outputFormat = options?.outputFormat || 'text';

    if (outputFormat === 'text' || outputFormat === 'json') {
      return this.generateTextBasedResponse(systemInstruction, contents, options);
    } else if (outputFormat === 'image') {
      return this.generateImageBasedResponse(systemInstruction, contents, options);
    } else if (outputFormat === 'audio') {
      return this.generateAudioBasedResponse(systemInstruction, contents, options);
    }

    throw new Error(`Unsupported output format: ${outputFormat}`);
  }

  /**
   * Generate an image-based response using Gemini's native Nano Banana image generation.
   * Uses gemini-2.5-flash-image or gemini-3-pro-image-preview models.
   * The image is returned as base64-encoded data in inline_data parts.
   */
  private async generateImageBasedResponse(systemInstruction: string | undefined, contents: Content[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    // Use a Nano Banana model for image generation
    const result = await this.client.models.generateContent({
      model: this.settings.model,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
        temperature: this.settings.defaultTemperature,
        topP: this.settings.defaultTopP,
        topK: this.settings.defaultTopK,
        responseModalities: ['IMAGE', 'TEXT'],
      },
    } as any);

    // Extract base64-encoded image and text from response parts
    const contentArray: LlmContent[] = [];
    for (const candidate of result.candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if ((part as any).inlineData?.mimeType?.startsWith('image/') && (part as any).inlineData?.data) {
          contentArray.push({
            contentType: 'image',
            data: (part as any).inlineData.data,
            mimeType: (part as any).inlineData.mimeType,
          });
        } else if ((part as any).text) {
          contentArray.push({
            contentType: 'text',
            text: (part as any).text,
          });
        }
      }
    }

    if (contentArray.length === 0) {
      throw new Error('No content returned from Gemini image generation');
    }

    // Return multi-modal content array
    const llmResult: LlmGenerationResult = {
      id: `gemini-img-${Date.now()}`,
      content: contentArray,
      role: 'assistant',
      finishReason: this.mapFinishReason(result.candidates?.[0]?.finishReason),
      usage: result.usageMetadata ? {
        promptTokens: result.usageMetadata.promptTokenCount || 0,
        completionTokens: result.usageMetadata.candidatesTokenCount || 0,
        totalTokens: result.usageMetadata.totalTokenCount || 0,
      } : undefined,
      metadata: {
        model: this.settings.model,
        outputFormat: 'image',
        finishReason: result.candidates?.[0]?.finishReason,
      },
    };

    return llmResult;
  }

  /**
   * Generate an audio-based response using Gemini's TTS (text-to-speech) capabilities.
   * Uses gemini-2.5-flash-preview-tts model.
   * The audio is returned as base64-encoded PCM data (16-bit, 24kHz, stereo) in inline_data parts.
   */
  private async generateAudioBasedResponse(systemInstruction: string | undefined, contents: Content[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    // Use a TTS model for audio generation
    const ttsModel = 'gemini-2.5-flash-preview-tts';

    const result = await this.client.models.generateContent({
      model: ttsModel,
      contents,
      config: {
        systemInstruction,
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Kore', // Default voice, can be made configurable
            },
          },
        },
      },
    } as any);

    // Extract base64-encoded audio from inline_data parts
    let audioData = '';
    let mimeType = 'audio/pcm';
    for (const part of result.candidates?.[0]?.content?.parts || []) {
      if ((part as any).inlineData?.mimeType?.startsWith('audio/') && (part as any).inlineData?.data) {
        audioData = (part as any).inlineData.data;
        mimeType = (part as any).inlineData.mimeType;
        break;
      }
    }

    if (!audioData) {
      throw new Error('No audio data returned from Gemini TTS');
    }

    // Return the base64-encoded audio data as LlmAudioContent
    const contentArray: LlmContent[] = [
      {
        contentType: 'audio',
        data: audioData,
        format: 'pcm',
        mimeType,
        metadata: {
          sampleRate: 24000,
          channels: 2,
          bitDepth: 16,
        },
      },
    ];

    const llmResult: LlmGenerationResult = {
      id: `gemini-audio-${Date.now()}`,
      content: contentArray,
      role: 'assistant',
      finishReason: this.mapFinishReason(result.candidates?.[0]?.finishReason),
      usage: result.usageMetadata ? {
        promptTokens: result.usageMetadata.promptTokenCount || 0,
        completionTokens: result.usageMetadata.candidatesTokenCount || 0,
        totalTokens: result.usageMetadata.totalTokenCount || 0,
      } : undefined,
      metadata: {
        model: ttsModel,
        outputFormat: 'audio',
        audioFormat: 'pcm16-24khz-stereo',
        finishReason: result.candidates?.[0]?.finishReason,
      },
    };

    return llmResult;
  }

  /**
   * Generate a text-based response and handle JSON output verification for JSON output format.
   */
  private async generateTextBasedResponse(systemInstruction: string | undefined, contents: Content[], options?: LlmGenerationOptions): Promise<LlmGenerationResult> {
    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    const result = await this.client.models.generateContent({
      model: this.settings.model,
      contents,
      config: {
        systemInstruction,
        maxOutputTokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
        temperature: this.settings.defaultTemperature,
        topP: this.settings.defaultTopP,
        topK: this.settings.defaultTopK,
        thinkingConfig: this.settings.thinkingLevel || this.settings.thinkingBudget !== undefined || this.settings.includeThoughts ? {
          thinkingLevel: this.settings.thinkingLevel,
          thinkingBudget: this.settings.thinkingBudget,
          includeThoughts: this.settings.includeThoughts,
        } : undefined,
        //stopSequences: this.settings.stopSequences,
        safetySettings: this.settings.safetySettings,
      },
    } as any);

    const text = result.text || '';

    // Check if output format is JSON and attempt to parse it, throwing an error if parsing fails
    if (options?.outputFormat === 'json') {
      try {
        JSON.parse(text);
      } catch (error) {
        logger.error(`Failed to parse JSON output: ${error instanceof Error ? error.message : String(error)}`);
        throw new Error('Failed to parse JSON output from model response');
      }
    }
    
    const contentArray: LlmContent[] = [
      {
        contentType: 'text',
        text,
      },
    ];
    
    const llmResult: LlmGenerationResult = {
      id: `gemini-${Date.now()}`,
      content: contentArray,
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

    return llmResult;
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

    if (options?.outputFormat && options.outputFormat !== 'text') {
      throw new Error(`Output format ${options.outputFormat} not supported for streaming generation`);
    }

    const { systemInstruction, contents } = this.convertToGeminiMessages(messages);

    try {
      logger.info(`Starting Gemini streaming completion with model: ${this.settings.model}`);

      const stream = await this.client.models.generateContentStream({
        model: this.settings.model,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: options?.maxTokens ?? this.settings.defaultMaxTokens,
          temperature: this.settings.defaultTemperature,
          topP: this.settings.defaultTopP,
          topK: this.settings.defaultTopK,
          thinkingConfig: this.settings.thinkingLevel || this.settings.thinkingBudget !== undefined || this.settings.includeThoughts ? {
            thinkingLevel: this.settings.thinkingLevel,
            thinkingBudget: this.settings.thinkingBudget,
            includeThoughts: this.settings.includeThoughts,
          } : undefined,
          //stopSequences: this.settings.stopSequences,
          safetySettings: this.settings.safetySettings,
        },
      } as any);

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

      // Notify completion with text content as LlmTextContent
      const contentArray: LlmContent[] = [
        {
          contentType: 'text',
          text: fullContent,
        },
      ];

      const llmResult: LlmGenerationResult = {
        id: generationId || `gemini-${Date.now()}`,
        content: contentArray,
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
