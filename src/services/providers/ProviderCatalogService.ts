import { singleton } from 'tsyringe';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Service for providing information of what features are supported by different providers.
 * 
 * For ASR we have:
 * - model
 * - language
 * - custom vocabulary support
 * 
 * For TTS we have:
 * - model
 * - voice
 * - language
 * - full streaming support
 * 
 * For LLM we have:
 * - model
 * - tool-calling support
 * - JSON output support
 */

/**
 * Schema for information about a specific model supported by a provider
 */
export const modelInfoSchema = z.object({
  id: z.string().describe('Model identifier'),
  displayName: z.string().describe('Human-readable display name'),
  description: z.string().optional().describe('Description of the model\'s capabilities and use cases'),
  recommended: z.boolean().optional().describe('Whether this is a recommended or default model'),
});

export type ModelInfo = z.infer<typeof modelInfoSchema>;

/**
 * Schema for information about a voice supported by a TTS provider
 */
export const voiceInfoSchema = z.object({
  id: z.string().describe('Voice identifier'),
  displayName: z.string().describe('Human-readable name'),
  description: z.string().optional().describe('Description of voice characteristics'),
  gender: z.enum(['male', 'female', 'neutral']).optional().describe('Gender of the voice (if applicable)'),
  languages: z.array(z.string()).optional().describe('Languages supported by this voice'),
});

export type VoiceInfo = z.infer<typeof voiceInfoSchema>;

/**
 * Schema for language support information
 */
export const languageInfoSchema = z.object({
  code: z.string().describe('ISO language code (e.g., \'en-US\', \'es-ES\')'),
  displayName: z.string().describe('Human-readable language name'),
});

export type LanguageInfo = z.infer<typeof languageInfoSchema>;

/**
 * Schema for ASR provider capabilities
 */
export const asrProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  languages: z.array(languageInfoSchema).describe('Languages supported by this provider'),
  supportedAudioFormats: z.array(z.string()).describe('Audio input formats supported by this provider'),
  supportsCustomVocabulary: z.boolean().describe('Whether custom vocabulary/phrases are supported'),
  supportsStreaming: z.boolean().describe('Whether streaming transcription is supported'),
  description: z.string().optional().describe('Additional information'),
});

export type AsrProviderInfo = z.infer<typeof asrProviderInfoSchema>;

/**
 * Schema for TTS provider capabilities
 */
export const ttsProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  models: z.array(modelInfoSchema).describe('Models available for this provider'),
  voices: z.array(voiceInfoSchema).describe('Voices available (can be provider-specific or model-specific)'),
  languages: z.array(languageInfoSchema).describe('Languages supported'),
  supportedAudioFormats: z.array(z.string()).describe('Audio output formats supported by this provider'),
  supportsFullStreaming: z.boolean().describe('Whether full streaming (chunk-by-chunk) is supported'),
  supportsVoiceSettings: z.boolean().describe('Whether voice customization settings are supported'),
  description: z.string().optional().describe('Additional information'),
});

export type TtsProviderInfo = z.infer<typeof ttsProviderInfoSchema>;

/**
 * Schema for LLM provider capabilities
 */
export const llmProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  models: z.array(modelInfoSchema).describe('Models available for this provider'),
  supportsToolCalling: z.boolean().describe('Whether tool calling (function calling) is supported'),
  supportsJsonOutput: z.boolean().describe('Whether structured JSON output is supported'),
  supportsStreaming: z.boolean().describe('Whether streaming responses are supported'),
  supportsVision: z.boolean().describe('Whether vision/image input is supported'),
  supportsReasoning: z.boolean().optional().describe('Whether provider supports reasoning/thinking modes for deeper analysis'),
  reasoningModels: z.array(z.string()).optional().describe('List of model IDs that support reasoning/thinking capabilities'),
  contextWindows: z.record(z.string(), z.number()).optional().describe('Context window size (in tokens) for each model'),
  description: z.string().optional().describe('Additional information'),
});

export type LlmProviderInfo = z.infer<typeof llmProviderInfoSchema>;

/**
 * Schema for complete provider catalog
 */
export const providerCatalogSchema = z.object({
  asr: z.array(asrProviderInfoSchema).describe('ASR providers'),
  tts: z.array(ttsProviderInfoSchema).describe('TTS providers'),
  llm: z.array(llmProviderInfoSchema).describe('LLM providers'),
});

export type ProviderCatalog = z.infer<typeof providerCatalogSchema>;

@singleton()
export class ProviderCatalogService {
  /**
   * Gets the complete provider catalog with all supported providers and their capabilities
   */
  getCatalog(): ProviderCatalog {
    return {
      asr: this.getAsrProviders(),
      tts: this.getTtsProviders(),
      llm: this.getLlmProviders(),
    };
  }

  /**
   * Gets information about a specific ASR provider by API type
   */
  getAsrProvider(apiType: string): AsrProviderInfo | undefined {
    return this.getAsrProviders().find((p) => p.apiType === apiType);
  }

  /**
   * Gets information about a specific TTS provider by API type
   */
  getTtsProvider(apiType: string): TtsProviderInfo | undefined {
    return this.getTtsProviders().find((p) => p.apiType === apiType);
  }

  /**
   * Gets information about a specific LLM provider by API type
   */
  getLlmProvider(apiType: string): LlmProviderInfo | undefined {
    return this.getLlmProviders().find((p) => p.apiType === apiType);
  }

  /**
   * Gets all ASR provider information
   */
  private getAsrProviders(): AsrProviderInfo[] {
    return [
      {
        apiType: 'azure',
        displayName: 'Azure Speech Services',
        description: 'Microsoft Azure Cognitive Services Speech-to-Text API with support for multiple languages and custom vocabulary',
        languages: [
          { code: 'en-US', displayName: 'English (United States)' },
          { code: 'en-GB', displayName: 'English (United Kingdom)' },
          { code: 'es-ES', displayName: 'Spanish (Spain)' },
          { code: 'es-MX', displayName: 'Spanish (Mexico)' },
          { code: 'fr-FR', displayName: 'French (France)' },
          { code: 'de-DE', displayName: 'German (Germany)' },
          { code: 'it-IT', displayName: 'Italian (Italy)' },
          { code: 'pt-BR', displayName: 'Portuguese (Brazil)' },
          { code: 'pt-PT', displayName: 'Portuguese (Portugal)' },
          { code: 'ja-JP', displayName: 'Japanese (Japan)' },
          { code: 'zh-CN', displayName: 'Chinese (Simplified, China)' },
          { code: 'zh-TW', displayName: 'Chinese (Traditional, Taiwan)' },
          { code: 'ko-KR', displayName: 'Korean (South Korea)' },
          { code: 'ar-SA', displayName: 'Arabic (Saudi Arabia)' },
          { code: 'hi-IN', displayName: 'Hindi (India)' },
          { code: 'ru-RU', displayName: 'Russian (Russia)' },
          { code: 'nl-NL', displayName: 'Dutch (Netherlands)' },
          { code: 'pl-PL', displayName: 'Polish (Poland)' },
          { code: 'sv-SE', displayName: 'Swedish (Sweden)' },
          { code: 'tr-TR', displayName: 'Turkish (Turkey)' },
        ],
        supportedAudioFormats: ['pcm_16000'],
        supportsCustomVocabulary: true,
        supportsStreaming: true,
      },
    ];
  }

  /**
   * Gets all TTS provider information
   */
  private getTtsProviders(): TtsProviderInfo[] {
    return [
      {
        apiType: 'elevenlabs',
        displayName: 'ElevenLabs',
        description: 'ElevenLabs text-to-speech API with high-quality voices and full streaming support',
        models: [
          {
            id: 'eleven_flash_v2_5',
            displayName: 'Eleven Flash v2.5',
            description: 'Latest flash model with improved quality and lower latency',
            recommended: true,
          },
          {
            id: 'eleven_multilingual_v2',
            displayName: 'Eleven Multilingual v2',
            description: 'Multilingual model supporting 29 languages',
          },
          {
            id: 'eleven_turbo_v2_5',
            displayName: 'Eleven Turbo v2.5',
            description: 'Ultra-low latency model optimized for real-time applications',
          },
          {
            id: 'eleven_turbo_v2',
            displayName: 'Eleven Turbo v2',
            description: 'Previous generation turbo model',
          },
          {
            id: 'eleven_monolingual_v1',
            displayName: 'Eleven Monolingual v1',
            description: 'Original English-only model with high quality',
          },
        ],
        voices: [
          {
            id: 'EXAVITQu4vr4xnSDxMaL',
            displayName: 'Sarah',
            description: 'Professional female voice',
            gender: 'female',
            languages: ['en'],
          },
          {
            id: 'pNInz6obpgDQGcFmaJgB',
            displayName: 'Adam',
            description: 'Clear male voice',
            gender: 'male',
            languages: ['en'],
          },
          {
            id: 'VR6AewLTigWG4xSOukaG',
            displayName: 'Arnold',
            description: 'Deep male voice',
            gender: 'male',
            languages: ['en'],
          },
        ],
        languages: [
          { code: 'en', displayName: 'English' },
          { code: 'es', displayName: 'Spanish' },
          { code: 'fr', displayName: 'French' },
          { code: 'de', displayName: 'German' },
          { code: 'it', displayName: 'Italian' },
          { code: 'pt', displayName: 'Portuguese' },
          { code: 'pl', displayName: 'Polish' },
          { code: 'nl', displayName: 'Dutch' },
          { code: 'ja', displayName: 'Japanese' },
          { code: 'zh', displayName: 'Chinese' },
          { code: 'ko', displayName: 'Korean' },
          { code: 'ar', displayName: 'Arabic' },
          { code: 'hi', displayName: 'Hindi' },
          { code: 'ru', displayName: 'Russian' },
        ],
        supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
        supportsFullStreaming: true,
        supportsVoiceSettings: true,
      },
    ];
  }

  /**
   * Gets all LLM provider information
   */
  private getLlmProviders(): LlmProviderInfo[] {
    return [
      {
        apiType: 'openai',
        displayName: 'OpenAI (New API)',
        description: 'OpenAI language models using the new Responses API with GPT-5 series',
        models: [
          {
            id: 'gpt-5.2',
            displayName: 'GPT-5.2',
            description: 'Latest model for coding and agentic tasks across industries',
            recommended: true,
          },
          {
            id: 'gpt-5-mini',
            displayName: 'GPT-5 Mini',
            description: 'Faster, cost-efficient version of GPT-5 for well-defined tasks',
          },
          {
            id: 'gpt-5-nano',
            displayName: 'GPT-5 Nano',
            description: 'Fastest, most cost-efficient version of GPT-5',
          },
          {
            id: 'gpt-4.1',
            displayName: 'GPT-4.1',
            description: 'Smartest non-reasoning model',
          },
          {
            id: 'gpt-4o',
            displayName: 'GPT-4o',
            description: 'Fast, intelligent, flexible GPT model (legacy)',
          },
          {
            id: 'gpt-4o-mini',
            displayName: 'GPT-4o Mini',
            description: 'Fast, affordable small model for focused tasks (legacy)',
          },
        ],
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsStreaming: true,
        supportsVision: true,
        supportsReasoning: true,
        reasoningModels: ['gpt-5.2', 'gpt-5-mini', 'gpt-5-nano', 'o1', 'o1-mini', 'o3', 'o3-mini'],
        contextWindows: {
          'gpt-5.2': 128000,
          'gpt-5-mini': 128000,
          'gpt-5-nano': 128000,
          'gpt-4.1': 128000,
          'gpt-4o': 128000,
          'gpt-4o-mini': 128000,
        },
      },
      {
        apiType: 'openai-legacy',
        displayName: 'OpenAI (Legacy API)',
        description: 'OpenAI language models using the legacy Chat Completions API, compatible with OpenAI-compatible providers',
        models: [
          {
            id: 'gpt-4.1',
            displayName: 'GPT-4.1',
            description: 'Smartest non-reasoning model',
            recommended: true,
          },
          {
            id: 'gpt-4o',
            displayName: 'GPT-4o',
            description: 'Fast, intelligent, flexible GPT model',
          },
          {
            id: 'gpt-4o-mini',
            displayName: 'GPT-4o Mini',
            description: 'Fast, affordable small model for focused tasks',
          },
          {
            id: 'gpt-4-turbo',
            displayName: 'GPT-4 Turbo',
            description: 'Older high-intelligence GPT model',
          },
          {
            id: 'gpt-4',
            displayName: 'GPT-4',
            description: 'Legacy GPT-4 model',
          },
          {
            id: 'gpt-3.5-turbo',
            displayName: 'GPT-3.5 Turbo',
            description: 'Legacy model for cheaper chat and non-chat tasks',
          },
        ],
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsStreaming: true,
        supportsVision: true,
        contextWindows: {
          'gpt-4.1': 128000,
          'gpt-4o': 128000,
          'gpt-4o-mini': 128000,
          'gpt-4-turbo': 128000,
          'gpt-4': 8192,
          'gpt-3.5-turbo': 16385,
        },
      },
      {
        apiType: 'anthropic',
        displayName: 'Anthropic Claude',
        description: 'Anthropic Claude models with advanced reasoning and extended context',
        models: [
          {
            id: 'claude-sonnet-4-5',
            displayName: 'Claude Sonnet 4.5',
            description: 'Smart model for complex agents and coding with extended thinking',
            recommended: true,
          },
          {
            id: 'claude-haiku-4-5',
            displayName: 'Claude Haiku 4.5',
            description: 'Fastest model with near-frontier intelligence',
          },
          {
            id: 'claude-opus-4-5',
            displayName: 'Claude Opus 4.5',
            description: 'Premium model combining maximum intelligence with practical performance',
          },
        ],
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsStreaming: true,
        supportsVision: true,
        supportsReasoning: true,
        reasoningModels: ['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-5'],
        contextWindows: {
          'claude-sonnet-4-5': 200000,
          'claude-haiku-4-5': 200000,
          'claude-opus-4-5': 200000,
        },
      },
      {
        apiType: 'gemini',
        displayName: 'Google Gemini',
        description: 'Google Gemini models with multimodal capabilities and large context windows',
        models: [
          {
            id: 'gemini-3-pro',
            displayName: 'Gemini 3 Pro',
            description: 'Most intelligent model for multimodal understanding and agentic tasks',
            recommended: true,
          },
          {
            id: 'gemini-3-flash',
            displayName: 'Gemini 3 Flash',
            description: 'Most balanced model built for speed, scale, and frontier intelligence',
          },
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            description: 'Best price-performance model for large scale processing and agentic use',
          },
          {
            id: 'gemini-2.5-flash-lite',
            displayName: 'Gemini 2.5 Flash-Lite',
            description: 'Fastest flash model optimized for cost-efficiency and high throughput',
          },
          {
            id: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            description: 'Advanced thinking model for reasoning over complex problems',
          },
        ],
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsStreaming: true,
        supportsVision: true,
        supportsReasoning: true,
        reasoningModels: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
        contextWindows: {
          'gemini-3-pro': 2000000,
          'gemini-3-flash': 1000000,
          'gemini-2.5-flash': 1000000,
          'gemini-2.5-flash-lite': 1000000,
          'gemini-2.5-pro': 2000000,
        },
      },
      {
        apiType: 'groq',
        displayName: 'Groq',
        description: 'Ultra-fast inference using Groq hardware acceleration, compatible with OpenAI API',
        models: [
          {
            id: 'openai/gpt-oss-120b',
            displayName: 'OpenAI GPT-OSS 120B',
            description: 'OpenAI flagship open-weight model with built-in browser search and code execution',
            recommended: true,
          },
          {
            id: 'openai/gpt-oss-20b',
            displayName: 'OpenAI GPT-OSS 20B',
            description: 'Medium-sized open-weight model for low latency',
          },
          {
            id: 'llama-3.3-70b-versatile',
            displayName: 'Llama 3.3 70B Versatile',
            description: 'Latest Llama model with balanced capabilities',
          },
          {
            id: 'llama-3.1-70b-versatile',
            displayName: 'Llama 3.1 70B Versatile',
            description: 'Large model for complex tasks',
          },
          {
            id: 'llama-3.1-8b-instant',
            displayName: 'Llama 3.1 8B Instant',
            description: 'Ultra-fast model for simple tasks',
          },
        ],
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsStreaming: true,
        supportsVision: false,
        contextWindows: {
          'openai/gpt-oss-120b': 131072,
          'openai/gpt-oss-20b': 131072,
          'llama-3.3-70b-versatile': 131072,
          'llama-3.1-70b-versatile': 131072,
          'llama-3.1-8b-instant': 131072,
        },
      },
      {
        apiType: 'vertex',
        displayName: 'Google Vertex AI',
        description: 'Google Cloud Vertex AI with access to various models including Gemini',
        models: [
          {
            id: 'gemini-3-pro',
            displayName: 'Gemini 3 Pro',
            description: 'Most intelligent model via Vertex AI',
            recommended: true,
          },
          {
            id: 'gemini-3-flash',
            displayName: 'Gemini 3 Flash',
            description: 'Most balanced model via Vertex AI',
          },
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            description: 'Fast model optimized for large scale processing',
          },
          {
            id: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            description: 'Advanced thinking model via Vertex AI',
          },
        ],
        supportsToolCalling: true,
        supportsJsonOutput: true,
        supportsStreaming: true,
        supportsVision: true,
        supportsReasoning: true,
        reasoningModels: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'],
        contextWindows: {
          'gemini-3-pro': 2000000,
          'gemini-3-flash': 1000000,
          'gemini-2.5-flash': 1000000,
          'gemini-2.5-pro': 2000000,
        },
      },
    ];
  }
}
