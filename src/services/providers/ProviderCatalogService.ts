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
 * Schema for information about a specific ASR model supported by a provider
 */
export const asrModelInfoSchema = z.object({
  id: z.string().describe('Model identifier'),
  displayName: z.string().describe('Human-readable display name'),
  description: z.string().optional().describe('Description of the model\'s capabilities and use cases'),
  recommended: z.boolean().optional().describe('Whether this is a recommended or default model'),
  languages: z.array(z.string()).optional().describe('Language codes supported by this model (if model-specific)'),
  supportsCustomVocabulary: z.boolean().optional().describe('Whether this model supports custom vocabulary/phrases'),
  supportsStreaming: z.boolean().optional().describe('Whether this model supports streaming transcription'),
  supportedAudioFormats: z.array(z.string()).optional().describe('Audio input formats supported by this model'),
}).openapi('AsrModelInfo');

export type AsrModelInfo = z.infer<typeof asrModelInfoSchema>;

/**
 * Schema for information about a specific LLM model supported by a provider
 */
export const llmModelInfoSchema = z.object({
  id: z.string().describe('Model identifier'),
  displayName: z.string().describe('Human-readable display name'),
  description: z.string().optional().describe('Description of the model\'s capabilities and use cases'),
  recommended: z.boolean().optional().describe('Whether this is a recommended or default model'),
  supportsToolCalling: z.boolean().optional().describe('Whether this model supports tool calling (function calling)'),
  supportsJsonOutput: z.boolean().optional().describe('Whether this model supports structured JSON output'),
  supportsStreaming: z.boolean().optional().describe('Whether this model supports streaming responses'),
  supportsVision: z.boolean().optional().describe('Whether this model supports vision/image input'),
  supportsImageGeneration: z.boolean().optional().describe('Whether this model supports image generation output'),
  supportsReasoning: z.boolean().optional().describe('Whether this model supports reasoning/thinking modes for deeper analysis'),
  contextWindow: z.number().optional().describe('Context window size (in tokens) for this model'),
}).openapi('LlmModelInfo');

export type LlmModelInfo = z.infer<typeof llmModelInfoSchema>;

/**
 * Schema for information about a voice supported by a TTS provider
 */
export const voiceInfoSchema = z.object({
  id: z.string().describe('Voice identifier'),
  displayName: z.string().describe('Human-readable name'),
  description: z.string().optional().describe('Description of voice characteristics'),
  gender: z.enum(['male', 'female', 'neutral']).optional().describe('Gender of the voice (if applicable)'),
  languages: z.array(z.string()).optional().describe('Languages supported by this voice'),
  recommended: z.boolean().optional().describe('Whether this is a recommended or default voice'),
}).openapi('VoiceInfo');

export type VoiceInfo = z.infer<typeof voiceInfoSchema>;

/**
 * Schema for TTS-specific model information with streaming and voice capabilities.
 */
export const ttsModelInfoSchema = z.object({
  id: z.string().describe('Model identifier'),
  displayName: z.string().describe('Human-readable display name'),
  description: z.string().optional().describe('Description of the model\'s capabilities and use cases'),
  recommended: z.boolean().optional().describe('Whether this is a recommended or default model'),
  voices: z.array(voiceInfoSchema).optional().describe('Model-specific voices that override provider-level voices'),
  languages: z.array(z.string()).optional().describe('Language codes supported by this model (if model-specific)'),
  supportsFullStreaming: z.boolean().optional().describe('Whether this model supports full streaming (chunk-by-chunk)'),
  supportsVoiceSettings: z.boolean().optional().describe('Whether this model supports voice customization settings'),
  supportedAudioFormats: z.array(z.string()).optional().describe('Audio output formats supported by this model'),
}).openapi('TtsModelInfo');

export type TtsModelInfo = z.infer<typeof ttsModelInfoSchema>;

/**
 * Schema for language support information
 */
export const languageInfoSchema = z.object({
  code: z.string().describe('ISO language code (e.g., \'en-US\', \'es-ES\')'),
  displayName: z.string().describe('Human-readable language name'),
}).openapi('LanguageInfo');

export type LanguageInfo = z.infer<typeof languageInfoSchema>;

/**
 * Schema for ASR provider capabilities
 */
export const asrProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  models: z.array(asrModelInfoSchema).describe('Models available for this provider'),
  languages: z.array(languageInfoSchema).describe('Languages commonly supported across models (for reference)'),
  description: z.string().optional().describe('Additional information'),
});

export type AsrProviderInfo = z.infer<typeof asrProviderInfoSchema>;

/**
 * Schema for TTS provider capabilities
 */
export const ttsProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  models: z.array(ttsModelInfoSchema).describe('Models available for this provider'),
  voices: z.array(voiceInfoSchema).describe('Voices available (can be provider-specific or model-specific)'),
  languages: z.array(languageInfoSchema).describe('Languages commonly supported across models (for reference)'),
  description: z.string().optional().describe('Additional information'),
});

export type TtsProviderInfo = z.infer<typeof ttsProviderInfoSchema>;

/**
 * Schema for LLM provider capabilities
 */
export const llmProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  models: z.array(llmModelInfoSchema).describe('Models available for this provider'),
  description: z.string().optional().describe('Additional information'),
});

export type LlmProviderInfo = z.infer<typeof llmProviderInfoSchema>;

/**
 * Schema for storage provider capabilities
 */
export const storageProviderInfoSchema = z.object({
  apiType: z.string().describe('Provider API type'),
  displayName: z.string().describe('Human-readable provider name'),
  description: z.string().optional().describe('Additional information'),
  features: z.array(z.string()).optional().describe('List of supported features'),
});

export type StorageProviderInfo = z.infer<typeof storageProviderInfoSchema>;

/**
 * Schema for complete provider catalog
 */
export const providerCatalogSchema = z.object({
  asr: z.array(asrProviderInfoSchema).describe('ASR providers'),
  tts: z.array(ttsProviderInfoSchema).describe('TTS providers'),
  llm: z.array(llmProviderInfoSchema).describe('LLM providers'),
  storage: z.array(storageProviderInfoSchema).describe('Storage providers'),
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
      storage: this.getStorageProviders(),
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
   * Gets information about a specific storage provider by API type
   */
  getStorageProvider(apiType: string): StorageProviderInfo | undefined {
    return this.getStorageProviders().find((p) => p.apiType === apiType);
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
        models: [
          {
            id: 'default',
            displayName: 'Azure Speech Recognition',
            description: 'Standard Azure speech-to-text model with multi-language support',
            recommended: true,
            languages: ['en-US', 'en-GB', 'es-ES', 'es-MX', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'zh-CN', 'zh-TW', 'ko-KR', 'ar-SA', 'hi-IN', 'ru-RU', 'nl-NL', 'pl-PL', 'sv-SE', 'tr-TR'],
            supportedAudioFormats: ['pcm_16000'],
            supportsCustomVocabulary: true,
            supportsStreaming: true,
          },
        ],
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
      },
      {
        apiType: 'elevenlabs',
        displayName: 'ElevenLabs',
        description: 'ElevenLabs Scribe speech-to-text API with real-time streaming transcription and voice activity detection',
        models: [
          {
            id: 'scribe_v2_realtime',
            displayName: 'Scribe v2 Realtime',
            description: 'Latest generation real-time speech recognition model with high accuracy and low latency',
            recommended: true,
            languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'cs', 'da', 'fi', 'el', 'hu', 'id', 'ms', 'no', 'ro', 'sk', 'sv', 'ta', 'tr', 'uk', 'vi'],
            supportedAudioFormats: ['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100'],
            supportsCustomVocabulary: false,
            supportsStreaming: true,
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
          { code: 'cs', displayName: 'Czech' },
          { code: 'da', displayName: 'Danish' },
          { code: 'fi', displayName: 'Finnish' },
          { code: 'el', displayName: 'Greek' },
          { code: 'hu', displayName: 'Hungarian' },
          { code: 'id', displayName: 'Indonesian' },
          { code: 'ms', displayName: 'Malay' },
          { code: 'no', displayName: 'Norwegian' },
          { code: 'ro', displayName: 'Romanian' },
          { code: 'sk', displayName: 'Slovak' },
          { code: 'sv', displayName: 'Swedish' },
          { code: 'ta', displayName: 'Tamil' },
          { code: 'tr', displayName: 'Turkish' },
          { code: 'uk', displayName: 'Ukrainian' },
          { code: 'vi', displayName: 'Vietnamese' },
        ],
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
            id: 'eleven_v3',
            displayName: 'Eleven v3',
            description: 'Most advanced emotionally rich speech synthesis model with dramatic delivery and 70+ languages',
            recommended: true,
            languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'af', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'hr', 'cs', 'da', 'et', 'fi', 'gl', 'ka', 'el', 'gu', 'ha', 'he', 'hu', 'is', 'id', 'ga', 'jv', 'kn', 'kk', 'ky', 'lv', 'lt', 'lb', 'mk', 'ms', 'ml', 'mr', 'ne', 'no', 'ps', 'fa', 'pa', 'ro', 'sr', 'sd', 'sk', 'sl', 'so', 'sw', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'cy'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'eleven_flash_v2_5',
            displayName: 'Eleven Flash v2.5',
            description: 'Ultra-fast model with ~75ms latency, 32 languages, optimized for real-time applications',
            languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'hu', 'no', 'vi', 'bg', 'ro', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'id', 'tr', 'fil', 'sv'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'eleven_flash_v2',
            displayName: 'Eleven Flash v2',
            description: 'Ultra-fast English-only model with ~75ms latency',
            languages: ['en'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'eleven_multilingual_v2',
            displayName: 'Eleven Multilingual v2',
            description: 'Most lifelike model with rich emotional expression, supporting 29 languages',
            languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'bg', 'ro', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'id', 'tr', 'fil', 'sv'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'eleven_turbo_v2_5',
            displayName: 'Eleven Turbo v2.5',
            description: 'High quality, low-latency model (~250-300ms) with good balance of quality and speed, 32 languages',
            languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'nl', 'ja', 'zh', 'ko', 'ar', 'hi', 'ru', 'hu', 'no', 'vi', 'bg', 'ro', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'id', 'tr', 'fil', 'sv'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'eleven_turbo_v2',
            displayName: 'Eleven Turbo v2',
            description: 'Previous generation English-only turbo model (~250-300ms latency)',
            languages: ['en'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'eleven_monolingual_v1',
            displayName: 'Eleven Monolingual v1',
            description: 'Original English-only model with high quality',
            languages: ['en'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_44100'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
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
      },
      {
        apiType: 'openai',
        displayName: 'OpenAI Text-to-Speech',
        description: 'OpenAI TTS with gpt-4o-mini-tts (promptable voice control), tts-1 (low latency), and tts-1-hd (high quality) models',
        models: [
          {
            id: 'gpt-4o-mini-tts',
            displayName: 'GPT-4o Mini TTS',
            description: 'Newest promptable model with voice control for accent, tone, emotion, and more',
            recommended: true,
            languages: ['af', 'ar', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'zh', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'he', 'hi', 'hu', 'is', 'id', 'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'mr', 'mi', 'ne', 'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw', 'sv', 'tl', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'cy'],
            supportedAudioFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm_24000'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
            voices: [
              {
                id: 'coral',
                displayName: 'Coral',
                description: 'Warm voice',
                gender: 'neutral',
                languages: ['en'],
                recommended: true,
              },
              {
                id: 'verse',
                displayName: 'Verse',
                description: 'Poetic voice',
                gender: 'neutral',
                languages: ['en'],
                recommended: true,
              },
              {
                id: 'marin',
                displayName: 'Marin',
                description: 'High quality voice optimized for gpt-4o-mini-tts',
                gender: 'neutral',
                languages: ['en'],
                recommended: true,
              },
              {
                id: 'cedar',
                displayName: 'Cedar',
                description: 'High quality voice optimized for gpt-4o-mini-tts',
                gender: 'neutral',
                languages: ['en'],
                recommended: true,
              },
              {
                id: 'alloy',
                displayName: 'Alloy',
                description: 'Neutral voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'ash',
                displayName: 'Ash',
                description: 'Clear voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'ballad',
                displayName: 'Ballad',
                description: 'Expressive voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'echo',
                displayName: 'Echo',
                description: 'Resonant voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'fable',
                displayName: 'Fable',
                description: 'Storytelling voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'nova',
                displayName: 'Nova',
                description: 'Bright voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'onyx',
                displayName: 'Onyx',
                description: 'Deep voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'sage',
                displayName: 'Sage',
                description: 'Wise voice',
                gender: 'neutral',
                languages: ['en'],
              },
              {
                id: 'shimmer',
                displayName: 'Shimmer',
                description: 'Bright and clear voice',
                gender: 'neutral',
                languages: ['en'],
              },
            ],
          },
          {
            id: 'tts-1',
            displayName: 'TTS-1',
            description: 'Low latency model for real-time applications',
            languages: ['af', 'ar', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'zh', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'he', 'hi', 'hu', 'is', 'id', 'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'mr', 'mi', 'ne', 'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw', 'sv', 'tl', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'cy'],
            supportedAudioFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm_24000'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'tts-1-hd',
            displayName: 'TTS-1 HD',
            description: 'Higher quality model with improved audio fidelity',
            languages: ['af', 'ar', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'zh', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'he', 'hi', 'hu', 'is', 'id', 'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'mr', 'mi', 'ne', 'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw', 'sv', 'tl', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'cy'],
            supportedAudioFormats: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm_24000'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
        ],
        voices: [
          {
            id: 'alloy',
            displayName: 'Alloy',
            description: 'Neutral voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'ash',
            displayName: 'Ash',
            description: 'Clear voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'ballad',
            displayName: 'Ballad',
            description: 'Expressive voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'echo',
            displayName: 'Echo',
            description: 'Resonant voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'fable',
            displayName: 'Fable',
            description: 'Storytelling voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'nova',
            displayName: 'Nova',
            description: 'Bright voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'onyx',
            displayName: 'Onyx',
            description: 'Deep voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'sage',
            displayName: 'Sage',
            description: 'Wise voice',
            gender: 'neutral',
            languages: ['en'],
          },
          {
            id: 'shimmer',
            displayName: 'Shimmer',
            description: 'Bright and clear voice',
            gender: 'neutral',
            languages: ['en'],
          },
        ],
        languages: [
          { code: 'af', displayName: 'Afrikaans' },
          { code: 'ar', displayName: 'Arabic' },
          { code: 'hy', displayName: 'Armenian' },
          { code: 'az', displayName: 'Azerbaijani' },
          { code: 'be', displayName: 'Belarusian' },
          { code: 'bs', displayName: 'Bosnian' },
          { code: 'bg', displayName: 'Bulgarian' },
          { code: 'ca', displayName: 'Catalan' },
          { code: 'zh', displayName: 'Chinese' },
          { code: 'hr', displayName: 'Croatian' },
          { code: 'cs', displayName: 'Czech' },
          { code: 'da', displayName: 'Danish' },
          { code: 'nl', displayName: 'Dutch' },
          { code: 'en', displayName: 'English' },
          { code: 'et', displayName: 'Estonian' },
          { code: 'fi', displayName: 'Finnish' },
          { code: 'fr', displayName: 'French' },
          { code: 'gl', displayName: 'Galician' },
          { code: 'de', displayName: 'German' },
          { code: 'el', displayName: 'Greek' },
          { code: 'he', displayName: 'Hebrew' },
          { code: 'hi', displayName: 'Hindi' },
          { code: 'hu', displayName: 'Hungarian' },
          { code: 'is', displayName: 'Icelandic' },
          { code: 'id', displayName: 'Indonesian' },
          { code: 'it', displayName: 'Italian' },
          { code: 'ja', displayName: 'Japanese' },
          { code: 'kn', displayName: 'Kannada' },
          { code: 'kk', displayName: 'Kazakh' },
          { code: 'ko', displayName: 'Korean' },
          { code: 'lv', displayName: 'Latvian' },
          { code: 'lt', displayName: 'Lithuanian' },
          { code: 'mk', displayName: 'Macedonian' },
          { code: 'ms', displayName: 'Malay' },
          { code: 'mr', displayName: 'Marathi' },
          { code: 'mi', displayName: 'Maori' },
          { code: 'ne', displayName: 'Nepali' },
          { code: 'no', displayName: 'Norwegian' },
          { code: 'fa', displayName: 'Persian' },
          { code: 'pl', displayName: 'Polish' },
          { code: 'pt', displayName: 'Portuguese' },
          { code: 'ro', displayName: 'Romanian' },
          { code: 'ru', displayName: 'Russian' },
          { code: 'sr', displayName: 'Serbian' },
          { code: 'sk', displayName: 'Slovak' },
          { code: 'sl', displayName: 'Slovenian' },
          { code: 'es', displayName: 'Spanish' },
          { code: 'sw', displayName: 'Swahili' },
          { code: 'sv', displayName: 'Swedish' },
          { code: 'tl', displayName: 'Tagalog' },
          { code: 'ta', displayName: 'Tamil' },
          { code: 'th', displayName: 'Thai' },
          { code: 'tr', displayName: 'Turkish' },
          { code: 'uk', displayName: 'Ukrainian' },
          { code: 'ur', displayName: 'Urdu' },
          { code: 'vi', displayName: 'Vietnamese' },
          { code: 'cy', displayName: 'Welsh' },
        ],
      },
      {
        apiType: 'deepgram',
        displayName: 'Deepgram Aura Text-to-Speech',
        description: 'Deepgram Aura streaming text-to-speech with ultra-low latency and high-quality voices across multiple languages',
        models: [
          {
            id: 'aura-2',
            displayName: 'Aura 2',
            description: 'Latest generation model with improved quality, multilingual support, and expanded voice options',
            recommended: true,
            voices: [
              // Featured English voices
              { id: 'thalia-en', displayName: 'Thalia (English)', description: 'Clear, confident, energetic, enthusiastic', gender: 'female', languages: ['en-us'], recommended: true },
              { id: 'andromeda-en', displayName: 'Andromeda (English)', description: 'Casual, expressive, comfortable', gender: 'female', languages: ['en-us'], recommended: true },
              { id: 'helena-en', displayName: 'Helena (English)', description: 'Caring, natural, positive, friendly, raspy', gender: 'female', languages: ['en-us'], recommended: true },
              { id: 'apollo-en', displayName: 'Apollo (English)', description: 'Confident, comfortable, casual', gender: 'male', languages: ['en-us'], recommended: true },
              { id: 'arcas-en', displayName: 'Arcas (English)', description: 'Natural, smooth, clear, comfortable', gender: 'male', languages: ['en-us'], recommended: true },
              { id: 'aries-en', displayName: 'Aries (English)', description: 'Warm, energetic, caring', gender: 'male', languages: ['en-us'], recommended: true },
              // All other English voices
              { id: 'amalthea-en', displayName: 'Amalthea (English)', description: 'Engaging, natural, cheerful', gender: 'female', languages: ['en-ph'] },
              { id: 'asteria-en', displayName: 'Asteria (English)', description: 'Clear, confident, knowledgeable, energetic', gender: 'female', languages: ['en-us'] },
              { id: 'athena-en', displayName: 'Athena (English)', description: 'Calm, smooth, professional', gender: 'female', languages: ['en-us'] },
              { id: 'atlas-en', displayName: 'Atlas (English)', description: 'Enthusiastic, confident, approachable, friendly', gender: 'male', languages: ['en-us'] },
              { id: 'aurora-en', displayName: 'Aurora (English)', description: 'Cheerful, expressive, energetic', gender: 'female', languages: ['en-us'] },
              { id: 'callista-en', displayName: 'Callista (English)', description: 'Clear, energetic, professional, smooth', gender: 'female', languages: ['en-us'] },
              { id: 'cora-en', displayName: 'Cora (English)', description: 'Smooth, melodic, caring', gender: 'female', languages: ['en-us'] },
              { id: 'cordelia-en', displayName: 'Cordelia (English)', description: 'Approachable, warm, polite', gender: 'female', languages: ['en-us'] },
              { id: 'delia-en', displayName: 'Delia (English)', description: 'Casual, friendly, cheerful, breathy', gender: 'female', languages: ['en-us'] },
              { id: 'draco-en', displayName: 'Draco (English)', description: 'Warm, approachable, trustworthy, baritone', gender: 'male', languages: ['en-gb'] },
              { id: 'electra-en', displayName: 'Electra (English)', description: 'Professional, engaging, knowledgeable', gender: 'female', languages: ['en-us'] },
              { id: 'harmonia-en', displayName: 'Harmonia (English)', description: 'Empathetic, clear, calm, confident', gender: 'female', languages: ['en-us'] },
              { id: 'hera-en', displayName: 'Hera (English)', description: 'Smooth, warm, professional', gender: 'female', languages: ['en-us'] },
              { id: 'hermes-en', displayName: 'Hermes (English)', description: 'Expressive, engaging, professional', gender: 'male', languages: ['en-us'] },
              { id: 'hyperion-en', displayName: 'Hyperion (English)', description: 'Caring, warm, empathetic', gender: 'male', languages: ['en-au'] },
              { id: 'iris-en', displayName: 'Iris (English)', description: 'Cheerful, positive, approachable', gender: 'female', languages: ['en-us'] },
              { id: 'janus-en', displayName: 'Janus (English)', description: 'Southern, smooth, trustworthy', gender: 'female', languages: ['en-us'] },
              { id: 'juno-en', displayName: 'Juno (English)', description: 'Natural, engaging, melodic, breathy', gender: 'female', languages: ['en-us'] },
              { id: 'jupiter-en', displayName: 'Jupiter (English)', description: 'Expressive, knowledgeable, baritone', gender: 'male', languages: ['en-us'] },
              { id: 'luna-en', displayName: 'Luna (English)', description: 'Friendly, natural, engaging', gender: 'female', languages: ['en-us'] },
              { id: 'mars-en', displayName: 'Mars (English)', description: 'Smooth, patient, trustworthy, baritone', gender: 'male', languages: ['en-us'] },
              { id: 'minerva-en', displayName: 'Minerva (English)', description: 'Positive, friendly, natural', gender: 'female', languages: ['en-us'] },
              { id: 'neptune-en', displayName: 'Neptune (English)', description: 'Professional, patient, polite', gender: 'male', languages: ['en-us'] },
              { id: 'odysseus-en', displayName: 'Odysseus (English)', description: 'Calm, smooth, comfortable, professional', gender: 'male', languages: ['en-us'] },
              { id: 'ophelia-en', displayName: 'Ophelia (English)', description: 'Expressive, enthusiastic, cheerful', gender: 'female', languages: ['en-us'] },
              { id: 'orion-en', displayName: 'Orion (English)', description: 'Approachable, comfortable, calm, polite', gender: 'male', languages: ['en-us'] },
              { id: 'orpheus-en', displayName: 'Orpheus (English)', description: 'Professional, clear, confident, trustworthy', gender: 'male', languages: ['en-us'] },
              { id: 'pandora-en', displayName: 'Pandora (English)', description: 'Smooth, calm, melodic, breathy', gender: 'female', languages: ['en-gb'] },
              { id: 'phoebe-en', displayName: 'Phoebe (English)', description: 'Energetic, warm, casual', gender: 'female', languages: ['en-us'] },
              { id: 'pluto-en', displayName: 'Pluto (English)', description: 'Smooth, calm, empathetic, baritone', gender: 'male', languages: ['en-us'] },
              { id: 'saturn-en', displayName: 'Saturn (English)', description: 'Knowledgeable, confident, baritone', gender: 'male', languages: ['en-us'] },
              { id: 'selene-en', displayName: 'Selene (English)', description: 'Expressive, engaging, energetic', gender: 'female', languages: ['en-us'] },
              { id: 'stella-en', displayName: 'Stella (English)', description: 'Clear, professional, engaging', gender: 'female', languages: ['en-us'] },
              { id: 'theia-en', displayName: 'Theia (English)', description: 'Expressive, polite, sincere', gender: 'female', languages: ['en-au'] },
              { id: 'vesta-en', displayName: 'Vesta (English)', description: 'Natural, expressive, patient, empathetic', gender: 'female', languages: ['en-us'] },
              { id: 'zeus-en', displayName: 'Zeus (English)', description: 'Deep, trustworthy, smooth', gender: 'male', languages: ['en-us'] },
              // Spanish voices
              { id: 'celeste-es', displayName: 'Celeste (Spanish)', description: 'Clear, energetic, positive, friendly, enthusiastic', gender: 'female', languages: ['es-co'] },
              { id: 'estrella-es', displayName: 'Estrella (Spanish)', description: 'Approachable, natural, calm, comfortable, expressive', gender: 'female', languages: ['es-mx'] },
              { id: 'nestor-es', displayName: 'Nestor (Spanish)', description: 'Calm, professional, approachable, clear, confident', gender: 'male', languages: ['es-es'] },
              { id: 'sirio-es', displayName: 'Sirio (Spanish)', description: 'Calm, professional, comfortable, empathetic, baritone', gender: 'male', languages: ['es-mx'] },
              { id: 'carina-es', displayName: 'Carina (Spanish)', description: 'Professional, raspy, energetic, breathy, confident', gender: 'female', languages: ['es-es'] },
              { id: 'alvaro-es', displayName: 'Alvaro (Spanish)', description: 'Calm, professional, clear, knowledgeable, approachable', gender: 'male', languages: ['es-es'] },
              { id: 'diana-es', displayName: 'Diana (Spanish)', description: 'Professional, confident, expressive, polite, knowledgeable', gender: 'female', languages: ['es-es'] },
              { id: 'aquila-es', displayName: 'Aquila (Spanish)', description: 'Expressive, enthusiastic, confident, casual, comfortable', gender: 'male', languages: ['es-419'] },
              { id: 'selena-es', displayName: 'Selena (Spanish)', description: 'Approachable, casual, friendly, calm, positive', gender: 'female', languages: ['es-419'] },
              { id: 'javier-es', displayName: 'Javier (Spanish)', description: 'Approachable, professional, friendly, comfortable, calm', gender: 'male', languages: ['es-mx'] },
              { id: 'agustina-es', displayName: 'Agustina (Spanish)', description: 'Calm, clear, expressive, knowledgeable, professional', gender: 'female', languages: ['es-es'] },
              { id: 'antonia-es', displayName: 'Antonia (Spanish)', description: 'Approachable, enthusiastic, friendly, natural, professional', gender: 'female', languages: ['es-ar'] },
              { id: 'gloria-es', displayName: 'Gloria (Spanish)', description: 'Casual, clear, expressive, natural, smooth', gender: 'female', languages: ['es-co'] },
              { id: 'luciano-es', displayName: 'Luciano (Spanish)', description: 'Charismatic, cheerful, energetic, expressive, friendly', gender: 'male', languages: ['es-mx'] },
              { id: 'olivia-es', displayName: 'Olivia (Spanish)', description: 'Breathy, calm, casual, expressive, warm', gender: 'female', languages: ['es-mx'] },
              { id: 'silvia-es', displayName: 'Silvia (Spanish)', description: 'Charismatic, clear, expressive, natural, warm', gender: 'female', languages: ['es-es'] },
              { id: 'valerio-es', displayName: 'Valerio (Spanish)', description: 'Deep, knowledgeable, natural, polite, professional', gender: 'male', languages: ['es-mx'] },
              // Dutch voices
              { id: 'rhea-nl', displayName: 'Rhea (Dutch)', description: 'Caring, knowledgeable, positive, smooth, warm', gender: 'female', languages: ['nl-nl'] },
              { id: 'sander-nl', displayName: 'Sander (Dutch)', description: 'Calm, clear, deep, professional, smooth', gender: 'male', languages: ['nl-nl'] },
              { id: 'beatrix-nl', displayName: 'Beatrix (Dutch)', description: 'Cheerful, enthusiastic, friendly, trustworthy, warm', gender: 'female', languages: ['nl-nl'] },
              { id: 'daphne-nl', displayName: 'Daphne (Dutch)', description: 'Calm, clear, confident, professional, smooth', gender: 'female', languages: ['nl-nl'] },
              { id: 'cornelia-nl', displayName: 'Cornelia (Dutch)', description: 'Approachable, friendly, polite, positive, warm', gender: 'female', languages: ['nl-nl'] },
              { id: 'hestia-nl', displayName: 'Hestia (Dutch)', description: 'Approachable, caring, expressive, friendly, knowledgeable', gender: 'female', languages: ['nl-nl'] },
              { id: 'lars-nl', displayName: 'Lars (Dutch)', description: 'Breathy, casual, comfortable, sincere, trustworthy', gender: 'male', languages: ['nl-nl'] },
              { id: 'roman-nl', displayName: 'Roman (Dutch)', description: 'Calm, casual, deep, natural, patient', gender: 'male', languages: ['nl-nl'] },
              { id: 'leda-nl', displayName: 'Leda (Dutch)', description: 'Caring, comfortable, empathetic, friendly, sincere', gender: 'female', languages: ['nl-nl'] },
              // French voices
              { id: 'agathe-fr', displayName: 'Agathe (French)', description: 'Charismatic, cheerful, enthusiastic, friendly, natural', gender: 'female', languages: ['fr-fr'] },
              { id: 'hector-fr', displayName: 'Hector (French)', description: 'Confident, empathetic, expressive, friendly, patient', gender: 'male', languages: ['fr-fr'] },
              // German voices
              { id: 'julius-de', displayName: 'Julius (German)', description: 'Casual, cheerful, engaging, expressive, friendly', gender: 'male', languages: ['de-de'] },
              { id: 'viktoria-de', displayName: 'Viktoria (German)', description: 'Charismatic, cheerful, enthusiastic, friendly, warm', gender: 'female', languages: ['de-de'] },
              { id: 'elara-de', displayName: 'Elara (German)', description: 'Calm, clear, natural, patient, trustworthy', gender: 'female', languages: ['de-de'] },
              { id: 'aurelia-de', displayName: 'Aurelia (German)', description: 'Approachable, casual, comfortable, natural, sincere', gender: 'female', languages: ['de-de'] },
              { id: 'lara-de', displayName: 'Lara (German)', description: 'Caring, cheerful, empathetic, expressive, warm', gender: 'female', languages: ['de-de'] },
              { id: 'fabian-de', displayName: 'Fabian (German)', description: 'Confident, knowledgeable, natural, polite, professional', gender: 'male', languages: ['de-de'] },
              { id: 'kara-de', displayName: 'Kara (German)', description: 'Caring, empathetic, expressive, professional, warm', gender: 'female', languages: ['de-de'] },
              // Italian voices
              { id: 'livia-it', displayName: 'Livia (Italian)', description: 'Approachable, cheerful, clear, engaging, expressive', gender: 'female', languages: ['it-it'] },
              { id: 'dionisio-it', displayName: 'Dionisio (Italian)', description: 'Confident, engaging, friendly, melodic, positive', gender: 'male', languages: ['it-it'] },
              { id: 'melia-it', displayName: 'Melia (Italian)', description: 'Clear, comfortable, engaging, friendly, natural', gender: 'female', languages: ['it-it'] },
              { id: 'elio-it', displayName: 'Elio (Italian)', description: 'Breathy, calm, professional, smooth, trustworthy', gender: 'male', languages: ['it-it'] },
              { id: 'flavio-it', displayName: 'Flavio (Italian)', description: 'Confident, deep, empathetic, professional, trustworthy', gender: 'male', languages: ['it-it'] },
              { id: 'maia-it', displayName: 'Maia (Italian)', description: 'Caring, energetic, expressive, professional, warm', gender: 'female', languages: ['it-it'] },
              { id: 'cinzia-it', displayName: 'Cinzia (Italian)', description: 'Approachable, friendly, smooth, trustworthy, warm', gender: 'female', languages: ['it-it'] },
              { id: 'cesare-it', displayName: 'Cesare (Italian)', description: 'Clear, empathetic, knowledgeable, natural, smooth', gender: 'male', languages: ['it-it'] },
              { id: 'perseo-it', displayName: 'Perseo (Italian)', description: 'Casual, clear, natural, polite, smooth', gender: 'male', languages: ['it-it'] },
              { id: 'demetra-it', displayName: 'Demetra (Italian)', description: 'Calm, comfortable, patient', gender: 'female', languages: ['it-it'] },
              // Japanese voices
              { id: 'fujin-ja', displayName: 'Fujin (Japanese)', description: 'Calm, confident, knowledgeable, professional, smooth', gender: 'male', languages: ['ja-jp'] },
              { id: 'izanami-ja', displayName: 'Izanami (Japanese)', description: 'Approachable, clear, knowledgeable, polite, professional', gender: 'female', languages: ['ja-jp'] },
              { id: 'uzume-ja', displayName: 'Uzume (Japanese)', description: 'Approachable, clear, polite, professional, trustworthy', gender: 'female', languages: ['ja-jp'] },
              { id: 'ebisu-ja', displayName: 'Ebisu (Japanese)', description: 'Calm, deep, natural, patient, sincere', gender: 'male', languages: ['ja-jp'] },
              { id: 'ama-ja', displayName: 'Ama (Japanese)', description: 'Casual, comfortable, confident, knowledgeable, natural', gender: 'female', languages: ['ja-jp'] },
            ],
            languages: ['en', 'es', 'nl', 'de', 'fr', 'it', 'ja'],
            supportedAudioFormats: ['linear16', 'opus', 'mulaw', 'alaw', 'mp3', 'flac', 'aac'],
            supportsFullStreaming: true,
            supportsVoiceSettings: false,
          },
          {
            id: 'aura-1',
            displayName: 'Aura 1',
            description: 'First generation model with English-only support',
            voices: [
              { id: 'asteria-en', displayName: 'Asteria (English)', description: 'Clear, confident, knowledgeable, energetic', gender: 'female', languages: ['en-us'] },
              { id: 'luna-en', displayName: 'Luna (English)', description: 'Friendly, natural, engaging', gender: 'female', languages: ['en-us'] },
              { id: 'stella-en', displayName: 'Stella (English)', description: 'Clear, professional, engaging', gender: 'female', languages: ['en-us'] },
              { id: 'athena-en', displayName: 'Athena (English)', description: 'Calm, smooth, professional', gender: 'female', languages: ['en-gb'] },
              { id: 'hera-en', displayName: 'Hera (English)', description: 'Smooth, warm, professional', gender: 'female', languages: ['en-us'] },
              { id: 'orion-en', displayName: 'Orion (English)', description: 'Approachable, comfortable, calm, polite', gender: 'male', languages: ['en-us'] },
              { id: 'arcas-en', displayName: 'Arcas (English)', description: 'Natural, smooth, clear, comfortable', gender: 'male', languages: ['en-us'] },
              { id: 'perseus-en', displayName: 'Perseus (English)', description: 'Confident, professional, clear', gender: 'male', languages: ['en-us'] },
              { id: 'angus-en', displayName: 'Angus (English)', description: 'Warm, friendly, natural', gender: 'male', languages: ['en-ie'] },
              { id: 'orpheus-en', displayName: 'Orpheus (English)', description: 'Professional, clear, confident, trustworthy', gender: 'male', languages: ['en-us'] },
              { id: 'helios-en', displayName: 'Helios (English)', description: 'Professional, clear, confident', gender: 'male', languages: ['en-gb'] },
              { id: 'zeus-en', displayName: 'Zeus (English)', description: 'Deep, trustworthy, smooth', gender: 'male', languages: ['en-us'] },
            ],
            languages: ['en'],
            supportedAudioFormats: ['linear16', 'opus', 'mulaw', 'alaw', 'mp3', 'flac', 'aac'],
            supportsFullStreaming: true,
            supportsVoiceSettings: false,
          },
        ],
        voices: [],
        languages: [
          { code: 'en', displayName: 'English' },
          { code: 'es', displayName: 'Spanish' },
          { code: 'de', displayName: 'German' },
          { code: 'fr', displayName: 'French' },
          { code: 'nl', displayName: 'Dutch' },
          { code: 'it', displayName: 'Italian' },
          { code: 'ja', displayName: 'Japanese' },
        ],
      },
      {
        apiType: 'cartesia',
        displayName: 'Cartesia',
        description: 'Cartesia Sonic text-to-speech with ultra-low latency, 42 languages, and expressive voice control',
        models: [
          {
            id: 'sonic-3-latest',
            displayName: 'Sonic 3 Latest',
            description: 'Latest beta release with newest capabilities (can change without notice)',
            recommended: true,
            languages: ['en', 'de', 'es', 'fr', 'ja', 'pt', 'zh', 'hi', 'ko', 'it', 'nl', 'pl', 'ru', 'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id', 'te', 'gu', 'kn', 'ml', 'mr', 'pa'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'mulaw', 'alaw'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'sonic-3',
            displayName: 'Sonic 3',
            description: 'Latest stable model with high naturalness, accurate transcript following, and industry-leading latency',
            languages: ['en', 'de', 'es', 'fr', 'ja', 'pt', 'zh', 'hi', 'ko', 'it', 'nl', 'pl', 'ru', 'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id', 'te', 'gu', 'kn', 'ml', 'mr', 'pa'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'mulaw', 'alaw'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'sonic-3-2026-01-12',
            displayName: 'Sonic 3 (2026-01-12)',
            description: 'Stable snapshot from January 12, 2026',
            languages: ['en', 'de', 'es', 'fr', 'ja', 'pt', 'zh', 'hi', 'ko', 'it', 'nl', 'pl', 'ru', 'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id', 'te', 'gu', 'kn', 'ml', 'mr', 'pa'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'mulaw', 'alaw'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
          {
            id: 'sonic-3-2025-10-27',
            displayName: 'Sonic 3 (2025-10-27)',
            description: 'Stable snapshot from October 27, 2025',
            languages: ['en', 'de', 'es', 'fr', 'ja', 'pt', 'zh', 'hi', 'ko', 'it', 'nl', 'pl', 'ru', 'sv', 'tr', 'tl', 'bg', 'ro', 'ar', 'cs', 'el', 'fi', 'hr', 'ms', 'sk', 'da', 'ta', 'uk', 'hu', 'no', 'vi', 'bn', 'th', 'he', 'ka', 'id', 'te', 'gu', 'kn', 'ml', 'mr', 'pa'],
            supportedAudioFormats: ['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'mulaw', 'alaw'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
        ],
        voices: [
          {
            id: "e07c00bc-4134-4eae-9ea4-1a55fb45746b",
            displayName: "Brooke - Big Sister",
            description: "Approachable adult female for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
            displayName: "Katie - Friendly Fixer",
            description: "Enunciating young adult female for conversational support use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
            displayName: "Jacqueline - Reassuring Agent",
            description: "Confident, young adult female for empathic customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f9836c6e-a0bd-460e-9d3c-f7299fa60f94",
            displayName: "Caroline - Southern Guide",
            description: "Friendly, inviting, slow young adult female for conversation support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5ee9feff-1265-424a-9d7f-8e4d431a12c7",
            displayName: "Ronald - Thinker",
            description: "Intense, deep young adult male for casual conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "a167e0f3-df7e-4d52-a9c3-f949145efdab",
            displayName: "Blake - Helpful Agent",
            description: "Energetic adult male for engaging customer support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "faf0731e-dfb9-4cfc-8119-259a79b27e12",
            displayName: "Riya - College Roommate",
            description: "Friendly woman for playful conversations",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "e8e5fffb-252c-436d-b842-8879b84445b6",
            displayName: "Cathy - Coworker",
            description: "Nice, young adult female for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "95d51f79-c397-46f9-b49a-23763d3eaa2d",
            displayName: "Arushi - Hinglish Speaker",
            description: "Hinglish female for bilingual content",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "79f8b5fb-2cc8-479a-80df-29f7a7cf1a3e",
            displayName: "Theo - Modern Narrator",
            description: "Steady, enunciating, confident young male for narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "15d0c2e2-8d29-44c3-be23-d585d5f154a1",
            displayName: "Pedro - Formal Speaker",
            description: "Formal and steady Mexican adult for clear and concise exchanges of information",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "2f251ac3-89a9-4a77-a452-704b474ccd01",
            displayName: "Lucy - Capable Coordinator",
            description: "Reassuring British female for customer assistance.",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "62ae83ad-4f6a-430b-af41-a9bede9286ca",
            displayName: "Gemma - Decisive Agent",
            description: "Polished, emotive British female for professional assistance",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a33f7a4c-100f-41cf-a1fd-5822e8fc253f",
            displayName: "Lauren - Lively Narrator",
            description: "Expressive female voice for narration, storytelling, and creative content",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a5136bf9-224c-4d76-b823-52bd5efcffcc",
            displayName: "Jameson - Easygoing Support",
            description: "Friendly, laid-back male voice for customer support and onboarding",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "bec003e2-3cb3-429c-8468-206a393c67ad",
            displayName: "Parvati - Friendly Supporter",
            description: "Friendly female for customer support use cases",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "1242fb95-7ddd-44ac-8a05-9e8a22a6137d",
            displayName: "Cindy - Receptionist",
            description: "Smooth, welcoming adult female for frontline customer interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b0689631-eee7-4a6c-bb86-195f1d267c2e",
            displayName: "Emilio - Friendly Optimist",
            description: "Upbeat voice with a friendly tone for positive customer service interactions",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "86e30c1d-714b-4074-a1f2-1cb6b552fb49",
            displayName: "Carson - Curious Conversationalist",
            description: "Friendly young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5c5ad5e7-1020-476b-8b91-fdcbe9cc313c",
            displayName: "Daniela - Relaxed Woman",
            description: "Calm and trusting Mexican accented female for natural conversations and efficient assistance",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "87286a8d-7ea7-4235-a41a-dd9fa6630feb",
            displayName: "Henry - Plainspoken Guy",
            description: "A relaxed, youthful male voice with a monotone, matter-of-fact attitude - ideal for casual, straightforward conversations.",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "b7187e84-fe22-4344-ba4a-bc013fcb533e",
            displayName: "Sebastian - Orator",
            description: "Warm male for audiobooks and clear communication",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "002622d8-19d0-4567-a16a-f99c7397c062",
            displayName: "Huda - Approachable Speaker",
            description: "Natural voice for clear, engaging conversations",
            gender: "female",
            languages: ["ar"]
          },
          {
            id: "fc923f89-1de5-4ddf-b93c-6da2ba63428a",
            displayName: "Nour - Engaging Speaker",
            description: "Smooth, expressive voice for engaging customer interactions",
            gender: "female",
            languages: ["ar"]
          },
          {
            id: "0ad65e7f-006c-47cf-bd31-52279d487913",
            displayName: "Rupert - Caring Dad",
            description: "Warm, mature voice for caring, reassuring conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "47c38ca4-5f35-497b-b1a3-415245fb35e1",
            displayName: "Daniel - Modern Assistant",
            description: "Clear, crisp male voice for digital assistants and system interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "38aabb6a-f52b-4fb0-a3d1-988518f4dc06",
            displayName: "Alina - Engaging Assistant",
            description: "Warm female for phone systems, virtual assistants, and customer service",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "304fdbd8-65e6-40d6-ab78-f9d18b9efdf9",
            displayName: "Jihyun - Anchorwoman",
            description: "Relaxing female for narrations and announcements",
            gender: "female",
            languages: ["ko"]
          },
          {
            id: "b9de4a89-2257-424b-94c2-db18ba68c81a",
            displayName: "Viktoria - Phone Conversationalist",
            description: "Clear and smooth female for phone conversations",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "0418348a-0ca2-4e90-9986-800fb8b3bbc0",
            displayName: "Antoine - Stern Man",
            description: "",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "2b568345-1d48-4047-b25f-7baccf842eb0",
            displayName: "Yumiko - Friendly Agent",
            description: "Friendly, professional and upbeat woman for casual conversations",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "e8a863c6-22c7-4671-86ca-91cacffc038d",
            displayName: "Daisuke - Businessman",
            description: "Business-like, clear male for professional use cases",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "af6beeea-d732-40b6-8292-73af0035b740",
            displayName: "Byungtae - Enforcer",
            description: "Authoritative male for providing instructions",
            gender: "male",
            languages: ["ko"]
          },
          {
            id: "b0f46533-d4bb-493f-a26f-a99e1f2e86e3",
            displayName: "Heitor - Easygoing Local",
            description: "Warm, relatable young adult male with a down-to-earth countryside charm",
            gender: "male",
            languages: ["pt"]
          },
          {
            id: "e361b786-2768-4308-9369-a09793d4dd73",
            displayName: "Paola - Expressive Performer",
            description: "Bold and lively voice for expressive performances and engaging content",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "ae823354-f9be-4aef-8543-f569644136b4",
            displayName: "Mariana - Nurturing Guide",
            description: "Motherly voice with a calm, nurturing tone",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "162e0f37-8504-474c-bb33-c606c01890dc",
            displayName: "Catalina - Neighborly Guide",
            description: "Natural, approachable for everyday conversations",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "ccfea4bf-b3f4-421e-87ed-dd05dae01431",
            displayName: "Alondra - Reassuring Sister",
            description: "Warm, friendly voice with a supportive, big-sister tone",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "791d5162-d5eb-40f0-8189-f19db44611d8",
            displayName: "Ayush - Friendly Neighbor",
            description: "Confident, young Indian male for delivering demos and instructions",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "56e35e2d-6eb6-4226-ab8b-9776515a7094",
            displayName: "Kavita - Customer Care Agent",
            description: "Mature Indian female for customer care use cases",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "f1cdfb4a-bf7d-4e83-916e-8f0802278315",
            displayName: "Walid - Steady Presence",
            description: "Warm, confident voice for clear, customer-facing conversations",
            gender: "male",
            languages: ["ar"]
          },
          {
            id: "ab636c8b-9960-4fb3-bb0c-b7b655fb9745",
            displayName: "Erwan - Everyday Speaker",
            description: "Clear voice for consistent, system-driven conversations",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "498e7f37-7fa3-4e2c-b8e2-8b6e9276f956",
            displayName: "Aiko - Calming Voice",
            description: "Calm and composed voice for clear, conversational interactions",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "02aeee94-c02b-456e-be7a-659672acf82d",
            displayName: "Benito - Digital Voice",
            description: "Consistent voice for clear, conversational exchanges",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "664aec8a-64a4-4437-8a0b-a61aa4f51fe6",
            displayName: "Hassan - Authoritative Narrator",
            description: "Strong, authoritative voice for instructions, narration, and news-style delivery",
            gender: "male",
            languages: ["ar"]
          },
          {
            id: "7e8cb11d-37af-476b-ab8f-25da99b18644",
            displayName: "Anuj - Engaging Narrator",
            description: "Expressive male voice for storytelling and conversational content",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "47f3bbb1-e98f-4e0c-92c5-5f0325e1e206",
            displayName: "Neha - Virtual Assistant",
            description: "Clear, composed female voice for virtual assistants and system prompts",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "6303e5fb-a0a7-48f9-bb1a-dd42c216dc5d",
            displayName: "Sagar - Helpful Friend",
            description: "Energetic adult male for engaging customer support and conversations",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "25d2c432-139c-4035-bfd6-9baaabcdd006",
            displayName: "Kavya - Warm Presence",
            description: "Friendly voice with natural tone and smooth flow, ideal for everyday conversations",
            gender: "female",
            languages: ["ta"]
          },
          {
            id: "b0aa4612-81d2-4df3-9730-3fc064754b1f",
            displayName: "Khalid - Bright Energy",
            description: "Voice with cheerful tone and expressive clarity, perfect for engaging advertisements and lively promotions",
            gender: "male",
            languages: ["ar"]
          },
          {
            id: "07bc462a-c644-49f1-baf7-82d5599131be",
            displayName: "Sindhu - Conversational Partner",
            description: "Clear and natural adult female voice for casual conversations and everyday interactions",
            gender: "female",
            languages: ["te"]
          },
          {
            id: "15628352-2ede-4f1b-89e6-ceda0c983fbc",
            displayName: "Jiwoo - Service Specialist",
            description: "Professional and polite adult female voice for customer service, support, and clear communication",
            gender: "female",
            languages: ["ko"]
          },
          {
            id: "59d4fd2f-f5eb-4410-8105-58db7661144f",
            displayName: "Yuki - Calm Woman",
            description: "Calm, more serious female for news narration and formal customer service",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "6a360542-a117-4ed5-9e09-e8bf9b05eabb",
            displayName: "Tiago - Narration Expert",
            description: "Calm, clear male for narrations",
            gender: "male",
            languages: ["pt"]
          },
          {
            id: "d4b44b9a-82bc-4b65-b456-763fce4c52f9",
            displayName: "Beatriz - Support Guide",
            description: "Friendly, natural female for engaging conversation",
            gender: "female",
            languages: ["pt"]
          },
          {
            id: "384b625b-da5d-49e8-a76d-a2855d4f31eb",
            displayName: "Thomas - Anchor",
            description: "Earnest male for conversations and customer support",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "700d1ee3-a641-4018-ba6e-899dcadc9e2b",
            displayName: "Luana - Public Speaker",
            description: "Pleasant, clear female for casual conversation",
            gender: "female",
            languages: ["pt"]
          },
          {
            id: "6ccbfb76-1fc6-48f7-b71d-91ac6298247b",
            displayName: "Tessa - Kind Companion",
            description: "Friendly female voice with a warm, conversational tone that feels like chatting with a close friend",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "228fca29-3a0a-435c-8728-5cb483251068",
            displayName: "Kiefer - Assured Tone",
            description: "Confident voice with strong clarity and composed delivery, ideal for presentations and customer interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "829ccd10-f8b3-43cd-b8a0-4aeaa81f3b30",
            displayName: "Linda - Conversational Guide",
            description: "Clear, confident mature female for conversational use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5cad89c9-d88a-4832-89fb-55f2f16d13d3",
            displayName: "Brandon - Confident Guy",
            description: "Confident voice with strong clarity and composed tone, perfect for persuasive and professional delivery",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ec1e269e-9ca0-402f-8a18-58e0e022355a",
            displayName: "Ariana - Kind Friend",
            description: "Friendly and approachable female voice with a warm, welcoming tone that builds instant connection",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "66c6b81c-ddb7-4892-bdd5-19b5a7be38e7",
            displayName: "Dorothy -  Easy Charm",
            description: "Casual female voice with a relaxed and natural tone, perfect for everyday conversations and relatable content",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a7b8d8fa-f6e5-4908-900e-0c11d1d82519",
            displayName: "Joanie - Vibrant Speaker",
            description: "Upbeat matured female voice with lively warmth and confidence, perfect for natural and engaging conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "999df508-4de5-40a7-8bd3-8c12f678c284",
            displayName: "Layla - Casual Friend",
            description: "Chill voice with a smooth, easygoing tone that feels relaxed and effortlessly cool",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "26403c37-80c1-4a1a-8692-540551ca2ae5",
            displayName: "Marian - Poised Narrator",
            description: "Matured female voice with calm authority and smooth pacing, perfect for narrations and storytelling",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "41468051-3a85-4b68-92ad-64add250d369",
            displayName: "Cory - Relaxed Voice",
            description: "Casual male voice with a friendly, easygoing tone that feels natural and approachable",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c961b81c-a935-4c17-bfb3-ba2239de8c2f",
            displayName: "Kyle - Approachable Friend",
            description: "Friendly male voice with a warm, conversational tone that builds instant connection and trust",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "694f9389-aac1-45b6-b726-9d9369183238",
            displayName: "Sarah - Mindful Woman",
            description: "Soothing female for meditations and calming conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "248be419-c632-4f23-adf1-5324ed7dbf1d",
            displayName: "Elizabeth - Manager",
            description: "Enunicating young female for providing guidance and instructions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "bf0a246a-8642-498a-9950-80c35e9276b5",
            displayName: "Sophie - Teacher",
            description: "Mature female for natural conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "57dcab65-68ac-45a6-8480-6c4c52ec1cd1",
            displayName: "Kira - Trusted Confidant",
            description: "Emotive, young adult female for empathetic conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "78ab82d5-25be-4f7d-82b3-7ad64e5b85b2",
            displayName: "Savannah - Magnolia Belle",
            description: "Adult female for casual, authentic conservations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "03496517-369a-4db1-8236-3d3ae459ddf7",
            displayName: "Calypso - ASMR Lady",
            description: "Soothing female for meditations and other calming use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b7d50908-b17c-442d-ad8d-810c63997ed9",
            displayName: "Sierra - California Girl",
            description: "Slow, chill young adult female for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "32b3f3c5-7171-46aa-abe7-b598964aa793",
            displayName: "Daisy - Reading Girl",
            description: "Very young female for children's book narrations and young animated personas",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "00a77add-48d5-4ef6-8157-71e5437b282d",
            displayName: "Callie - Encourager",
            description: "Smooth, young adult female for empathetic conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "4af7c703-f2a9-45dd-a7fd-724cf7efc371",
            displayName: "Lila - Meditation Guide",
            description: "Melodic female for gentle and empathetic conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "156fb8d2-335b-4950-9cb3-a2d33befec77",
            displayName: "Sunny - Pep Talker",
            description: "Upbeat female for engaging conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "8d8ce8c9-44a4-46c4-b10f-9a927b99a853",
            displayName: "Connie - Candid Conversationalist",
            description: "Natural, cheery young adult female for authentic conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c2ac25f9-ecc4-4f56-9095-651354df60c0",
            displayName: "Renee - Commander",
            description: "Firm adult female fit for broadcasts and narrations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5c42302c-194b-4d0c-ba1a-8cb485c84ab9",
            displayName: "Mary - Nurse",
            description: "Mature adult female for instructional videos and empathetic conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "28ca2041-5dda-42df-8123-f58ea9c3da00",
            displayName: "Palak - Presenter",
            description: "Friendly female with a slight English accent for teaching use cases",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "146485fd-8736-41c7-88a8-7cdd0da34d84",
            displayName: "Tim - Pal",
            description: "Nasal-y male for casual conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3b554273-4299-48b9-9aaf-eefd438e3941",
            displayName: "Simi - Support Specialist",
            description: "Firm, young accented female for customer support use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "71a7ad14-091c-4e8e-a314-022ece01c121",
            displayName: "Charlotte - Heiress",
            description: "Elegant, young adult female for narrations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a8a1eb38-5f15-4c1d-8722-7ac0f329727d",
            displayName: "Calm French Woman",
            description: "This voice is soft and calm, suited for soothing conversations in French",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "565510e8-6b45-45de-8758-13588fbaec73",
            displayName: "Ray - Conversationalist",
            description: "Approachable male voice with a laid-back, natural delivery for everyday conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "cefcb124-080b-4655-b31f-932f3ee743de",
            displayName: "Elena - Narrator",
            description: "Smooth and grounded female with a soft Castilian accent for podcasts and meditation",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "e3827ec5-697a-4b7c-9704-1a23041bbc51",
            displayName: "Dottie - Sweet Gal",
            description: "High pitched, earnest, very young female for character narrations for children",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "98a34ef2-2140-4c28-9c71-663dc4dd7022",
            displayName: "Clyde - Calm Narrator",
            description: "Gentle, measured male voice with warmth and clarity for storytelling and informative reads",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8f091740-3df1-4795-8bd9-dc62d88e5131",
            displayName: "Aurora - Fairy Princess",
            description: "Fairy like female for character use cases in entertainment",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1463a4e1-56a1-4b41-b257-728d56e93605",
            displayName: "Hugo - Teatime Friend",
            description: "Expressive, young adult male for characters and natural conversation",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ed81fd13-2016-4a49-8fe3-c0d2761695fc",
            displayName: "Zack - Sportsman",
            description: "Firm, energetic male for lively announcing",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "34575e71-908f-4ab6-ab54-b08c95d6597d",
            displayName: "Joey - Neighborhood Guy",
            description: "Casual, friendly male for natural conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "00967b2f-88a6-4a31-8153-110a92134b9f",
            displayName: "Asher - Podcaster",
            description: "Firm adult male for audiobooks and clear communication",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5abd2130-146a-41b1-bcdb-974ea8e19f56",
            displayName: "Jo - Go to Gal",
            description: "Young adult female for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "91b4cf29-5166-44eb-8054-30d40ecc8081",
            displayName: "Tina - Customer Ally",
            description: "Natural, firm adult female for authentic conversation and customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "729651dc-c6c3-4ee5-97fa-350da1f88600",
            displayName: "Jake - Sidekick",
            description: "Friendly, young adult male for welcoming and engaging conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f6ff7c0c-e396-40a9-a70b-f7607edb6937",
            displayName: "Emma - Customer Care Line",
            description: "Casual adult female for natural conversations and customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "11af83e2-23eb-452f-956e-7fee218ccb5c",
            displayName: "Ruth - Manager",
            description: "Firm, authoritative female for providing guidance",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "820a3788-2b37-4d21-847a-b65d8a68c99a",
            displayName: "Tyler - Friendly Salesman",
            description: "Direct and confidence inspiring adult male for sales and friendly interpersonal conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "a0e99841-438c-4a64-b679-ae501e7d6091",
            displayName: "Greg - Supporter",
            description: "Neutral, deep male for conversational support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c99d36f3-5ffd-4253-803a-535c1bc9c306",
            displayName: "Griffin - Narrator",
            description: "Elderly male for narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "e13cae5c-ec59-4f71-b0a6-266df3c9bb8e",
            displayName: "Lulu - Madame Mischief",
            description: "Squeaky, young female for media and entertainment for kids",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "9fa83ce3-c3a8-4523-accc-173904582ced",
            displayName: "Keith - Easygoing Friend",
            description: "Chill, young adult male for casual conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "d46abd1d-2d02-43e8-819f-51fb652c1c61",
            displayName: "Grant - Friendly Support",
            description: "Reliable, clear male voice with neutral American accent for customer support interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "6adbb439-0865-468c-9e68-adbb0eb2e71c",
            displayName: "Sally - Soft Spoken Guide",
            description: "Gentle female for calm conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a01c369f-6d2d-4185-bc20-b32c225eab70",
            displayName: "Fiona - Witty Woman",
            description: "Chirpy and energetic British female voice with a bright tone, great for lively and engaging conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "4ab1ff51-476d-42bb-8019-4d315f7c0c05",
            displayName: "Lena - Muse",
            description: "Cool German female for clear communication and audiobooks",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "e00dd3df-19e7-4cd4-827a-7ff6687b6954",
            displayName: "Lukas - Professional",
            description: "Confident male for phone systems and customer support",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "7ea5e9c2-b719-4dc3-b870-5ba5f14d31d8",
            displayName: "Janvi - Steady Agent",
            description: "Calm and neutral female voice with a slow, steady delivery, ideal for customer support scenarios",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "638efaaa-4d0c-442e-b701-3fae16aad012",
            displayName: "Sameer - Problem Solver",
            description: "Friendly male for customer support use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "65b25c5d-ff07-4687-a04c-da2f43ef6fa9",
            displayName: "Helpful French Lady",
            description: "This voice is helpful and cheery, like you're talking with a friend in French",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "f8f5f1b2-f02d-4d8e-a40d-fd850a487b3d",
            displayName: "Kiara - Joyful Woman",
            description: "Upbeat, enunciating Indian accented mature adult female for happy conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "d7e54830-4754-4b17-952c-bcdb7e80a2fb",
            displayName: "Mabel - Grandma",
            description: "Friendly, grandmotherly female for empathetic conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "e00d0e4c-a5c8-443f-a8a3-473eb9a62355",
            displayName: "Zeke - Friendly Sidekick",
            description: "High pitched, friendly, young adult male for gaming and entertainment characters",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "42b39f37-515f-4eee-8546-73e841679c1d",
            displayName: "James - Navigator",
            description: "Very deep, authoritative male for providing guidance and instruction",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "a38e4e85-e815-43ab-acf1-907c4688dd6c",
            displayName: "Lindsey - Relaxed Rep",
            description: "Happy adult female with a laidback affect for casual conversations and customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "41534e16-2966-4c6b-9670-111411def906",
            displayName: "Clarence - Newsman",
            description: "Firm, deep male with old time radio like acoustics for 20th century historical reenactments",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f31cc6a7-c1e8-4764-980c-60a361443dd1",
            displayName: "Olivia - Sunny Woman",
            description: "Friendly, happy adult female for engaging conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "21b81c14-f85b-436d-aff5-43f2e788ecf8",
            displayName: "Riley - Chill Friend",
            description: "Casual, young female for authentic and everyday conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1259b7e3-cb8a-43df-9446-30971a46b8b0",
            displayName: "Devansh - Warm Support Agent",
            description: "Warm, conversational Indian male adult voice for casual chats, everyday interactions, and friendly user engagement",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "9cebb910-d4b7-4a4a-85a4-12c79137724c",
            displayName: "Aarti - Conversationalist",
            description: "Indian accented female for relatable dialogue",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "4df027cb-2920-4a1f-8c34-f21529d5c3fe",
            displayName: "Carson - Friendly Support",
            description: "Friendly, young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "1fc31370-81b1-4588-9c1a-f93793c6e01d",
            displayName: "Carlo - Roman Guide",
            description: "Inviting, young accented male for tourism use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "87bc56aa-ab01-4baa-9071-77d497064686",
            displayName: "Jordan - Chill Pal",
            description: "Welcoming adult male for engaging conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f6141af3-5f94-418c-80ed-a45d450e7e2e",
            displayName: "Priya - Trusted Operator",
            description: "Authoritative, adult female for customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "8985388c-1332-4ce7-8d55-789628aa3df4",
            displayName: "Robyn - Storycrafter",
            description: "Neutral, mature female for narrations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "79743797-2087-422f-8dc7-86f9efca85f1",
            displayName: "Fran - Confident Young Professional",
            description: "Confident and engaging male for conversational AI and phone interactions",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "d718e944-b313-4998-b011-d1cc078d4ef3",
            displayName: "Liv - Casual Friend",
            description: "Casual female for natural conversations",
            gender: "female",
            languages: ["it"]
          },
          {
            id: "043cfc81-d69f-4bee-ae1e-7862cb358650",
            displayName: "Amelia - Instructor",
            description: "Strong, composed female voice suited for giving instructions with clarity and authority",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1d3ba41a-96e6-44ad-aabb-9817c56caa68",
            displayName: "Mia - Agent",
            description: "Firm, young female for customer support and casual, natural conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "82a7fc13-2927-4e42-9b8a-bb1f9e506521",
            displayName: "Tomek - Casual Companion",
            description: "Energetic male for casual conversations",
            gender: "male",
            languages: ["pl"]
          },
          {
            id: "c8605446-247c-4d39-acd4-8f4c28aa363c",
            displayName: "Edith - Matriarch",
            description: "Elderly, confident female for narrations and wise characters",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f114a467-c40a-4db8-964d-aaba89cd08fa",
            displayName: "Miles - Yogi",
            description: "Deep, soothing mature male for providing guidance",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "607167f6-9bf2-473c-accc-ac7b3b66b30b",
            displayName: "Brenda - Host",
            description: "Cheerful, friendly female voice that creates a positive, helpful experience for customer interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "064b17af-d36b-4bfb-b003-be07dba1b649",
            displayName: "Tatiana - Friendly Storyteller",
            description: "Friendly female for audiobooks and clear communication",
            gender: "female",
            languages: ["ru"]
          },
          {
            id: "cccc21e8-5bcf-4ff0-bc7f-be4e40afc544",
            displayName: "Avery - Gaming Girl",
            description: "High pitched, energetic young female for animated characters and gaming and entertainment use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c0c374aa-09be-42d9-9828-4d2d7df86962",
            displayName: "Isabel - Teacher",
            description: "Smooth and approachable female with a gentle Castilian accent for guidance and teaching",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "55deba52-bc73-4481-ab69-9c8831c8a7c3",
            displayName: "Camille - Friendly Expert",
            description: "Calm, neutral female for customer support and instructional videos",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "bd9120b6-7761-47a6-a446-77ca49132781",
            displayName: "Owen - Tutorial Man",
            description: "Elevated, mature adult male for providing guidance and instruction",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "701a96e1-7fdd-4a6c-a81e-a4a450403599",
            displayName: "Rowan - Team Leader",
            description: "Confident male for narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "1cf751f6-8749-43ab-98bd-230dd633abdb",
            displayName: "Ana Paula - Marketer",
            description: "Warm, friendly female for natural, informal dialogue",
            gender: "female",
            languages: ["pt"]
          },
          {
            id: "3f4ade23-6eb4-4279-ab05-6a144947c4d5",
            displayName: "Karin - Companion",
            description: "Friendly female for casual conversations",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "8832a0b5-47b2-4751-bb22-6a8e2149303d",
            displayName: "French Narrator Lady",
            description: "This voice is velvety and neutral, suited for narrating content in French",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "3e1ed423-17e5-4773-b87c-25b031106e41",
            displayName: "Paul - Straight Talker",
            description: "Deep and firm male voice with a relaxed, conversational delivery",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "2695b6b5-5543-4be1-96d9-3967fb5e7fec",
            displayName: "Agustin - Clear Storyteller",
            description: "Intentional, clear adult for concise reports or storytelling",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "996a8b96-4804-46f0-8e05-3fd4ef1a87cd",
            displayName: "Darla - Resolution Agent",
            description: "Firm and confident female voice with a calm, supportive tone - ideal for customer support roles",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "da4a4eff-3b7e-4846-8f70-f075ff61222c",
            displayName: "Callum - Brand Spokesperson",
            description: "Neutral, confident young adult male fit for voiceovers and customer interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "fb26447f-308b-471e-8b00-8e9f04284eb5",
            displayName: "Thistle - Troublemaker",
            description: "Cheery, expressive gender neutral character for whimsical personas in entertainment content",
            gender: "neutral",
            languages: ["en"]
          },
          {
            id: "bf991597-6c13-47e4-8411-91ec2de5c466",
            displayName: "Carol - Task Coach",
            description: "Authortative, mature female for giving instructions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5c3c89e5-535f-43ef-b14d-f8ffe148c1f0",
            displayName: "French Narrator Man",
            description: "This voice is even and rich, perfect for narrating content in French",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "ab7c61f5-3daa-47dd-a23b-4ac0aac5f5c3",
            displayName: "Friendly French Man",
            description: "This voice is friendly and calm, perfect for French customer support agents ",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "f91ab3e6-5071-4e15-b016-cde6f2bcd222",
            displayName: "Aadhya - Soother",
            description: "Slow female voice for casual conversation",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "23e9e50a-4ea2-447b-b589-df90dbb848a2",
            displayName: "Dallas - Fireside Friend",
            description: "Kind male for inviting and authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ee7ea9f8-c0c1-498c-9279-764d6b56d189",
            displayName: "Oliver - Customer Chap",
            description: "Polite, young adult male for customer facing use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "97f4b8fb-f2fe-444b-bb9a-c109783a857a",
            displayName: "Nathan - Easy Talker",
            description: "Confident, firm young adult male with a slight edge for conversational use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "afa425cf-5489-4a09-8a3f-d3cb1f82150d",
            displayName: "Nico - Friendly Agent",
            description: "Casual male for phone calls and conversational agents",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "0cd0cde2-3b93-42b5-bcb9-f214a591aa29",
            displayName: "Sayuri - Peppy Colleague",
            description: "Clear and bright female with a gentle tone of politeness and a naturally inquisitive cadence for dialogue, narration, or assistant-style roles",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "11c61307-4f9e-4db8-ac3b-bfa5f2a731ce",
            displayName: "Serafina - Serene Storyteller",
            description: "Deep female for calming conversations and storytelling narrations",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "4f7f1324-1853-48a6-b294-4e78e8036a83",
            displayName: "Casper - Gentle Narrator",
            description: "Wistful, young male for emotional narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "daf747c6-6bc2-4083-bd59-aa94dce23f5d",
            displayName: "Yasmin - Dialogue Anchor",
            description: "Firm adult female for conversational use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "db229dfe-f5de-4be4-91fd-7b077c158578",
            displayName: "Andreas - Recorder",
            description: "Smooth male for story narration",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "7cf0e2b1-8daf-4fe4-89ad-f6039398f359",
            displayName: "Benedict - Royal Narrator",
            description: "Confident, firm male for narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "87748186-23bb-4158-a1eb-332911b0b708",
            displayName: "Alaric - Wizard",
            description: "Wistful, wise, elderly male for entertainment and fun characters",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c9440d34-5641-427b-bbb7-80ef7462576d",
            displayName: "Joan - Messenger",
            description: "Young adult female for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1ade29fc-6b82-4607-9e70-361720139b12",
            displayName: "Lea - Breezy Voice",
            description: "Smooth female for casual conversations",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "5c9e800f-2a92-4720-969b-99c4ab8fbc87",
            displayName: "Ellen - Welcome Agent",
            description: "Authentic female voice with balanced warmth and clarity for both casual and support-driven contexts",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "13524ffb-a918-499a-ae97-c98c7c4408c4",
            displayName: "Barry - Helper",
            description: "Inviting, friendly male for customer support and product videos",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "7e19344f-9f17-47d7-a13a-4366ad06ebf3",
            displayName: "Silas - Nighttime Narrator",
            description: "Gentle and steady male voice with a nurturing tone for calm conversations and serene narration",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "fd2ada67-c2d9-4afe-b474-6386b87d8fc3",
            displayName: "Ishan - Ally",
            description: "Conversational male for Hinglish sales and customer support",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "3246e36c-ac8c-418d-83cd-4eaad5a3b887",
            displayName: "Carson - Sad Friendly Support",
            description: "Friendly young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "6d287143-8db3-434a-959c-df147192da27",
            displayName: "Stacy - Mentor",
            description: "Mature-sounding female voice with kindness and ease, perfect for natural interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "2a4d065a-ac91-4203-a015-eb3fc3ee3365",
            displayName: "Wes - Customer Companion",
            description: "Kind male for engaging with customers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "40104aff-a015-4da1-9912-af950fbec99e",
            displayName: "Travis - How To Guide",
            description: "Firm, young male for instructional videos and customer support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5063f45b-d9e0-4095-b056-8f3ee055d411",
            displayName: "Camilo - Supporter",
            description: "Soothing, warm male for feel good conversations",
            gender: "male",
            languages: ["pt"]
          },
          {
            id: "56b87df1-594d-4135-992c-1112bb504c59",
            displayName: "Lexi - Fun Friend",
            description: "Cheery, young female for entertainment, media, and gaming use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "d4db5fb9-f44b-4bd1-85fa-192e0f0d75f9",
            displayName: "Paloma - Clear Presenter Woman",
            description: "Clear and professional adult woman for reports, public speaking and customer assistance",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "b5aa8098-49ef-475d-89b0-c9262ecf33fd",
            displayName: "Luis - News Caster",
            description: "Clear and distinctive male with a refined Castilian accent for clear communication",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "50d6beb4-80ea-4802-8387-6c948fe84208",
            displayName: "Alfred - Cheeky Person",
            description: "Playful, elderly male for media and entertainment",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "0c8ed86e-6c64-40f0-b252-b773911de6bb",
            displayName: "Doris - Friend",
            description: "Warm and relatable female voice suited for casual, natural conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "63ff761f-c1e8-414b-b969-d1833d1c870c",
            displayName: "Malcom - Talk Show Host",
            description: "Lively and experienced male voice ideal for natural, engaging conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ab109683-f31f-40d7-b264-9ec3e26fb85e",
            displayName: "Russell - Mentor",
            description: "Friendly, deep mature adult male for providing instructions and guidance",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "be79f378-47fe-4f9c-b92b-f02cefa62ccf",
            displayName: "Sunil - Official Announcer",
            description: "Deep male for serious conversations",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "9b953e7b-86a8-42f0-b625-1434fb15392b",
            displayName: "Neeraj - Tour Guide",
            description: "Deep male for excellent storytelling and providing instructions",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "846fa30b-6e1a-49b9-b7df-6be47092a09a",
            displayName: "Pablo - Clear Storyteller",
            description: "Smooth and captivating male with a Castilian accent for conversational AI and interactions",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "41f3c367-e0a8-4a85-89e0-c27bae9c9b6d",
            displayName: "Liam - Guy Next Door",
            description: "Casual, friendly young male for authentic and engaging conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "b042270c-d46f-4d4f-8fb0-7dd7c5fe5615",
            displayName: "Hector - Tour Leader",
            description: "Energetic and captivating male with a bright Castilian accent for providing instructions",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "573e3144-a684-4e72-ac2b-9b2063a50b53",
            displayName: "Sylvia - Librarian",
            description: "Firm female for instructions and guidance",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "4ef93bb3-682a-46e6-b881-8e157b6b4388",
            displayName: "Wojciech - Documentarian",
            description: "Deep male for narrations and documentary media",
            gender: "male",
            languages: ["pl"]
          },
          {
            id: "c7eafe22-8b71-40cd-850b-c5a3bbd8f8d2",
            displayName: "Emi - Soft-Spoken Friend",
            description: "Soft and delicate female with a gentle, timid tone for female game characters and children's book narrations",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "c45bc5ec-dc68-4feb-8829-6e6b2748095d",
            displayName: "Trevor - Movieman",
            description: "Deep, elderly male for narrations and entertainment use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "7fe6faca-172f-4fd9-a193-25642b8fdb07",
            displayName: "Victor - Voiceover Man",
            description: "Versatile, engaging adult male for professional use cases, narrations, and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ec58877e-44ae-4581-9078-a04225d42bd4",
            displayName: "Charles - Heroic Man",
            description: "Very deep, adult male for characters that embody strength and determination",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "7a5d4663-88ae-47b7-808e-8f9b9ee4127b",
            displayName: "Hua - Sunny Support",
            description: "Upbeat, happy young adult woman for engaging conversations and conversational support",
            gender: "female",
            languages: ["zh"]
          },
          {
            id: "29e5f8b4-b953-4160-848f-40fae182235b",
            displayName: "Mimi - Show Stopper",
            description: "Cheery, young female for entertainment and content",
            gender: "female",
            languages: ["ko"]
          },
          {
            id: "a37639f0-2f0a-4de4-9942-875a187af878",
            displayName: "Felipe - Casual Talker",
            description: "Relaxed, conversational male for reassuring conversation",
            gender: "male",
            languages: ["pt"]
          },
          {
            id: "3dcaa773-fb1a-47f7-82a4-1bf756c4e1fb",
            displayName: "Harry - Service Advisor",
            description: "Seasoned male for friendly conversation and customer support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "726d5ae5-055f-4c3d-8355-d9677de68937",
            displayName: "Troy - Fix It Man",
            description: "Strong, dependable male voice designed for trust-building in customer-facing interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "96c64eb5-a945-448f-9710-980abe7a514c",
            displayName: "Carson - Friendly Support",
            description: "Friendly, young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "15a9cd88-84b0-4a8b-95f2-5d583b54c72e",
            displayName: "Claire - Storyteller",
            description: "Soothing, neutral female for narrations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "dcf62f33-7cff-4f20-85b2-2efaa68cbc32",
            displayName: "Zofia - Audiobook Muse",
            description: "Expressive female for clear communication",
            gender: "female",
            languages: ["pl"]
          },
          {
            id: "bdab08ad-4137-4548-b9db-6142854c7525",
            displayName: "Imran - Hindi Film Actor",
            description: "Bollywood male artist for serious roles",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "39b376fc-488e-4d0c-8b37-e00b72059fdd",
            displayName: "Sheldon - Help Desk Man",
            description: "Enunciating male for customer support use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f4e8781b-a420-4080-81cf-576331238efa",
            displayName: "Samantha - Support Leader",
            description: "Firm, confident adult female for conversational support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a8136a0c-9642-497a-882d-8d591bdcb2fa",
            displayName: "Diane - Service Assistant",
            description: "Firm, mature adult female for customer support use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "57b6bf63-c7a1-4ffc-8e10-23bf45152dd6",
            displayName: "Rebecca - Counselor",
            description: "Soft-spoken, empathetic female voice suited for thoughtful, calming dialogue",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "642014de-c0e3-4133-adc0-36b5309c23e6",
            displayName: "Irina - Poetic Voice",
            description: "Graceful female for narrations and audiobooks",
            gender: "female",
            languages: ["ru"]
          },
          {
            id: "5ef98b2a-68d2-4a35-ac52-632a2d288ea6",
            displayName: "Gabriel - Serious Old Man",
            description: "Serious, elderly Spanish man for slow and insightful stories",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "7360f116-6306-4e9a-b487-1235f35a0f21",
            displayName: "Marty - Commercial King",
            description: "Bold and enthusiastic male voice suited for energetic, attention-grabbing ads",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "bbee10a8-4f08-4c5c-8282-e69299115055",
            displayName: "Ben - Helpful Man",
            description: "slightly raspy voiced middle aged man for friendly and natural conversational support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "779673f3-895f-4935-b6b5-b031dc78b319",
            displayName: "Natalya - Soothing Guide",
            description: "Serene female for relaxing audio",
            gender: "female",
            languages: ["ru"]
          },
          {
            id: "5e10a334-7fa5-46d4-a64b-5ae6185da3fd",
            displayName: "Samantha - Sad Support Leader",
            description: "Firm, confident adult female for conversational support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "eda5bbff-1ff1-4886-8ef1-4e69a77640a0",
            displayName: "Kai - Commercial Man",
            description: "Deep, friendly adult male for commercials and advertising",
            gender: "male",
            languages: ["zh"]
          },
          {
            id: "0b32066b-2bcc-44b9-89ab-0223a09d1606",
            displayName: "Carson - Angry Friendly Support",
            description: "Friendly young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "761afc95-bef5-44dd-aa07-d3c678912e43",
            displayName: "Samantha - Happy Support Leader",
            description: "Firm, confident adult female for conversational support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c59c247b-6aa9-4ab6-91f9-9eabea7dc69e",
            displayName: "Tao - Lecturer",
            description: "Friendly young adult male for presentations and educational content",
            gender: "male",
            languages: ["zh"]
          },
          {
            id: "6a16c1f4-462b-44de-998d-ccdaa4125a0a",
            displayName: "Hidalgo - Anchorperson",
            description: "Lively, confident male for announcements",
            gender: "male",
            languages: ["pt"]
          },
          {
            id: "fa7bfcdc-603c-4bf1-a600-a371400d2f8c",
            displayName: "Leyla - Story Companion",
            description: "Expressive female for conversational support",
            gender: "female",
            languages: ["tr"]
          },
          {
            id: "575a5d29-1fdc-4d4e-9afa-5a9a71759864",
            displayName: "Katarzyna - Melodic Storyteller",
            description: "Melodic female for storytelling",
            gender: "female",
            languages: ["pl"]
          },
          {
            id: "e5923af7-a329-4e9b-b95a-5ace4a083535",
            displayName: "Lucio - Empath",
            description: "Charismatic and engaging male for expressive dialogue",
            gender: "male",
            languages: ["it"]
          },
          {
            id: "f9fc912e-52f0-448a-8bfa-47e9ca75f25a",
            displayName: "Marilyn - Explainer",
            description: "smooth and supportive young adult woman great for natural conversations and explaining",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "408daed0-c597-4c27-aae8-fa0497d644bf",
            displayName: "Matteo - Gentle Narrator",
            description: "Reassuring male for soothing dialogue",
            gender: "male",
            languages: ["it"]
          },
          {
            id: "bfd3644b-d561-4b1c-a01f-d9af98cb67c0",
            displayName: "Matt - Goofy Friend",
            description: "High pitched, silly male for fun characters and entertainment use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "2747b6cf-fa34-460c-97db-267566918881",
            displayName: "Allie - Natural Conversationalist",
            description: "Confident, approachable young adult woman for natural conversational support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "6b92f628-be90-497c-8f4c-3b035002df71",
            displayName: "Kenji - Calm Man",
            description: "Calm, deep male for news narration and formal customer service",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "8d110413-2f14-44a2-8203-2104db4340e9",
            displayName: "Darren - Friendly Barritone",
            description: "Deep, friendly adult male for happy voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f852eb8d-a177-48cd-bf63-7e4dcab61a36",
            displayName: "Ingrid - Peaceful Guide",
            description: "Serene female for relaxing narrations",
            gender: "female",
            languages: ["sv"]
          },
          {
            id: "af346552-54bf-4c2b-a4d4-9d2820f51b6c",
            displayName: "Valerie - Support Authority",
            description: "Authoritative mature female for frontline customer support use cases",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "e019ed7e-6079-4467-bc7f-b599a5dccf6f",
            displayName: "Luca - Everyday Friend",
            description: "Casual male for natural conversations",
            gender: "male",
            languages: ["it"]
          },
          {
            id: "06950fa3-534d-46b3-93bb-f852770ea0b5",
            displayName: "Takeshi - Hero",
            description: "Smooth, expressive male with a warm mid-range and dynamic emotional range for dramatic storytelling",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "5619d38c-cf51-4d8e-9575-48f61a280413",
            displayName: "Mark - Promotion Lead",
            description: "Deep, confident male voice with strong presence - ideal for commercials, promos, and broadcast narration",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "34d923aa-c3b5-4f21-aac7-2c1f12730d4b",
            displayName: "Griffin - Excited Narrator",
            description: "Elderly male for narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "bf32f849-7bc9-4b91-8c62-954588efcc30",
            displayName: "Lan - Instructor",
            description: "Firm, neutral adult woman for providing guidance and instruction",
            gender: "female",
            languages: ["zh"]
          },
          {
            id: "e90c6678-f0d3-4767-9883-5d0ecf5894a8",
            displayName: "Yue - Gentle Woman",
            description: "Kind adult female for empathetic conversations",
            gender: "female",
            languages: ["zh"]
          },
          {
            id: "79693aee-1207-4771-a01e-20c393c89e6f",
            displayName: "Marco - Friendly Conversationalist",
            description: "Friendly and professional male for conversational support",
            gender: "male",
            languages: ["it"]
          },
          {
            id: "7f423809-0011-4658-ba48-a411f5e516ba",
            displayName: "Ashwin - Warm Narrator",
            description: "Warm and authoritative Hindi male for narrating stories, audiobooks, and documentaries",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "64462aed-aafc-45d4-84cd-ecb4b3763a0a",
            displayName: "Shawn - Ad Reader",
            description: "Upbeat male for commercials, announcements, and promotions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5c43e078-5ba4-4e1f-9639-8d85a403f76a",
            displayName: "Carson - Scared Friendly Support",
            description: "Friendly young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "d609f27f-f1a4-410f-85bb-10037b4fba99",
            displayName: "Francesca - Elegant Partner",
            description: "Enunciating female for natural conversations",
            gender: "female",
            languages: ["it"]
          },
          {
            id: "653b9445-ae0c-4312-a3ce-375504cff31e",
            displayName: "Liu - Plain Talker",
            description: "Casual, neutral adult man for conversational support use cases",
            gender: "male",
            languages: ["zh"]
          },
          {
            id: "39f753ef-b0eb-41cd-aa53-2f3c284f948f",
            displayName: "Emre - Calming Speaker",
            description: "Soothing male for calming dialogue",
            gender: "male",
            languages: ["tr"]
          },
          {
            id: "bb2347fe-69e9-4810-873f-ffd759fe8420",
            displayName: "Aylin - Warm Guide",
            description: "Friendly female for narrations and explainer videos",
            gender: "female",
            languages: ["tr"]
          },
          {
            id: "0e21713a-5e9a-428a-bed4-90d410b87f13",
            displayName: "Alessandra - Melodic Guide",
            description: "Graceful female for providing instructions and guidance",
            gender: "female",
            languages: ["it"]
          },
          {
            id: "36b42fcb-60c5-4bec-b077-cb1a00a92ec6",
            displayName: "Gordon - Pilot",
            description: "Male, simulating the acoustics over an intercom, for entertainment use cases",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "6c6b05bf-ae5f-4013-82ab-7348e99ffdb2",
            displayName: "Freja - Nordic Reader",
            description: "Expressive female for clear communication",
            gender: "female",
            languages: ["sv"]
          },
          {
            id: "f9a4b3a6-b44b-469f-90e3-c8e19bd30e99",
            displayName: "Shuwen - Precision Guide",
            description: "Neutral, firm female for providing guidance and instruction",
            gender: "female",
            languages: ["zh"]
          },
          {
            id: "029c3c7a-b6d9-44f0-814b-200d849830ff",
            displayName: "Giancarlo - Support Leader",
            description: "Deep male for conversational support",
            gender: "male",
            languages: ["it"]
          },
          {
            id: "38a146c3-69d7-40ad-aada-76d5a2621758",
            displayName: "Anders - Nordic Baritone",
            description: "Deep male for historical narrations",
            gender: "male",
            languages: ["sv"]
          },
          {
            id: "9e8db62d-056f-47f3-b3b6-1b05767f9176",
            displayName: "Daan - Business Baritone",
            description: "Authoritative male for presentations",
            gender: "male",
            languages: ["nl"]
          },
          {
            id: "d7862948-75c3-4c7c-ae28-2959fe166f49",
            displayName: "Caspian - Oracle",
            description: "Echo-y, mystical male for characters with gravitas",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "4aa74047-d005-4463-ba2e-a0d9b261fb87",
            displayName: "Bram - Instructional Voice",
            description: "Clear male for tutorials and explainer videos",
            gender: "male",
            languages: ["nl"]
          },
          {
            id: "446f922f-c43a-4aad-9a8b-ad2af568e882",
            displayName: "Akira - Professional Colleague",
            description: "Clear and professional male for news announcements and business conversations",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "3d335974-4c4a-400a-84dc-ebf4b73aada6",
            displayName: "Piotr - Corporate Lead",
            description: "Confident male for providing instructions",
            gender: "male",
            languages: ["pl"]
          },
          {
            id: "9e7ef2cf-b69c-46ac-9e35-bbfd73ba82af",
            displayName: "Ren - High-Energy Character",
            description: "Bold and lively male with high energy for fictional characters, dynamic narration, and expressive dialogue",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "6a176356-ada1-4b48-b2ae-3a3fdd485680",
            displayName: "Elias - Night Warden",
            description: "Deep male for entertainment and gaming characters",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "586b6832-1ca1-43ad-b974-527dc13c2532",
            displayName: "Dorian - Director",
            description: "Welcoming male for providing instructions and guidance",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "66f5935b-af2e-4ec9-bb3e-59112e9ddc93",
            displayName: "Carson - Surprised Friendly Support",
            description: "Friendly young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "236bb1fb-dc41-4a2b-84d6-d22d2a2aaae1",
            displayName: "Franklin - Old Time Radio Host",
            description: "Elderly man speaking over a crackling 20th century radio for historical reenactments",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "0eb213fe-4658-45bc-9442-33a48b24b133",
            displayName: "Sanne - Clear Companion",
            description: "Cheerful female for engaging conversations",
            gender: "female",
            languages: ["nl"]
          },
          {
            id: "ee8b13e7-98af-4b15-89d1-8d402be10c94",
            displayName: "Carson - Disgusted Friendly Support",
            description: "Friendly young adult male for customer support conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "0b904166-a29f-4d2e-bb20-41ca302f98e9",
            displayName: "Fei - Broadcast Narrator",
            description: "Cheery, confident adult woman for narrations and announcements",
            gender: "female",
            languages: ["zh"]
          },
          {
            id: "af482421-80f4-4379-b00c-a118def29cde",
            displayName: "Lucas - Storyteller",
            description: "Enunciating male for storytelling",
            gender: "male",
            languages: ["nl"]
          },
          {
            id: "2a3503b2-b6b6-4534-a224-e8c0679cec4a",
            displayName: "Jakub - Gentle Guide",
            description: "Clear male for narrations",
            gender: "male",
            languages: ["pl"]
          },
          {
            id: "c1cfee3d-532d-47f8-8dd2-8e5b2b66bf1d",
            displayName: "Taylan - Expressive Voice",
            description: "Versatile articulate male for storytelling",
            gender: "male",
            languages: ["tr"]
          },
          {
            id: "a759ecc5-ac21-487e-88c7-288bdfe76999",
            displayName: "Daichi - Baritone Narrator",
            description: "Low pitched, intense male with a mysterious and brooding tone for villains, anti-heroes, and enigmatic characters",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "44863732-e415-4084-8ba1-deabe34ce3d2",
            displayName: "Kaori - Friendly Narrator",
            description: "Upbeat, positive, and gentle female for commercials and audiobooks",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "0caedb75-417f-4e36-9b64-c21354cb94c8",
            displayName: "Cees - Nordic Narrator",
            description: "Enunciating male for smooth conversations",
            gender: "male",
            languages: ["sv"]
          },
          {
            id: "97e7d7a9-dfaa-4758-a936-f5f844ac34cc",
            displayName: "Fuji - Positive Colleague",
            description: "Positive and gentle male for conversational settings",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "5a31e4fb-f823-4359-aa91-82c0ae9a991c",
            displayName: "Murat - Anatolian Storyteller",
            description: "Deep male for narrations and audiobooks",
            gender: "male",
            languages: ["tr"]
          },
          {
            id: "663afeec-d082-4ab5-827e-2e41bf73a25b",
            displayName: "Jaechul - Disciplined Woman",
            description: "Serious female for formal conversation",
            gender: "female",
            languages: ["ko"]
          },
          {
            id: "d3e03deb-5439-4203-add1-ca9a7501eaa7",
            displayName: "Samantha - Yelling Support Leader",
            description: "Firm, confident adult female for conversational support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "04bfd756-4fd4-42c2-9ccf-37f647c5bf54",
            displayName: "Samantha - Angry Support Leader",
            description: "Firm, confident adult female for conversational support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "7d7d769c-5ab1-4dd5-bb17-ec8d4b69d03d",
            displayName: "Eleanor - Composed Clarifier",
            description: "Clear, professional adult female for customer communication",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "2f4d204f-a5dc-4196-81bc-155986b76ab6",
            displayName: "Mirella - Upbeat Speaker",
            description: "Bright, youthful female voice for friendly, everyday dialogue",
            gender: "female",
            languages: ["pt"]
          },
          {
            id: "f4d6bb07-f876-4464-ba70-cd48d8701890",
            displayName: "Adriana - Bright Entertainer",
            description: "Bright, expressive voice for promotional and entertainment use",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "7c1ecd2d-1c83-4d5d-a25c-b3820a274a2e",
            displayName: "Jeronimo - Empathetic Advisor",
            description: "Friendly, emotionally aware voice for trust-based customer interactions",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "dbaa1a0d-e004-442d-866f-5431b18d8d54",
            displayName: "Guadalupe - Wise Storyteller",
            description: "Character-rich voice for storytelling and dramatic narration",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "c68a8bd0-f99e-4e7f-915d-a097da6d024c",
            displayName: "Juanita - Helpful Companion",
            description: "Friendly, reassuring voice for customer support and assistance",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "fd098a10-ba9e-445e-b144-be2a9f3dac02",
            displayName: "David - Angry Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "fb78f09f-f998-4061-ad51-d71f90388f0e",
            displayName: "Lori - Scared Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f96dc0b1-7900-4894-a339-81fb46d515a7",
            displayName: "Steve - Disgusted Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f80e7298-93f5-46d0-86f2-b8f29cfc88bd",
            displayName: "Claudia - Welcoming Lady",
            description: "Friendly, calm young adult female for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "cf14fdcd-24a0-4d63-958a-c784f33d8e7c",
            displayName: "Kenneth - Curious Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "cb605424-d682-48e9-94db-34cc567cf1c6",
            displayName: "Kenneth - Sad Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c4e848dc-d4fd-4bc8-90ea-8525563ec0e5",
            displayName: "David - Sad Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c2da2a3e-b0d6-46bf-a09a-68562617a50a",
            displayName: "Lori - Surprised Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c1c65fc2-528a-4dde-a2c4-f822785c2704",
            displayName: "Steve - Curious Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ba0add52-783c-4ec0-8b9c-7a6b60f99d1c",
            displayName: "Lori - Curious Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b1ce5126-4d08-42c3-adef-d3eb39e90c7a",
            displayName: "Steve - Scared Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "b08c966e-2146-4592-99eb-3171a714a43c",
            displayName: "David - Curious Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "adde00e9-c98f-42ae-a94d-fc9f92f11c76",
            displayName: "Steve - Happy Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "abe7dee1-6051-43d3-9a9f-1ac1312497a7",
            displayName: "Kenneth - Surprised Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "aa086107-101b-4182-a628-c51186d74166",
            displayName: "Kenneth - Angry Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "a5def41e-2e73-433f-92f7-5f1d99fef05d",
            displayName: "Madison - Surprised Best Friend",
            description: "Enthusiastic, young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a3a4fe2a-d402-41d1-be7d-28f71eda755f",
            displayName: "David - Scared Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "9d2b4a7f-7ced-4fb8-b570-9ce21fb931c8",
            displayName: "David - Disgusted Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "98c87826-dba2-44f4-b123-4c7e3c8a2647",
            displayName: "Madison - Curious Best Friend",
            description: "Enthusiastic, young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "911b8b22-887f-4caf-bf87-85d834c08708",
            displayName: "Kenneth - Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8e14933d-ecd7-402b-9505-795130d69b35",
            displayName: "Luke - Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8843adfb-77d3-455a-86f9-de0651555ec6",
            displayName: "Lori - Happy Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "876c39e1-9ecd-42cd-b0c1-8b3906f0be19",
            displayName: "Kenneth - Disgusted Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "83e45f18-fac4-40db-a43b-03257883b437",
            displayName: "Kenneth - Happy Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "80713a53-e484-4f69-9852-7891096016ac",
            displayName: "Steve - Sad Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "7c8ba972-4960-4c43-bea0-8178e2205696",
            displayName: "Steve - Angry Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "79b8126f-c5d9-4a73-8585-ba5e1a077ed6",
            displayName: "Luke - Disgusted Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "725d43d6-1196-480e-bd87-728ae5eff9e1",
            displayName: "Luke - Surprised Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "6fd4f468-0345-4f41-81d0-3f48ebc295e0",
            displayName: "Steve - Surprised Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "6b622a1d-906f-44af-b60c-7bef365bf124",
            displayName: "David - Happy Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "64875a07-f57e-4a70-b702-4e3fb25efeda",
            displayName: "Kenneth - Scared Friendly Rep",
            description: "Well-paced male voice with clear enunciation, great for approachable and informative conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "63426c82-a0c9-4f23-a175-50eb64c95ec1",
            displayName: "Luke - Scared Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "62305e79-9d39-4643-b003-5e0b096fe4f4",
            displayName: "Madison - Happy Best Friend",
            description: "Enthusiastic young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "61001bc6-9064-40a4-b8b2-29178e0fa558",
            displayName: "Luke - Angry Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5cc54223-ec0c-4c50-87e9-b9947264e1f4",
            displayName: "Lori - Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5c7b66c2-3b58-464d-8a12-093410a269c5",
            displayName: "Luke - Sad Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5993c2c9-5d59-403e-b459-946c8b302086",
            displayName: "Madison - Disgusted Best Friend",
            description: "Enthusiastic young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "414da90b-16b3-4e88-86f5-3c3945e8fa4b",
            displayName: "Lori - Disgusted Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3d79b1fd-daaa-439c-bff3-903dc18e7684",
            displayName: "Luke - Happy Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "30236d07-62d0-4c63-abf7-df46aa45e473",
            displayName: "Madison - Scared Best Friend",
            description: "Enthusiastic, young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "2d01710c-7c77-4cf1-b0d0-5902a25f6e17",
            displayName: "Lori - Sad Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "27c12970-3efb-4f39-a78a-2fbb7bddc941",
            displayName: "Madison - Sad Best Friend",
            description: "Enthusiastic young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "134838f5-ce7e-4876-ac32-6367b99daf83",
            displayName: "Madison - Best Friend",
            description: "Enthusiastic, young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "10d17ae0-8f64-472a-be00-f00a98c729e0",
            displayName: "David - Surprised Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "02fe5732-a072-4767-83e3-a91d41d274ca",
            displayName: "Madison - Best Friend",
            description: "Enthusiastic, young adult female for emotive discussions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "9fb269e7-70fe-4cbe-aa3f-28bdb67e3e84",
            displayName: "Steve - Baritone",
            description: "Deep, firm adult male for narrations and voiceovers",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "7b2c0a2e-3dd3-4a44-b16b-26ecd8134279",
            displayName: "Luke - Broadway Voice",
            description: "Seasoned male voice for casual, authentic conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "da69d796-4603-4419-8a95-293bfc5679eb",
            displayName: "David - Greeter",
            description: "Engaging adult male for advertising and upbeat conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "57c63422-d911-4666-815b-0c332e4d7d6a",
            displayName: "Lori - Cheerleader",
            description: "Female with clear enunciation for upbeat, emotive conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3faa81ae-d3d8-4ab1-9e44-e50e46d33c30",
            displayName: "Jasper - Service Specialist",
            description: "Warm, expressive voice for customer support and sales conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "4703c250-66e4-4682-a223-0a60acafcfc0",
            displayName: "Levi - Steady Spokesman",
            description: "Strong, confident voice for customer service, newscasting, and reliable narration",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "dda51133-5d43-4a3b-84e6-e68c13f60cba",
            displayName: "Lily - Casual Pal",
            description: "Relaxed, casual voice for friendly, everyday conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "20e68f5c-08e5-42d0-8e9b-6e716fd1ae66",
            displayName: "Vivek - Composed Voice",
            description: "Low-pitched, grounded male voice for formal communication",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "6b7468f5-d6b0-4d6b-b38a-46f6d6e5bac7",
            displayName: "Rakesh - Thoughtful Speaker",
            description: "Expressive male voice for informative narration and explanations",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "adf97b9d-905c-41de-9fe9-afb387116d06",
            displayName: "Vikas - Approachable Voice",
            description: "Polite, friendly male voice for customer support and service conversations",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "55e2a153-c61e-4784-85c8-e954cb22fe29",
            displayName: "Sanjay - Clear Speaker",
            description: "Formal male voice with clear pronunciation for professional narration and announcements",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "489b647b-5662-408f-8c95-82e26ef8d29e",
            displayName: "Kate - Practical Voice",
            description: "Direct, no-nonsense female voice for instructions and clear explanations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "58fbaf73-d7de-4e82-a6b3-118180e7057c",
            displayName: "Janet - Sunny Speaker",
            description: "Bright, warm female voice for guidance, narration, and supportive interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "2a17e905-8f14-4db7-9b9d-9223a8e3f278",
            displayName: "Jane - Digital Guide",
            description: "A crisp, modern voice with a friendly, intelligent tone — great for virtual-assistant tasks, guidance, and simple conversational prompts.",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3c7dfd17-3fa8-47aa-aacc-6313fe025442",
            displayName: "Evelyn - Digital Assistante",
            description: "A clear, neutral, and precise female voice with a smooth digital polish - perfect for virtual-assistant style responses, instructions, and general interactions.",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "39d518b7-fd0b-4676-9b8b-29d64ff31e12",
            displayName: "Aarav - Old Time Storyteller",
            description: "Warm adult male voice with a slight Indian accent and a vintage tone for nostalgic storytelling, retro-style media, and historical narration",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f6f315e4-4fb3-4440-92ea-2edb01f9bf1b",
            displayName: "Hermann - Businessman",
            description: "Warm, confident, and approachable voice, perfect for customer support and business conversations",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "bef2ba57-5c10-433b-b215-3bef35110a81",
            displayName: "Camila - Happy Conversationalist",
            description: "Lively voice for relaxed, casual conversations and light support.",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "2d693a9c-fc75-4313-aefb-c9cfaa17dd83",
            displayName: "Gerard - Monsieur Noir",
            description: "Deep, distinct middle-aged male voice for grounded narration and calm, authoritative guidance.",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "2f8e82c4-cb94-4e6d-8b6a-29bf58ceb60a",
            displayName: "Manon - Bright Belle",
            description: "Upbeat and inviting young female suited for lifestyle and brand narrations",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "c9115185-0086-4cf4-bfdd-0d36425db387",
            displayName: "Juliette",
            description: "Upbeat and inviting young female suited for lifestyle and brand narrations",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "63d6f469-8c2c-489d-b53f-d36f0bbdcd4b",
            displayName: "Ayako",
            description: "Friendly and calm adult female for providing instructions and conversational support",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "adff5dcb-249f-463f-aa89-d98d8ca05e88",
            displayName: "Leo",
            description: "High energy adult male great for motivational conversations",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "dd951538-c475-4bde-a3f7-9fd7b3e4d8f5",
            displayName: "Vanessa",
            description: "Firm adult female great for providing clear instructions",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "ac197a78-cec7-4c50-93e5-93bdc1910b11",
            displayName: "Jennifer",
            description: "Approachable adult female great for conversational support",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "42f14755-88c3-4124-aae3-5cc3a9618e8f",
            displayName: "Jan",
            description: "Clear adult male great for providing guidance and instruction",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "de07efe3-b309-418b-bdca-42827223efd2",
            displayName: "Rena",
            description: "Emotive, energetic young adult female great for engaging conversations ",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "3264ada2-4a79-4666-badc-49e2267be692",
            displayName: "Christian",
            description: "High energy adult male great for engaging and emotive conversations",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "80e11491-2d8a-4361-ac61-c4f3e0a4f7e7",
            displayName: "Vincent",
            description: "Energetic, engaging adult male great for exciting conversations",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "43a317e9-f1b9-45bf-bbdb-1d4a52e46f0d",
            displayName: "Emi",
            description: "Calm neutral adult female great for customer support",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "bfd5390b-e4f9-4e44-95ab-9ebd223acd62",
            displayName: "Pierre",
            description: "Professional, calm adult male great for workplace conversations",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "735287ee-ce91-4b08-8de4-63315c5ba1fb",
            displayName: "Emmanuelle",
            description: "Energetic, upbeat young adult female great for friendly conversations",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "4fb26a05-57de-4d21-855a-f51adae44f38",
            displayName: "Barry 2.0 - Helper",
            description: "Inviting, friendly male for customer support and product videos",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "fbf7d2ec-ebea-49f2-8889-a482b9b0a7ed",
            displayName: "Wade 2.0 - Southern Soul",
            description: "Country-sounding male voice with a warm drawl and genuine charm, perfect for friendly storytelling",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "935a9060-373c-49e4-b078-f4ea6326987a",
            displayName: "Linh - Soft Presence",
            description: "Voice with gentle tone and natural warmth, perfect for natural conversations and friendly dialogue",
            gender: "female",
            languages: ["vi"]
          },
          {
            id: "ebecd063-10f4-422e-a8ff-556ce5c4d4e4",
            displayName: "Pavan - Bright Voice",
            description: "Voice with energetic clarity and upbeat tone, ideal for customer support and engaging communication",
            gender: "male",
            languages: ["te"]
          },
          {
            id: "330c4fa0-1da3-4c55-8e97-951bfd724e20",
            displayName: "Sarika - Calm Spirit",
            description: "Voice with laidback tone and gentle rhythm, perfect for relaxed, friendly, and conversational dialogue",
            gender: "female",
            languages: ["te"]
          },
          {
            id: "374b80da-e622-4dfc-90f6-1eeb13d331c9",
            displayName: "Vijay - Comfort Voice",
            description: "Friendly and easygoing male voice for casual conversations and everyday support",
            gender: "male",
            languages: ["ml"]
          },
          {
            id: "1daba551-67af-465e-a189-f91495aa2347",
            displayName: "Yael - Casual Presence",
            description: "Voice with relaxed tone and friendly warmth, ideal for conversational dialogue and everyday narration",
            gender: "female",
            languages: ["he"]
          },
          {
            id: "9825cf5f-6aff-412a-80c5-bc58a8d55bc4",
            displayName: "Maryam - Friendly Voice",
            description: "Voice with warm, conversational tone and natural rhythm, ideal for approachable conversations",
            gender: "female",
            languages: ["ar"]
          },
          {
            id: "926e0766-f380-4d77-aeb0-9aa4ebb16b38",
            displayName: "Soren - Executive Voice",
            description: "Voice with confident, businesslike tone and clear precision, perfect for professional dialogue",
            gender: "male",
            languages: ["da"]
          },
          {
            id: "187d1cc5-a771-4ccd-9110-9df8c4e39499",
            displayName: "Mika - Empathetic Friend",
            description: "Friendly young adult female for emotive conversation",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "9436e723-612d-4114-aeb0-fa00d4d639bf",
            displayName: "Katsuya - Promo Host",
            description: "Lively confident male for advertising and announcing",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "49e02441-83ea-4c77-bda8-79fdd7f07e92",
            displayName: "Tohru - Career Coach",
            description: "Young professional male for providing guidance and instruction",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "6d912a43-805f-4673-bbc8-a9e6c45a6ad0",
            displayName: "Marie-Eve - Team Mentor",
            description: "Warm firm adult female for workplace conversations",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "ce74c4da-4aee-435d-bc6d-81d1a9367e12",
            displayName: "Marc - Conversational Buddy",
            description: "Friendly adult male for casual conversations",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "22f1a356-56c2-4428-bc91-2ab2e6d0c215",
            displayName: "Isabelle - Professional Liaison",
            description: "Formal adult female for professional conversations",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "68db3d29-e0ab-4d4f-a5d5-e34ee47d38b7",
            displayName: "Joris - Command Coach",
            description: "Deep voice with firm tone for providing instructions",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "537a82ae-4926-4bfb-9aec-aff0b80a12a5",
            displayName: "Minho - Friendly Spirit",
            description: "Laidback voice with a smooth, approachable tone that feels friendly and natural in conversation",
            gender: "male",
            languages: ["ko"]
          },
          {
            id: "1cb5b8bc-77c9-4e7c-a251-da02348e2727",
            displayName: "Sean - Steady Companion",
            description: "Casual voice with an easy, relaxed tone that feels natural and effortlessly approachable",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f24ae0b7-a3d2-4dd1-89df-959bdc4ab179",
            displayName: "Ross - Reliable Partner",
            description: "Steady voice with balanced tone and clear delivery, ideal for customer support and service",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "db69127a-dbaf-4fa9-b425-2fe67680c348",
            displayName: "Clint - Rugged Actor",
            description: "Raspy voice with rugged tone, perfect for voice acting and dramatic narration",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ca566b43-944e-4474-b494-7d9f0695f307",
            displayName: "Celine - Soothing Presence",
            description: "Relaxed voice with smooth tone and gentle warmth, ideal for calm conversations and easy listening",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "4d3d2e9c-14e4-4802-a8d8-bd5268a73fde",
            displayName: "Judith - Poised Strength",
            description: "Confident voice with clear articulation and composed tone, perfect for presentations and professional dialogue",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "8634bd27-0acf-4056-b014-4fea0385ed9e",
            displayName: "Suzanne - Laidback Aunt",
            description: "Matured voice with a natural, conversational tone that feels warm, relatable, and approachable",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5fb68a42-0ed7-46fa-8a8f-ad4b332fbf6f",
            displayName: "Edward - Persuasive Promoter",
            description: "Confident voice with clarity and persuasive tone, perfect for advertisements and promotional content",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "b56c6aac-f35f-46f7-9361-e8f078cec72e",
            displayName: "Tabitha - Smooth Energy",
            description: "Smooth voice with easy warmth and relaxed tone, perfect for casual conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f0377496-2708-4cc9-b2f8-1b7fdb5e1a2a",
            displayName: "Elaine - Confident Guide",
            description: "Assured voice with calm confidence and clear tone, ideal for professional, informative, or guiding narration",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b134c304-d095-4d2b-a77a-914f5e8e84e7",
            displayName: "Sterling - Monarch",
            description: "Deep voice with commanding presence and dignified tone, perfect for narrations and authoritative storytelling",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "74f42072-6245-4fe2-b5dc-3dc9b56fdbd0",
            displayName: "Regis - News Anchor",
            description: "Authoritative voice with polished clarity and balanced tone, perfect for news delivery and formal announcements",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "373e661a-f0ef-4e34-a09e-183184a443e6",
            displayName: "Tanner - Laidback Spirit",
            description: "Laidback voice with smooth tone and easy rhythm, great for conversational and approachable content",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "9301949d-b7cd-40d9-a246-5a4430992d6b",
            displayName: "Marcus - Reliable Guy",
            description: "Composed voice with approachable warmth, perfect for customer service and support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "e39b9fc0-23f5-4616-962a-da99c8ccb1dc",
            displayName: "Colin - Assured Guide",
            description: "Confident voice with clear articulation and reassuring tone, ideal for professional and customer service use",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "01fd7d67-d2a0-4e4e-8c48-42611c71a926",
            displayName: "Skyler - Laidback Partner",
            description: "Easygoing voice with effortless tone that feels natural and approachable",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "df872fcd-da17-4b01-a49f-a80d7aaee95e",
            displayName: "Cameron - Chill Companion",
            description: "Laidback voice with a natural, conversational tone that feels friendly and easy to engage with",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "0a9a5903-0a30-4d2e-b6b6-891f73d4b4e0",
            displayName: "Sabrina - Casual Ally",
            description: "Relaxed female voice with an easy, conversational tone that feels approachable and genuine",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f6ce3444-478b-4ce4-982e-bcb72dffe7aa",
            displayName: "Emily - Easygoing Pal",
            description: "Cheerful voice with warm and welcoming tone that feels natural and easy to connect with",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "0d2162c2-2fe9-40a7-b3c1-43eab576a64b",
            displayName: "Shelly - Warm Companion",
            description: "Friendly voice with a bright, approachable tone that feels natural and welcoming in any setting",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "cb6a8744-41b0-4cdc-b643-fabeb545c6a9",
            displayName: "Laurel - Caring Sister",
            description: "Warm voice with gentle empathy and clarity, perfect for heartfelt conversations and customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "6cb8801d-259a-4bdc-978f-b45808d58cd3",
            displayName: "Jeremy - Energetic Promoter",
            description: "High energy voice with clear and engaging tone, perfect for advertisements and promotions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "efa653e5-314d-46ca-9f90-70ac7d6ca71e",
            displayName: "Kurt - Phone Support",
            description: "Engaging male voice with expressive tone and natural warmth, ideal for customer service",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "afb19d1b-4044-4f34-a962-f4aef640a002",
            displayName: "Zander - Energetic Announcer",
            description: "Enthusiastic voice with energetic delivery and bold tone, perfect for advertisements and high-energy narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "e4d5f4c4-6601-4779-bee1-b3c14d629dc6",
            displayName: "Jillian - Happy Spirit",
            description: "Cheerful voice with lively warmth and friendly tone, perfect for upbeat conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c58bda25-abd5-4c72-97a2-4dbe049b368d",
            displayName: "Garrett - Enthusiastic Pal",
            description: "Upbeat voice with bright energy and confident tone, perfect for lively conversations and engaging content",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f688c0a6-dddd-48ba-8246-c099d494a162",
            displayName: "Romeo - Calm Narrator",
            description: "Relaxing voice with smooth depth and calm pacing, perfect for storytelling and immersive narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3d9b50f9-10c5-4026-9ae1-c4a698f67fc5",
            displayName: "Marjorie - Encouraging Aunt",
            description: "Encouraging matured voice with warm reassurance and steady tone, perfect for motivational and supportive messages",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a924b0e6-9253-4711-8fc3-5cb8e0188c94",
            displayName: "Noah - Calming Presence",
            description: "Slow-paced voice with gentle warmth and soothing tone, perfect for ASMR and relaxation content",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "eb649460-7e23-43bc-ad20-0a7a2749b938",
            displayName: "Kim - Cheerful Pal",
            description: "Friendly voice with a smooth, easygoing tone",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1f575487-6f3d-40e0-862a-814f55b5fb15",
            displayName: "Ariane - Captivating Tone",
            description: "Engaging voice with expressive warmth and clarity, perfect for drawing listeners into any conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "050f5a7a-9d2b-4b76-84e3-2d056a0a3eb0",
            displayName: "Kelsey - Ball of energy",
            description: "Upbeat voice with lively energy and friendly warmth, perfect for energetic and engaging conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "6fbca103-0f7f-4e49-97ed-49a53b4f3534",
            displayName: "Maxine - Relaxed Energy",
            description: "Smooth voice with a calm, laid-back tone that brings an easy sense of comfort to any conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "87041166-c212-4838-9028-05d7437df750",
            displayName: "Aubrey - Easygoing Pal",
            description: "Warm voice with a relaxed, natural tone that feels friendly and effortlessly relatable",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "6fccb471-26f7-4f7a-93dd-542935db6c20",
            displayName: "Wesley - Chill Flow",
            description: "Casual voice with a relaxed, friendly tone that feels natural and easy to listen to",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "9329fbdb-e285-4fba-95ec-592e15f14476",
            displayName: "Rory - Maternal Vibe",
            description: "Motherlike female voice with a calm, nurturing tone that brings warmth and reassurance to any conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "eef47c0d-cb49-4160-a4a0-6b97ed4c81e6",
            displayName: "Isla - Serene Flow",
            description: "Calm voice with gentle warmth and steady rhythm, perfect for yoga, meditation, and relaxation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "69092565-1c93-4a88-9f2c-ac8cddaf9f65",
            displayName: "Janice - Engaging Tone",
            description: "Engaging voice with a casual, friendly tone that draws listeners in and keeps conversations lively",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "17488b72-f815-44d8-bdd9-869971c3ec06",
            displayName: "Steven - Big Brother",
            description: "Conversational voice with a relaxed, natural tone that feels genuine and easy to engage with",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "d6b0c62a-c7ff-477c-9a1f-eadd64b94360",
            displayName: "Melina - Bright Spirit",
            description: "Outgoing voice with lively warmth and friendly tone, perfect for casual chats and everyday conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "59697755-8cfb-4ccf-9da4-f2201d06b067",
            displayName: "Dominic - Sportscaster",
            description: "Strong voice with commanding projection and energetic tone, perfect for sports commentary and live announcements",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "80c81aee-b6ad-4d12-9af8-a9c79c2e141d",
            displayName: "Aina - Meditation Guru",
            description: "Calm voice with soothing balance and gentle rhythm, ideal for meditation, mindfulness, and relaxation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "ca31ce53-ebf6-4e51-b87d-2f65d5d1f7f8",
            displayName: "Vivian - Fierce Narrator",
            description: "Voice with rich emotion and expressive depth, perfect for dramatic readings and heartfelt narratio",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "aef96ff9-4578-4b5d-9744-7fb347cbe4d4",
            displayName: "Holly - Joyful Presence",
            description: "Cheerful voice with bright warmth and friendly energy, perfect for engaging conversations and upbeat content",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b58b6b46-1a27-46ba-8648-bc203a5d394e",
            displayName: "Mason - Calm Vibe",
            description: "Chill voice with a smooth, conversational tone that feels relaxed and genuine",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3bf35adc-bcc4-464b-b834-c90c88cf6492",
            displayName: "Spencer - Chill Gentleman",
            description: "Casual voice with an engaging, upbeat tone that feels friendly and effortlessly conversational",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "9c8880b2-ccf9-4730-b805-cea23df247d7",
            displayName: "Conrad - Seasoned Support",
            description: "Mature, confident voice with composed authority and clear tone, perfect for professional or narrative use",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "5cf0e4d9-ca2b-4fd5-81fa-89db3b645539",
            displayName: "Derrick - Professional Man",
            description: "No-nonsense voice with steady confidence and clear tone, ideal for customer service and tech support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c0f43c66-9f21-4034-b485-8f1d3340d759",
            displayName: "Clarkson - Executive Tone",
            description: "Businesslike voice with confident tone and professional delivery, perfect for corporate and formal settings",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "643f5eee-459d-4b41-b4fc-0b8407139be6",
            displayName: "Vicky - Businesswoman",
            description: "Clear and crisp voice with precise delivery and bright tone, ideal for professional and instructional content",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "dcc82bcd-647e-4478-955f-8232d5122f8b",
            displayName: "Melanie - Lively Spirit",
            description: "Enthusiastic voice with bright, engaging energy that brings excitement to any conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "045f0292-0731-4a4c-971d-64594fc2c35a",
            displayName: "Quinn - Calm Authority",
            description: "Confident voice with clear articulation and poised tone, perfect for presentations and customer interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "2948c301-9211-4112-8f36-4c3fc836ef12",
            displayName: "Bryce - Clear Explainer",
            description: "Confident voice with clear enunciation and strong delivery, ideal for professional and instructional use",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "49808e4c-998a-40a8-b2ea-8ac8e8ce779e",
            displayName: "Marvin - Steady Ally",
            description: "Deep, comforting voice with calm authority and warmth, perfect for reassuring and professional customer service",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "86600680-b836-41e1-9916-8475728dcc14",
            displayName: "Tiffany - Dynamic Presence",
            description: "Engaging voice with lively clarity and confident warmth, ideal for keeping listeners interested and connected",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "7a8ae0b6-504a-49af-92d3-4e7e2eb84ca1",
            displayName: "Eliott - Positive Spirit",
            description: "Approachable and cheerful voice with bright warmth that instantly connects and uplifts listeners",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "b5c1bab5-f036-481f-9295-4db6f06f6443",
            displayName: "Jamie - Comforting Presence",
            description: "Casual voice with a warm, friendly tone that feels like chatting with a close friend",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "cd6256ef-2b2a-41f6-a8d8-c1307af5061f",
            displayName: "Preston - Relatable Pal",
            description: "Confident voice with expressive tone and charismatic delivery, great for engaging conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3ccc4544-84f7-45e3-ae57-5c52b5a1fac6",
            displayName: "Aiden - Yogi",
            description: "Soothing voice with calm depth and gentle pacing, perfect for peaceful narrations and relaxation content",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "4b1e0bf9-53a0-4e9e-8664-ba1314dbcb38",
            displayName: "Kelly - Friendly Spirit",
            description: "Casual voice with a friendly, natural tone that feels easygoing and approachable",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "e5a6cd18-d552-4192-9533-82a08cac8f23",
            displayName: "Patricia - Veteran Support",
            description: "Matured voice with lively warmth and enthusiasm, perfect for engaging and energetic customer service",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "ea93f57f-7c71-4d79-aeaa-0a39b150f6ca",
            displayName: "Diana - Gentle Mom",
            description: "Matured voice with a casual, friendly tone that feels warm, relatable, and easy to connect with",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "18f8d87b-0da9-4efa-b504-4580e303f7db",
            displayName: "Colby - Lively Guy",
            description: "Casual voice with an engaging, upbeat tone that brings energy and friendliness to any conversation",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "fdf6303b-4cfa-4f8e-b7ae-acb398984cf9",
            displayName: "Harley - Comforting Voice",
            description: "Casual voice with a relaxed, natural tone that feels approachable and genuine",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "ea7c252f-6cb1-45f5-8be9-b4f6ac282242",
            displayName: "Logan - Approachable Friend",
            description: "Casual voice with an easy, conversational tone that feels natural and approachable",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "63927f41-9616-4ac2-89cf-f3afa346e0ef",
            displayName: "Selene - Soothing Aura",
            description: "Relaxing and calm voice with gentle flow and serene tone, ideal for meditation and mindfulness content",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3308b492-50cc-417e-89dd-1f446c574546",
            displayName: "Tara - Confident Ally",
            description: "Confident voice with clear, composed tone, perfect for professional and customer service settings",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "320f7211-3dc3-4292-89b1-3661e8cac27c",
            displayName: "Evelyn - Peaceful Whisper",
            description: "Calm voice with soft warmth and gentle pacing, ideal for soothing narrations and ASMR",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "a2364c9d-1fe3-4553-9eff-100c4fe5ffc8",
            displayName: "Marge - Seasoned Grace",
            description: "Wise matured voice with expressive warmth and character, perfect for storytelling and entertainment",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "2d5b8c3a-116c-4741-acaf-ba4fa289eba2",
            displayName: "Benji - Joyful Spirit",
            description: "Excited and cheerful voice with bright energy and lively tone, perfect for upbeat chats and engaging content",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "48369ca9-0645-40de-9821-0d55e18a03c2",
            displayName: "Zoey - Bright Voice",
            description: "Upbeat female voice with lively energy and warmth, perfect for energetic and engaging conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f7755efb-1848-4321-aa22-5e5be5d32486",
            displayName: "Ryeowook - Easygoing Pal",
            description: "Relaxed voice with calm, natural pacing, ideal for easygoing everyday conversations",
            gender: "male",
            languages: ["ko"]
          },
          {
            id: "cd6c48a9-774b-4397-98b4-9948c0a790f0",
            displayName: "Soojin - Helpful Tone",
            description: "Casual voice with a natural, friendly tone that feels relaxed and approachable in conversation",
            gender: "female",
            languages: ["ko"]
          },
          {
            id: "cac92886-4b7c-4bc1-a524-e0f79c0381be",
            displayName: "Yuna - Kind Unnie",
            description: "Cheerful voice with a bright yet gentle tone, perfect for empathetic and friendly customer support",
            gender: "female",
            languages: ["ko"]
          },
          {
            id: "356f4a89-d056-4e2e-8c73-865fa4d3af0a",
            displayName: "Chandler - Easygoing Pal",
            description: "Casual male voice with a warm, natural tone that feels friendly and effortlessly relatable",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "d6905573-8e91-4e32-b103-fd4d1205cd87",
            displayName: "Mindy - Spirited Ally",
            description: "Enthusiastic female voice with bright energy and cheerful tone, great for lively conversations and upbeat content",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "23112795-d54e-4560-9568-791a87c30201",
            displayName: "Darius - Engaging Narrator",
            description: "Husky matured male voice with rich texture and commanding tone, ideal for engaging story telling and narrations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "1ac31ebd-9113-405b-9d80-4a4bbbeea91c",
            displayName: "Kayla - Easygoing Pal",
            description: "Casual female voice with a friendly, natural tone that feels effortless and engaging in conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1628cfcd-a161-4e47-98ff-46bffa4ab290",
            displayName: "Graham - Assured Helper",
            description: "Confident male voice with a clear, reassuring tone, perfect for professional and customer service interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "a892d232-f705-40d7-bc8d-e368b295ec2a",
            displayName: "Harlan - Vintage Tone",
            description: "Deep male voice with classic resonance and smooth authority, reminiscent of an old radio announcer",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3d83e30f-c31b-4f26-b442-7075feafa53a",
            displayName: "Wade - Southern Soul",
            description: "Country-sounding male voice with a warm drawl and genuine charm, perfect for friendly storytelling",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "87a983d8-3471-4c4b-9ade-f1d10a4110ac",
            displayName: "Devin - Relaxed Spirit",
            description: "Laidback male voice with a smooth, easygoing tone that feels relaxed and effortlessly cool.",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3f38cbe2-ce6a-4051-b5dc-2b2ee20b9bc1",
            displayName: "Sasha - Cool Friend",
            description: "Chill female voice with a smooth, laid-back tone that brings ease and calm to any conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b2222537-1561-4425-8c3c-e1aca96ad853",
            displayName: "Dylan - Chill Companion",
            description: "Casual male voice with an easy, conversational tone that feels friendly and down-to-earth",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8cbfe3ab-8364-4e72-b606-93f749519c66",
            displayName: "Shane - Helpful Guide",
            description: "Casual male voice with clear, steady delivery that makes troubleshooting steps easy to follow and understand",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "d2c66146-c1c8-4c3a-9870-38e5a6b72442",
            displayName: "Lawson - Suave Storyteller",
            description: "Charming matured male voice with smooth delivery and refined tone, perfect for narrations and advertisements",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "083de431-6b5c-4b18-a2dc-264eafa205f2",
            displayName: "Diana - Animated Narrator",
            description: "Chirpy matured female voice with expressive warmth and lively cadence, perfect for engaging storytelling",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "cec7cae1-ac8b-4a59-9eac-ec48366f37ae",
            displayName: "Haley - Engaging Friend",
            description: "Casual female voice with a relaxed, friendly tone that feels natural and easy to engage with",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "5319c0b1-3dd1-4c00-b721-bfd2ec88ef56",
            displayName: "Julian - Vibrant Voice",
            description: "Friendly and cheerful male voice with uplifting warmth, great for feel-good narrations and advertisements",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f4a3a8e4-694c-4c45-9ca0-27caf97901b5",
            displayName: "Gavin - Friendly Vibe",
            description: "Casual male voice with a relaxed, conversational tone that feels approachable and genuine",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8a1b8af0-c4f6-423f-a268-5507fd4aefdf",
            displayName: "Denise - Professional Woman",
            description: "Professional female voice with confident clarity and polished tone, ideal for corporate and business settings",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "ed82c17b-4704-4d34-be43-5d19065acdf1",
            displayName: "Carl - Steady Storyteller",
            description: "Matured male voice with calm depth and measured pacing, perfect for narrations and documentaries",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "bbc5d060-50e1-45a3-87ff-191b8cea3092",
            displayName: "Jett - Helpful Pal",
            description: "Casual male voice with an easygoing rhythm and friendly tone that feels natural and relatable",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "19e399df-5b30-4fba-9d1d-99434f993614",
            displayName: "Edna - Graceful Veteran",
            description: "Matured female voice with gentle wisdom and poise, perfect for thoughtful narration and reflective dialogue",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "b9cf5ec3-eaa4-46a5-a5b2-b0d0f22395a2",
            displayName: "Caleb - Seasoned Pro",
            description: "Confident male voice with authoritative clarity, perfect for delivering expert insights and professional guidance",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "4c2dcd38-5608-45ca-8f11-51c88208d01c",
            displayName: "Orin - Velvet Gentleman",
            description: "Deep, silky male voice that delivers authority and allure, perfect for impactful ads and promos",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "90c896fa-aaa1-41af-a612-5267636440a3",
            displayName: "Dean - Laidback Pal",
            description: "Casual male voice with a relaxed, natural tone that feels easy to listen to and effortlessly genuine",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "efc5488b-5429-4e72-aaa2-570981cf47d9",
            displayName: "Lacey - Sunny Soul",
            description: "Cheerful and friendly female voice with bright energy that uplifts and engages listeners instantly",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "cc00e582-ed66-4004-8336-0175b85c85f6",
            displayName: "Dana - Balanced Spirit",
            description: "Neutral female voice with clear articulation and calm tone, ideal for versatile conversational or professional use",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3af40927-948e-429b-b92d-e2158f79fb9f",
            displayName: "Cera - Lighthearted Muse",
            description: "Casual female voice with an easy, conversational flow that feels natural and friendly",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "d709a7e8-9495-4247-aef0-01b3207d11bf",
            displayName: "Donny - Steady Presence",
            description: "Neutral male voice with balanced tone and clarity, adaptable for a wide range of casual speaking contexts",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "64b2a604-f0de-449f-9d90-255602357c05",
            displayName: "Elise - Helpful Voice",
            description: "Casual female voice with a smooth, approachable tone that feels effortless and natural in conversation",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c7c790c5-2bf4-47e4-bc83-5f43e61f3803",
            displayName: "Reese - Warm Companion",
            description: "Casual, friendly female voice with a bright and welcoming tone suited for everyday conversations.",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "1ce291a1-0771-4732-a3f7-8cca29bf055f",
            displayName: "Ralph - Dynamic Commentator",
            description: "Matured male voice with powerful projection and crisp delivery, perfect for announcements and sports commentary",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "dbfa416f-d5c3-4006-854b-235ef6bdf4fd",
            displayName: "Damon - Commanding Narrator",
            description: "Deep and serious male voice with steady gravitas, ideal for documentaries and impactful storytelling",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "6776173b-fd72-460d-89b3-d85812ee518d",
            displayName: "Jace - Cool Conversationalist",
            description: "Friendly and chill male voice with an easygoing tone that feels relaxed and natural",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "921034a2-aace-4ef7-87b1-b9bc455c9a15",
            displayName: "Edric - Refined Mentor",
            description: "Matured male voice with steady pacing and clear intonation, delivering messages with poise and clarity",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c78dd7ae-6692-4c44-a2a2-834e365afe60",
            displayName: "Clark - Trustworthy Expert",
            description: "Approachable male voice with a confident, knowledgeable tone ideal for customer service and support",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "0834f3df-e650-4766-a20c-5a93a43aa6e3",
            displayName: "Leo - Genuine Companion",
            description: "Friendly and approachable male voice that brings warmth and ease to any interaction",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "4cf80313-54dc-4ca9-a17c-3e5b8f68a78c",
            displayName: "Hugh - Confident Veteran",
            description: "Seasoned male voice with rich character and charisma, great for lively ads and engaging conversations",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8d7d11ff-d985-48a2-a737-1da0b6fedc8b",
            displayName: "Ronan - Warm Buddy",
            description: "Friendly male voice with an easygoing tone that feels natural and inviting in any context",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "3f04e815-3260-4f50-8fd9-af9c657be4c2",
            displayName: "Arvin - Reliable Guide",
            description: "Clear, steady male voice that communicates instructions and troubleshooting steps with confidence and ease",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f4c1a0b2-669d-403f-b440-4b34b34856aa",
            displayName: "Nora - Calm Companion",
            description: "Balanced, neutral female voice that sounds natural and approachable for everyday conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "cbaf8084-f009-4838-a096-07ee2e6612b1",
            displayName: "Maya - Easygoing Ally",
            description: "Friendly, casual female voice with clear articulation, ideal for natural conversations and customer support",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "c1b9a03e-747f-40ad-8e7b-18caf8aaac0b",
            displayName: "Lira - Tranquil Voice",
            description: "Soothing female voice with gentle warmth, ideal for calm narrations and ASMR",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "758a5cff-af0b-4bdf-84bd-4c1b5525c249",
            displayName: "Leander",
            description: "Warm and approachable voice, ideal for lifestyle content, social media, and casual explainers.",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "b629d743-2b5a-4ffd-b5bb-9de9b969a690",
            displayName: "Sibylle",
            description: "Clear and confident voice, ideal for announcements and customer support",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "dff81230-ff75-49a4-af44-f6b2f43500d8",
            displayName: "Jonas",
            description: "Casual male voice thats warm, friendly, and conversational",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "30212483-5c20-479c-8121-f93cd24e30a6",
            displayName: "Camila",
            description: "Lively voice for relaxed, casual conversations and light support.",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "9ebc775b-c579-4c31-b37c-2306cbe9cc91",
            displayName: "Carlos",
            description: "Warm, lively young adult male voice for expressive narrations and upbeat advertising.",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "d42fc8d7-efdd-44df-bb2e-a6e093601917",
            displayName: "Oskar - Steady Advisor",
            description: "Seasoned and composed voice with a calm and confident tone, ideal for guidance and thoughtful narration",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "d3793b7b-4996-409c-9d59-96dd09f47717",
            displayName: "Renata - Cheerful Conversationalist",
            description: "Lively and upbeat matured voice, ideal for ads and narrations",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "24c61c42-b538-468e-a9ad-16c7a032c9cb",
            displayName: "Klaus - Archivist",
            description: "Deep, grounded male voice for narration, storytelling, and impactful brand content.",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "adc919b3-6ebf-47fd-8a46-27c5169d6d94",
            displayName: "Leni - Daymaker",
            description: "Bright, cheerful voice with clear articulation and natural enthusiasm, ideal for upbeat narration, onboarding, and lifestyle content.",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "0b66a153-548f-4f2c-b734-09a13b0bd163",
            displayName: "Lorelei - Helpful Guide",
            description: "Calm and clearly enunciated voice, ideal for informative narration, mindfulness, and instructional content.",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "7b001dff-b8b2-4da7-92e4-5c794798effa",
            displayName: "Jorge - Regular Guy",
            description: "Seasoned, relaxed voice with a warm tone, ideal for casual narration and conversational support.",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "3a35daa1-ba81-451c-9b21-59332e9db2f3",
            displayName: "Alejandro - Calm Mentor",
            description: "Warm voice with a rich tone and calm cadence, ideal for reflective narration, heartfelt campaigns, and cultural storytelling.",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "948196a7-fe02-417b-9b6d-c45ee0803565",
            displayName: "Manuel - Newsman",
            description: "Clear, mature male voice with a steady tone and authoritative presence, ideal for narrations, news-style delivery, and formal announcements.",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "b503f001-80b8-49d3-8666-8d7700fc5ca2",
            displayName: "Liliana - Doting Mother",
            description: "Gentle, motherly middle-aged female voice for nurturing conversations, wellness guidance, and emotionally supportive experiences.",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "fb936dd1-66ea-43a0-86bd-18a6203dcda2",
            displayName: "Rosa - Optimist Mother",
            description: "Happy, approachable middle-aged female voice for cheerful narration and casual conversations.",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "399002e9-7f7d-42d4-a6a8-9b91bd809b9d",
            displayName: "Diego - Hype Guy",
            description: "Lively young adult male voice for energetic, natural-sounding conversations and product-forward moments.",
            gender: "male",
            languages: ["es"]
          },
          {
            id: "ad8eee76-d702-4a1f-a1bd-7596755ae4c9",
            displayName: "Valeria - Cheerful Promoter",
            description: "Expressive and upbeat young adult female voice for energetic commercials, entertainment, and lifestyle content.",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "5deeaea9-c3cf-4288-82ec-22d8f04eb158",
            displayName: "Gerard",
            description: "Deep, distinct middle-aged male voice for grounded narration and calm, authoritative guidance.",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "e2d08065-b658-466b-ad52-cef8ee21d307",
            displayName: "Natasha - Upbeat Guide",
            description: "English female adult voice with a lively, upbeat tone for energetic conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "9a0894a9-28f0-436e-9a1d-e92bccbce4dd",
            displayName: "Albert - Firm Guide",
            description: "English male adult voice with a firm and authoritative tone for providing clear instructions and guidance",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "710feaa3-b550-42f3-b3eb-6f37f2a7cc0a",
            displayName: "Tanner - Upbeat Assistant",
            description: "English male adult voice with an upbeat and energetic tone",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "f762e181-ddc7-486e-9a48-636bd7e229d4",
            displayName: "Chloe - Persuasive Lady",
            description: "English female adult voice with a confident and persuasive tone, able to influence and engage listeners with clarity and conviction",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3ef78ba6-9aaa-46a2-b5b5-f9ded76a2370",
            displayName: "Serena - Laidback Girl",
            description: "Female adult voice with a relaxed, easygoing tone and laid-back delivery",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "0d42f0f6-c019-4082-b250-1c16133d1c82",
            displayName: "Howard - Approachable Man",
            description: "Male adult voice with a clear, approachable tone and steady delivery",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "a7a59115-2425-4192-844c-1e98ec7d6877",
            displayName: "Amber - Warm Support Agent",
            description: "English female adult voice with a cheerful yet deeper tone, striking a balance of warmth and authority for customer service use",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "f39d8500-0d9b-4b8b-a080-38f5188f5892",
            displayName: "Jewel - Commercial Announcer",
            description: "Smooth, confident, and engaging female voice for advertising, promos, and high-impact brand messaging",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "3d808d23-cb09-4c39-8afd-528e209cba4f",
            displayName: "Brent - Steady Conversationalist",
            description: "English male adult voice with a calm, steady, and composed delivery",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "1b4ea5fb-b1c0-43ee-a7be-4e315878c2b1",
            displayName: "Monica - Emotive Voice",
            description: "English female adult voice with rich emotional range and expressive delivery",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "efd255c7-f030-43d3-b5d8-c7b72063be70",
            displayName: "Todd - Matter of Fact Salesman",
            description: "English male adult voice with a direct, matter-of-fact delivery",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "7edf9efb-58fc-46ba-a648-3a00a86b111b",
            displayName: "Elliott - Reflective Storyteller",
            description: "English male adult voice with a soft, melancholic tone and a questioning inflection for storytelling and emotional dialogue",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "01eaafa9-308a-4276-a017-6ab0cf061b1f",
            displayName: "Clara - Instructor",
            description: "Middle-aged American female voice with a clear tone and precise enunciation for instructions, customer support, and professional presentations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "03b1c65d-4b7f-4c09-91a8-e2f6f78cb2c9",
            displayName: "Molly - Upbeat Conversationalist",
            description: "Bright and cheerful American-accented female voice for upbeat conversations, advertisements, and lively interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "92c41dd4-04aa-45de-8504-a92b40cb8818",
            displayName: "Connor - Grateful Person",
            description: "Expressive American adult male voice with a grateful yet firm tone for speeches, storytelling, and professional communication",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "2f22b9bc-b0eb-4cb6-b5ae-0c099a0fdfad",
            displayName: "Scott - Sportscaster",
            description: "Energetic American adult male voice with the excitement of a sportscaster for live commentary, sports content, and high-energy announcements",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "4e41a434-85fc-4614-b203-af79ba44d473",
            displayName: "Sienna - Encourager",
            description: "Soft-spoken American-accented female voice with a motivating and reassuring tone for guidance, support, and uplifting conversations",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "09ed0318-2f4a-41b1-abe5-d11da7537c31",
            displayName: "Daphne - Excited Woman",
            description: "Expressive and upbeat American-accented female voice with an exciting tone for ads, presentations, and lively storytelling",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "79bfcec0-720c-41f2-a33a-f12383e9627f",
            displayName: "Wang - Guide",
            description: "Clear and firm adult male voice with an authoritative tone for customer support, giving instructions and professional communication",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "8918ddfe-2ad4-4cc8-a573-e020ca13f3f5",
            displayName: "Erin - Joyful Guide",
            description: "Cheerful and optimistic adult female voice for upbeat conversations, advertisements, and positive customer interactions",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "d6dca1b6-cdd8-4e9c-823c-e03979261740",
            displayName: "Lars - Casual Conversationalist",
            description: "Approachable adult male voice with a relaxed tone for casual conversations and everyday interactions",
            gender: "male",
            languages: ["no"]
          },
          {
            id: "38bded0a-3ab4-42d1-8e47-2e0b6b10ced9",
            displayName: "Vikram - Folk Narrator",
            description: "Expressive adult male voice with a colorful tone for storytelling, narrations, and engaging cultural content",
            gender: "male",
            languages: ["te"]
          },
          {
            id: "7c6219d2-e8d2-462c-89d8-7ecba7c75d65",
            displayName: "Divya - Joyful Narrator",
            description: "Lively and cheerful adult female voice for product advertisements, upbeat promotions, and happy storytelling",
            gender: "female",
            languages: ["kn"]
          },
          {
            id: "ae1a833b-0d95-4b7f-8d05-d6418c6f8049",
            displayName: "Mikko - Narration Expert",
            description: "Firm and strong adult male voice for narration, audiobooks, and authoritative communication",
            gender: "male",
            languages: ["fi"]
          },
          {
            id: "65c34eec-42c9-4a75-a8bd-b676fb847b72",
            displayName: "Helmi - Warm Friend",
            description: "Friendly adult female voice for casual conversations and everyday chat",
            gender: "female",
            languages: ["fi"]
          },
          {
            id: "f227bc18-3704-47fe-b759-8c78a450fdfa",
            displayName: "Suresh - Instruction Voice",
            description: "Clear and well-enunciated adult male voice for instructions, narrations, and professional communication",
            gender: "male",
            languages: ["mr"]
          },
          {
            id: "6c64b57a-bc65-48e4-bff4-12dbe85606cd",
            displayName: "Eloise - Dialogue Anchor",
            description: "Clear and well-paced adult female voice with a warm tone for customer service and professional communication",
            gender: "female",
            languages: ["fr"]
          },
          {
            id: "91e91d74-8eb4-43cd-97d3-7466c21db00d",
            displayName: "Zehra - Friendly Companion",
            description: "Relaxed adult male voice with a natural and approachable tone for casual chats and everyday conversations",
            gender: "male",
            languages: ["tr"]
          },
          {
            id: "393dd459-f8d8-4c3e-a86b-ec43a1113d0b",
            displayName: "Rahul - Calm Office Guy",
            description: "Approachable adult male voice for casual conversations and everyday interactions",
            gender: "male",
            languages: ["hi"]
          },
          {
            id: "c323c793-41f9-47b8-99dc-9b44b0440b84",
            displayName: "Katrine - Calm Caregiver",
            description: "Soft and calm adult female voice for meditation, relaxation, and gentle conversations",
            gender: "female",
            languages: ["da"]
          },
          {
            id: "59ba7dee-8f9a-432f-a6c0-ffb33666b654",
            displayName: "Pooja - Everyday Assistant",
            description: "Soft-spoken adult female voice for casual conversations and natural dialogue",
            gender: "female",
            languages: ["bn"]
          },
          {
            id: "ca590fdc-df56-4d2e-94a4-ef5b423c7ddf",
            displayName: "Peter - Narrator Man",
            description: "Steady and articulate adult male voice for narrations, audiobooks, and professional storytelling",
            gender: "male",
            languages: ["sk"]
          },
          {
            id: "05ffab9c-d380-4909-8375-cd12f59238c3",
            displayName: "Oleh - Professional Guy",
            description: "Approachable adult male voice with a professional tone for casual conversations and everyday interactions",
            gender: "male",
            languages: ["uk"]
          },
          {
            id: "ac317dac-1b8f-434f-b198-a490e2a4914d",
            displayName: "Anneke - Trusted Guide",
            description: "Soft-spoken adult female voice with a warm and caring tone for supportive conversations and gentle guidance",
            gender: "female",
            languages: ["nl"]
          },
          {
            id: "50849023-76e9-46c7-af52-9ec39888a165",
            displayName: "Despina - Motherly Woman",
            description: "Warm yet authoritative middle-aged female voice, with a motherly tone for guidance, reassurance, and clear instruction",
            gender: "female",
            languages: ["el"]
          },
          {
            id: "d2870b91-1b4c-47ab-81a8-3718d8e9c222",
            displayName: "Arun - Lively Voice",
            description: "Expressive adult voice with a lively tone for storytelling, narrations, and engaging cultural content",
            gender: "male",
            languages: ["ta"]
          },
          {
            id: "b45eba5b-2215-4da7-9c7c-121c95ed7b81",
            displayName: "Nikos - Radio Storyteller",
            description: "Nostalgic, middle-aged male voice with an old-radio tone for historical reenactments, vintage ads, or period storytelling",
            gender: "male",
            languages: ["el"]
          },
          {
            id: "0e58d60a-2f1a-4252-81bd-3db6af45fb41",
            displayName: "Minh - Conversational Partner",
            description: "Easygoing adult male voice with a friendly tone for light conversation, casual dialogue, and everyday chat",
            gender: "male",
            languages: ["vi"]
          },
          {
            id: "31c55968-a9f4-4115-8831-3a16952179c8",
            displayName: "Ayumi - Sales Guide",
            description: "Upbeat and enthusiastic adult female voice for sales, promotions, and engaging customer interactions",
            gender: "female",
            languages: ["ja"]
          },
          {
            id: "a053f6bc-7df4-40de-96d4-de026bc47ce8",
            displayName: "Andi - Dynamic Presenter",
            description: "Expressive adult male voice with an upbeat tone for advertisements, promotions, and lively announcements",
            gender: "male",
            languages: ["id"]
          },
          {
            id: "b8e1169c-f16a-4064-a6e0-95054169e553",
            displayName: "Takashi - Professional Conversationalist",
            description: "Serious adult male voice with a steady but approachable tone for casual conversations and professional dialogue",
            gender: "male",
            languages: ["ja"]
          },
          {
            id: "16212f18-4955-4be9-a6cd-2196ce2c11d1",
            displayName: "Hao - Friendly Guy",
            description: "Warm and friendly adult male voice for approachable conversations, customer support, and casual dialogue",
            gender: "male",
            languages: ["zh"]
          },
          {
            id: "2be00b67-d53f-4eb5-89e7-96c224d56fbc",
            displayName: "Dieter - Commercial Man",
            description: "Loud and expressive adult male voice for storytelling, commercials, and energetic announcements",
            gender: "male",
            languages: ["de"]
          },
          {
            id: "34acfaee-c556-41ee-a5f6-c687fb20357c",
            displayName: "Andrada - Steady Speaker",
            description: "Clear and monotone adult female voice for instructions formal announcements, and straightforward communication",
            gender: "female",
            languages: ["ro"]
          },
          {
            id: "dbebd077-80cb-4bcf-b43b-4552f96341bb",
            displayName: "Levan - Support Guide",
            description: "Casual and approachable adult male voice for customer support and everyday conversations",
            gender: "male",
            languages: ["ka"]
          },
          {
            id: "32a806e8-894e-41ad-a4d5-6d9154d7b1e6",
            displayName: "Erik - Social Speaker",
            description: "Relaxed and approachable adult male voice for casual conversations and natural everyday dialogue",
            gender: "male",
            languages: ["sv"]
          },
          {
            id: "b8cd71e3-bc14-4538-a530-d6314731c036",
            displayName: "Xia - Calm Companion",
            description: "Soft-spoken adult female voice for calm conversations and customer support",
            gender: "female",
            languages: ["vi"]
          },
          {
            id: "b426013c-002b-4e89-8874-8cd20b68373a",
            displayName: "Latha - Friendly Host",
            description: "Bright and clear adult female voice for customer support, greetings, and welcoming guests",
            gender: "female",
            languages: ["ml"]
          },
          {
            id: "8281db18-6ac5-47bb-91a8-ce23a1f1d951",
            displayName: "Faiz - Family Guide",
            description: "Warm and fatherly adult male voice for casual conversations and comforting dialogue",
            gender: "male",
            languages: ["ms"]
          },
          {
            id: "e9f0368b-3662-4a01-b037-e13ca5203c74",
            displayName: "Javier - Gentle Advisor",
            description: "Approachable adult male voice for casual conversations and natural dialogue",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "3e32f3c5-9ac0-4192-9994-87fdb277120f",
            displayName: "Noam - Broadcaster",
            description: "Clear and authoritative adult male voice for announcements, broadcasts, and formal presentations",
            gender: "male",
            languages: ["he"]
          },
          {
            id: "fcbecbcc-0cef-4615-8b5a-712fe1b39dd0",
            displayName: "Ivana - Instruction Provider",
            description: "Clear and authoritative adult female voice for giving instructions and professional communication",
            gender: "female",
            languages: ["bg"]
          },
          {
            id: "0f95596c-09c4-4418-99fe-5c107e0713c0",
            displayName: "Azra - Service Specialist",
            description: "Firm and clear adult voice with a professional tone for instructions, customer service, and formal communication",
            gender: "female",
            languages: ["tr"]
          },
          {
            id: "5de076e9-7b28-4442-b279-e7d80d573505",
            displayName: "Somchai - Star",
            description: "Upbeat and confident adult male voice for commercials, brand promotions, and lively presentations",
            gender: "male",
            languages: ["th"]
          },
          {
            id: "00510a15-4216-4fdc-a0ab-05d74cd9f795",
            displayName: "Elina - Clear Presenter Woman",
            description: "Firm and professional adult female voice for news delivery, announcements, and formal presentations",
            gender: "female",
            languages: ["sv"]
          },
          {
            id: "e97c3b37-1aa5-46af-afb7-9545086aaa92",
            displayName: "Eszter - Customer Companion",
            description: "Clear and cheerful adult female voice for customer support and friendly interactions",
            gender: "female",
            languages: ["hu"]
          },
          {
            id: "991c62ce-631f-48b0-8060-2a0ebecbd15b",
            displayName: "Jaspreet - Commercial Woman",
            description: "Expressive adult female voice with an engaging tone for commercials, promotions, and lively announcements",
            gender: "female",
            languages: ["pa"]
          },
          {
            id: "887149a8-4616-42ad-b2ce-c3819176f45d",
            displayName: "Andrzej - Elder Voice",
            description: "Wise-sounding elderly male voice with a calm and casual tone for storytelling, guidance, and everyday conversations",
            gender: "male",
            languages: ["pl"]
          },
          {
            id: "6d4b1416-8d54-4d94-a788-8a802c086544",
            displayName: "Sabine - Firm Newscaster",
            description: "Soft yet commanding adult female voice for customer support, clear communication, and giving instructions",
            gender: "female",
            languages: ["de"]
          },
          {
            id: "83604597-55fa-4ccc-8357-730b313f353f",
            displayName: "Aisyah - Chat Partner",
            description: "Friendly and upbeat adult female voice for casual conversations and engaging everyday dialogue",
            gender: "female",
            languages: ["ms"]
          },
          {
            id: "bdc4a3ce-2e22-4398-8cd6-76b7160d2298",
            displayName: "Jana - Crisp Conversationalist",
            description: "Clear and crisp female voice with a casual yet commanding tone for customer support and guidance",
            gender: "female",
            languages: ["cs"]
          },
          {
            id: "727f663b-0e90-4031-90f2-558b7334425b",
            displayName: "Carmen - Friendly Neighbor",
            description: "Natural adult female voice for casual conversations and everyday interactions",
            gender: "female",
            languages: ["es"]
          },
          {
            id: "f39bf583-3b3d-402f-9ffb-6179d9ec3e35",
            displayName: "Isabel - Confident Woman",
            description: "Confident, clear, and firm adult female voice for giving instructions, guidance, and professional communication",
            gender: "female",
            languages: ["pt"]
          },
          {
            id: "c4cbcb7d-d9fa-4eac-b547-46831718ef58",
            displayName: "Angelo - Calm Narrator",
            description: "Gentle young adult male voice with a calm and approachable tone for casual conversations, support, and narrations",
            gender: "male",
            languages: ["tl"]
          },
          {
            id: "3f64ef99-d87b-4b51-b217-df7351f7886a",
            displayName: "Andrei - Conversationalist Guy",
            description: "Casual yet firm middle-aged male voice for everyday conversations, guidance, and professional dialogue",
            gender: "male",
            languages: ["ro"]
          },
          {
            id: "6304c635-6681-4f9e-85b6-a97f4d26461a",
            displayName: "Amira - Dreamy Whisperer",
            description: "Calm, soft-spoken adult female for narrations and storytelling",
            gender: "female",
            languages: ["ar"]
          },
          {
            id: "d132064c-b931-4a80-bf0d-02a331ec4572",
            displayName: "Georgi - Conversationalist",
            description: "Friendly adult male with a casual tone for everyday conversations and relatable dialogue",
            gender: "male",
            languages: ["bg"]
          },
          {
            id: "ccc7bb22-dcd0-42e4-822e-0731b950972f",
            displayName: "Suda - Fortune Teller",
            description: "Expressive adult female voice with lively pronunciation for storytelling, advertisements, and engaging dialogue",
            gender: "female",
            languages: ["th"]
          },
          {
            id: "8bacd442-a107-4ec1-b6f1-2fcb3f6f4d56",
            displayName: "Gurpreet - Companion",
            description: "Soft and caring adult male voice for empathetic conversations, support, and reassuring dialogue",
            gender: "male",
            languages: ["pa"]
          },
          {
            id: "89266bab-6e15-455d-8654-e18c440b0656",
            displayName: "Petr - Pastor",
            description: "Resonant adult male voice, reminiscent of a priest delivering a sermon for narrations and formal reading",
            gender: "male",
            languages: ["cs"]
          },
          {
            id: "ea7b5eee-39d9-40b0-b241-1910cbca9c62",
            displayName: "Kasia - Natural Conversationalist",
            description: "Approachable adult female voice with a natural and casual tone for everyday conversations and friendly dialogue",
            gender: "female",
            languages: ["pl"]
          },
          {
            id: "e3087ad8-7018-4154-9a87-11577f916cd4",
            displayName: "Omar - High-Energy Presenter",
            description: "Lively, energetic adult male for engaging conversations and dynamic narration",
            gender: "male",
            languages: ["ar"]
          },
          {
            id: "88b329db-85d7-47cc-a5c5-98225a756721",
            displayName: "Giuseppe - Retro Man",
            description: "Vintage-style adult male voice with a nostalgic old-radio tone for historical reenactments, period storytelling, and retro-style media",
            gender: "male",
            languages: ["it"]
          },
          {
            id: "209d9a43-03eb-40d8-a7b7-51a6d54c052f",
            displayName: "Anita - Meditation Guide",
            description: "Soft-spoken adult female voice for casual conversations, meditation, and calming dialogue",
            gender: "female",
            languages: ["hi"]
          },
          {
            id: "a53c3509-ec3f-425c-a223-977f5f7424dd",
            displayName: "Mei - Expressive Assistant",
            description: "Expressive adult female voice with a lively and engaging tone for storytelling, advertisements, and animated dialogue",
            gender: "female",
            languages: ["zh"]
          },
          {
            id: "56df0456-8f47-4f7a-ac26-40c2f9797104",
            displayName: "Pierre - Baritone Storyteller",
            description: "Deep and resonant adult male voice for narration, audiobooks, and authoritative storytelling",
            gender: "male",
            languages: ["fr"]
          },
          {
            id: "4590a461-bc68-4a50-8d14-ac04f5923d22",
            displayName: "Isha - Learner",
            description: "Youthful male voice with a clear and approachable tone for narration, educational content, and voiceover",
            gender: "female",
            languages: ["gu"]
          },
          {
            id: "6baae46d-1226-45b5-a976-c7f9b797aae2",
            displayName: "Prakash - Instructor",
            description: "Firm and articulate middle-aged male voice for lectures, presentations, and instructional content",
            gender: "male",
            languages: ["kn"]
          },
          {
            id: "9261664a-c3d0-4200-9038-5466bcf3a09c",
            displayName: "Luz - Casual Speaker",
            description: "Natural and conversational adult female voice for everyday dialogue, friendly interactions, and support",
            gender: "female",
            languages: ["tl"]
          },
          {
            id: "4b250449-c635-4b63-bd1d-b654b12ffcd4",
            displayName: "Jeroen - Clear Storyteller",
            description: "Clear and firm adult male voice for scientific reporting, documentaries, and professional presentations",
            gender: "male",
            languages: ["nl"]
          },
          {
            id: "2ba861ea-7cdc-43d1-8608-4045b5a41de5",
            displayName: "Rubel - City Guide",
            description: "Casual adult male voice for everyday conversations and relatable dialogue",
            gender: "male",
            languages: ["bn"]
          },
          {
            id: "a1a16724-b1f3-4b27-9e47-8a175115e93c",
            displayName: "Ivan - Bar Companion",
            description: "Relaxed adult male voice for easygoing conversations",
            gender: "male",
            languages: ["hr"]
          },
          {
            id: "fbee0e7d-a83a-4082-bad1-13c70f86da4e",
            displayName: "Diogo - Promotion Lead",
            description: "Strong and expressive adult male voice for narrations, commercials, and persuasive communication",
            gender: "male",
            languages: ["pt"]
          },
          {
            id: "36e0c00b-1bfd-4ad7-a0e8-928d4cadca00",
            displayName: "Gabor - Reassuring Voice",
            description: "Firm and well-paced adult male voice for customer support, guidance, and professional communication",
            gender: "male",
            languages: ["hu"]
          },
          {
            id: "0bfbea6c-2f8f-4f86-b411-aa2316561e36",
            displayName: "Tamara - Support Specialist",
            description: "Professional and clear adult female voice for customer service, guidance, and supportive interactions",
            gender: "female",
            languages: ["ka"]
          },
          {
            id: "2a2624ad-bd06-4563-81fd-0519742e25d2",
            displayName: "Petra - Strict Lecturer",
            description: "Firm and strict adult female voice for storytelling, guidance, and instructional use cases",
            gender: "female",
            languages: ["hr"]
          },
          {
            id: "7f98e662-142d-41ba-89a2-12452640ce6d",
            displayName: "Lakshmi - Everyday Voice",
            description: "Casual and upbeat adult female voice for friendly conversations, everyday dialogue, and lighthearted interactions",
            gender: "female",
            languages: ["ta"]
          },
          {
            id: "91925fe5-42ee-4ebe-96c1-c84b12a85a32",
            displayName: "Amit - Sports Student",
            description: "Friendly young adult male voice for casual conversations and natural everyday dialogue",
            gender: "male",
            languages: ["gu"]
          },
          {
            id: "9ed9f7e7-3ef6-4773-9dd3-ffcb479ca1f0",
            displayName: "Olga - Confident Saleswoman",
            description: "Upbeat and confident adult female voice for presentations and engaging customer interactions",
            gender: "female",
            languages: ["ru"]
          },
          {
            id: "36d94908-c5b9-4014-b521-e69aee5bead0",
            displayName: "Giulia - Teacherly Voice",
            description: "Firm and clear adult female voice for lectures, guidance, and authoritative storytelling",
            gender: "female",
            languages: ["it"]
          },
          {
            id: "888b7df4-e165-4852-bfec-0ab2b96aaa46",
            displayName: "Dmitri - Gentle Voice",
            description: "Approachable adult male voice with a relaxed tone for casual chats and everyday conversations",
            gender: "male",
            languages: ["ru"]
          },
          {
            id: "b441c4fd-4910-4c55-ae56-f0291057e2cc",
            displayName: "Siti - Ad Narrator",
            description: "Cheerful and optimistic adult female voice for brand placements, advertisements, and engaging storytelling",
            gender: "female",
            languages: ["id"]
          },
          {
            id: "abf68668-6549-462c-8426-1fa7b466b91d",
            displayName: "Katarina - Friendly Sales",
            description: "Warm and approachable adult female voice for customer service, support, and friendly communication",
            gender: "female",
            languages: ["sk"]
          },
          {
            id: "5c32dce6-936a-4892-b131-bafe474afe5f",
            displayName: "Anika - Enthusiastic Seller",
            description: "Energetic and approachable adult female voice for sales conversations, casual chat, and customer support",
            gender: "female",
            languages: ["mr"]
          },
          {
            id: "46788d8e-cdf9-4d5c-9125-094eb2e4d44c",
            displayName: "Brittany - Intense Performer",
            description: "Strong and aggressive American-accented female voice for intense dialogue, dramatic roles, or high-energy commercials",
            gender: "female",
            languages: ["en"]
          },
          {
            id: "e2d48e7b-cd73-4c4c-bc1e-f232580e8709",
            displayName: "Adrian - Explorer",
            description: "Deep American adult male voice with a curious and engaging tone for explorations, documentaries, and storytelling",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "c63361f8-d142-4c62-8da7-8f8149d973d6",
            displayName: "Krishna - Friendly Pal",
            description: "Easygoing adult male voice with a slight Indian accent for casual conversations, approachable dialogue, and friendly interactions",
            gender: "male",
            languages: ["en"]
          },
          {
            id: "9287676d-f0cc-423f-ac03-3b3c7242f091",
            displayName: "Allen - Modern Voice",
            description: "Confident young adult male voice with a neutral American accent for presentations, ads, and engaging everyday conversations",
            gender: "male",
            languages: ["en"]
          }
        ],
        languages: [
          { code: 'en', displayName: 'English' },
          { code: 'de', displayName: 'German' },
          { code: 'es', displayName: 'Spanish' },
          { code: 'fr', displayName: 'French' },
          { code: 'ja', displayName: 'Japanese' },
          { code: 'pt', displayName: 'Portuguese' },
          { code: 'zh', displayName: 'Chinese' },
          { code: 'hi', displayName: 'Hindi' },
          { code: 'ko', displayName: 'Korean' },
          { code: 'it', displayName: 'Italian' },
          { code: 'nl', displayName: 'Dutch' },
          { code: 'pl', displayName: 'Polish' },
          { code: 'ru', displayName: 'Russian' },
          { code: 'sv', displayName: 'Swedish' },
          { code: 'tr', displayName: 'Turkish' },
          { code: 'tl', displayName: 'Tagalog' },
          { code: 'bg', displayName: 'Bulgarian' },
          { code: 'ro', displayName: 'Romanian' },
          { code: 'ar', displayName: 'Arabic' },
          { code: 'cs', displayName: 'Czech' },
          { code: 'el', displayName: 'Greek' },
          { code: 'fi', displayName: 'Finnish' },
          { code: 'hr', displayName: 'Croatian' },
          { code: 'ms', displayName: 'Malay' },
          { code: 'sk', displayName: 'Slovak' },
          { code: 'da', displayName: 'Danish' },
          { code: 'ta', displayName: 'Tamil' },
          { code: 'uk', displayName: 'Ukrainian' },
          { code: 'hu', displayName: 'Hungarian' },
          { code: 'no', displayName: 'Norwegian' },
          { code: 'vi', displayName: 'Vietnamese' },
          { code: 'bn', displayName: 'Bengali' },
          { code: 'th', displayName: 'Thai' },
          { code: 'he', displayName: 'Hebrew' },
          { code: 'ka', displayName: 'Georgian' },
          { code: 'id', displayName: 'Indonesian' },
          { code: 'te', displayName: 'Telugu' },
          { code: 'gu', displayName: 'Gujarati' },
          { code: 'kn', displayName: 'Kannada' },
          { code: 'ml', displayName: 'Malayalam' },
          { code: 'mr', displayName: 'Marathi' },
          { code: 'pa', displayName: 'Punjabi' },
        ],
      },
      {
        apiType: 'azure',
        displayName: 'Azure Text-to-Speech',
        description: 'Microsoft Azure Cognitive Services TTS with neural voices, expressive styles, and support for 100+ languages',
        models: [
          {
            id: 'neural',
            displayName: 'Azure Neural TTS',
            description: 'High-quality neural text-to-speech with natural prosody and expressive voice styles',
            recommended: true,
            languages: ['en-US', 'en-GB', 'en-AU', 'en-CA', 'es-ES', 'es-MX', 'fr-FR', 'fr-CA', 'de-DE', 'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'zh-CN', 'zh-TW', 'ko-KR', 'ar-SA', 'hi-IN', 'ru-RU', 'nl-NL', 'pl-PL', 'sv-SE', 'tr-TR', 'da-DK', 'fi-FI', 'no-NO', 'cs-CZ', 'ro-RO', 'el-GR', 'hu-HU', 'th-TH', 'vi-VN', 'id-ID', 'ms-MY', 'fil-PH', 'uk-UA', 'bg-BG', 'hr-HR', 'sk-SK', 'sl-SI', 'et-EE', 'lv-LV', 'lt-LT', 'mt-MT', 'ga-IE', 'cy-GB', 'is-IS', 'kk-KZ', 'bn-IN', 'ta-IN', 'te-IN', 'mr-IN', 'gu-IN', 'kn-IN', 'ml-IN', 'ur-PK', 'fa-IR', 'he-IL', 'sw-KE', 'af-ZA', 'zu-ZA', 'am-ET', 'km-KH', 'lo-LA', 'my-MM', 'ne-NP', 'si-LK', 'so-SO'],
            supportedAudioFormats: ['pcm_16000', 'pcm_24000', 'pcm_48000', 'opus', 'mp3', 'mulaw', 'alaw'],
            supportsFullStreaming: true,
            supportsVoiceSettings: true,
          },
        ],
        voices: [
          {
            id: "af-ZA-AdriNeural",
            displayName: "Adri (af-ZA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["af-ZA"]
          },
          {
            id: "af-ZA-WillemNeural",
            displayName: "Willem (af-ZA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["af-ZA"]
          },
          {
            id: "am-ET-AmehaNeural",
            displayName: "Ameha (am-ET)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["am-ET"]
          },
          {
            id: "am-ET-MekdesNeural",
            displayName: "Mekdes (am-ET)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["am-ET"]
          },
          {
            id: "ar-AE-FatimaNeural",
            displayName: "Fatima (ar-AE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-AE"]
          },
          {
            id: "ar-AE-HamdanNeural",
            displayName: "Hamdan (ar-AE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-AE"]
          },
          {
            id: "ar-BH-AliNeural",
            displayName: "Ali (ar-BH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-BH"]
          },
          {
            id: "ar-BH-LailaNeural",
            displayName: "Laila (ar-BH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-BH"]
          },
          {
            id: "ar-DZ-AminaNeural",
            displayName: "Amina (ar-DZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-DZ"]
          },
          {
            id: "ar-DZ-IsmaelNeural",
            displayName: "Ismael (ar-DZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-DZ"]
          },
          {
            id: "ar-EG-SalmaNeural",
            displayName: "Salma (ar-EG)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-EG"]
          },
          {
            id: "ar-EG-ShakirNeural",
            displayName: "Shakir (ar-EG)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-EG"]
          },
          {
            id: "ar-IQ-BasselNeural",
            displayName: "Bassel (ar-IQ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-IQ"]
          },
          {
            id: "ar-IQ-RanaNeural",
            displayName: "Rana (ar-IQ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-IQ"]
          },
          {
            id: "ar-JO-SanaNeural",
            displayName: "Sana (ar-JO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-JO"]
          },
          {
            id: "ar-JO-TaimNeural",
            displayName: "Taim (ar-JO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-JO"]
          },
          {
            id: "ar-KW-FahedNeural",
            displayName: "Fahed (ar-KW)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-KW"]
          },
          {
            id: "ar-KW-NouraNeural",
            displayName: "Noura (ar-KW)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-KW"]
          },
          {
            id: "ar-LB-LaylaNeural",
            displayName: "Layla (ar-LB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-LB"]
          },
          {
            id: "ar-LB-RamiNeural",
            displayName: "Rami (ar-LB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-LB"]
          },
          {
            id: "ar-LY-ImanNeural",
            displayName: "Iman (ar-LY)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-LY"]
          },
          {
            id: "ar-LY-OmarNeural",
            displayName: "Omar (ar-LY)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-LY"]
          },
          {
            id: "ar-MA-JamalNeural",
            displayName: "Jamal (ar-MA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-MA"]
          },
          {
            id: "ar-MA-MounaNeural",
            displayName: "Mouna (ar-MA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-MA"]
          },
          {
            id: "ar-OM-AbdullahNeural",
            displayName: "Abdullah (ar-OM)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-OM"]
          },
          {
            id: "ar-OM-AyshaNeural",
            displayName: "Aysha (ar-OM)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-OM"]
          },
          {
            id: "ar-QA-AmalNeural",
            displayName: "Amal (ar-QA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-QA"]
          },
          {
            id: "ar-QA-MoazNeural",
            displayName: "Moaz (ar-QA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-QA"]
          },
          {
            id: "ar-SA-HamedNeural",
            displayName: "Hamed (ar-SA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-SA"]
          },
          {
            id: "ar-SA-ZariyahNeural",
            displayName: "Zariyah (ar-SA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-SA"]
          },
          {
            id: "ar-SY-AmanyNeural",
            displayName: "Amany (ar-SY)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-SY"]
          },
          {
            id: "ar-SY-LaithNeural",
            displayName: "Laith (ar-SY)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-SY"]
          },
          {
            id: "ar-TN-HediNeural",
            displayName: "Hedi (ar-TN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-TN"]
          },
          {
            id: "ar-TN-ReemNeural",
            displayName: "Reem (ar-TN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-TN"]
          },
          {
            id: "ar-YE-MaryamNeural",
            displayName: "Maryam (ar-YE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ar-YE"]
          },
          {
            id: "ar-YE-SalehNeural",
            displayName: "Saleh (ar-YE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ar-YE"]
          },
          {
            id: "as-IN-PriyomNeural",
            displayName: "Priyom (as-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["as-IN"]
          },
          {
            id: "as-IN-YashicaNeural",
            displayName: "Yashica (as-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["as-IN"]
          },
          {
            id: "az-AZ-BabekNeural",
            displayName: "Babek (az-AZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["az-AZ"]
          },
          {
            id: "az-AZ-BanuNeural",
            displayName: "Banu (az-AZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["az-AZ"]
          },
          {
            id: "bg-BG-BorislavNeural",
            displayName: "Borislav (bg-BG)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["bg-BG"]
          },
          {
            id: "bg-BG-KalinaNeural",
            displayName: "Kalina (bg-BG)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["bg-BG"]
          },
          {
            id: "bn-BD-NabanitaNeural",
            displayName: "Nabanita (bn-BD)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["bn-BD"]
          },
          {
            id: "bn-BD-PradeepNeural",
            displayName: "Pradeep (bn-BD)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["bn-BD"]
          },
          {
            id: "bn-IN-BashkarNeural",
            displayName: "Bashkar (bn-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["bn-IN"]
          },
          {
            id: "bn-IN-TanishaaNeural",
            displayName: "Tanishaa (bn-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["bn-IN"]
          },
          {
            id: "bs-BA-GoranNeural",
            displayName: "Goran (bs-BA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["bs-BA"]
          },
          {
            id: "bs-BA-VesnaNeural",
            displayName: "Vesna (bs-BA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["bs-BA"]
          },
          {
            id: "ca-ES-AlbaNeural",
            displayName: "Alba (ca-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ca-ES"]
          },
          {
            id: "ca-ES-EnricNeural",
            displayName: "Enric (ca-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ca-ES"]
          },
          {
            id: "ca-ES-JoanaNeural",
            displayName: "Joana (ca-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ca-ES"]
          },
          {
            id: "cs-CZ-AntoninNeural",
            displayName: "Antonin (cs-CZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["cs-CZ"]
          },
          {
            id: "cs-CZ-VlastaNeural",
            displayName: "Vlasta (cs-CZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["cs-CZ"]
          },
          {
            id: "cy-GB-AledNeural",
            displayName: "Aled (cy-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["cy-GB"]
          },
          {
            id: "cy-GB-NiaNeural",
            displayName: "Nia (cy-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["cy-GB"]
          },
          {
            id: "da-DK-ChristelNeural",
            displayName: "Christel (da-DK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["da-DK"]
          },
          {
            id: "da-DK-JeppeNeural",
            displayName: "Jeppe (da-DK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["da-DK"]
          },
          {
            id: "de-AT-IngridNeural",
            displayName: "Ingrid (de-AT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-AT"]
          },
          {
            id: "de-AT-JonasNeural",
            displayName: "Jonas (de-AT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-AT"]
          },
          {
            id: "de-CH-JanNeural",
            displayName: "Jan (de-CH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-CH"]
          },
          {
            id: "de-CH-LeniNeural",
            displayName: "Leni (de-CH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-CH"]
          },
          {
            id: "de-DE-AmalaNeural",
            displayName: "Amala (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-BerndNeural",
            displayName: "Bernd (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-ChristophNeural",
            displayName: "Christoph (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-ConradNeural",
            displayName: "Conrad (de-DE)",
            description: "Supports styles: cheerful, sad",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-ElkeNeural",
            displayName: "Elke (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-FlorianMultilingualNeural",
            displayName: "FlorianMultilingual (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-GiselaNeural",
            displayName: "Gisela (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-KasperNeural",
            displayName: "Kasper (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-KatjaNeural",
            displayName: "Katja (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-KillianNeural",
            displayName: "Killian (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-KlarissaNeural",
            displayName: "Klarissa (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-KlausNeural",
            displayName: "Klaus (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-LouisaNeural",
            displayName: "Louisa (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-MajaNeural",
            displayName: "Maja (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-RalfNeural",
            displayName: "Ralf (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-SeraphinaMultilingualNeural",
            displayName: "SeraphinaMultilingual (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "de-DE-TanjaNeural",
            displayName: "Tanja (de-DE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["de-DE"]
          },
          {
            id: "el-GR-AthinaNeural",
            displayName: "Athina (el-GR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["el-GR"]
          },
          {
            id: "el-GR-NestorasNeural",
            displayName: "Nestoras (el-GR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["el-GR"]
          },
          {
            id: "en-AU-AnnetteNeural",
            displayName: "Annette (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-CarlyNeural",
            displayName: "Carly (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-DarrenNeural",
            displayName: "Darren (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-DuncanNeural",
            displayName: "Duncan (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-ElsieNeural",
            displayName: "Elsie (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-FreyaNeural",
            displayName: "Freya (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-JoanneNeural",
            displayName: "Joanne (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-KenNeural",
            displayName: "Ken (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-KimNeural",
            displayName: "Kim (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-NatashaNeural",
            displayName: "Natasha (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-NeilNeural",
            displayName: "Neil (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-TimNeural",
            displayName: "Tim (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-TinaNeural",
            displayName: "Tina (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-WilliamNeural",
            displayName: "William (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-AU-WilliamMultilingualNeural",
            displayName: "WilliamMultilingual (en-AU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-AU"]
          },
          {
            id: "en-CA-ClaraNeural",
            displayName: "Clara (en-CA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-CA"]
          },
          {
            id: "en-CA-LiamNeural",
            displayName: "Liam (en-CA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-CA"]
          },
          {
            id: "en-GB-AbbiNeural",
            displayName: "Abbi (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-AdaMultilingualNeural",
            displayName: "AdaMultilingual (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-AlfieNeural",
            displayName: "Alfie (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-BellaNeural",
            displayName: "Bella (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-ElliotNeural",
            displayName: "Elliot (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-EthanNeural",
            displayName: "Ethan (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-HollieNeural",
            displayName: "Hollie (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-LibbyNeural",
            displayName: "Libby (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-MaisieNeural",
            displayName: "Maisie (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-MiaNeural",
            displayName: "Mia (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-NoahNeural",
            displayName: "Noah (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-OliverNeural",
            displayName: "Oliver (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-OliviaNeural",
            displayName: "Olivia (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-OllieMultilingualNeural",
            displayName: "OllieMultilingual (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-RyanNeural",
            displayName: "Ryan (en-GB)",
            description: "Supports styles: cheerful, chat, whispering, sad",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-SoniaNeural",
            displayName: "Sonia (en-GB)",
            description: "Supports styles: cheerful, sad",
            gender: "female",
            languages: ["en-GB"]
          },
          {
            id: "en-GB-ThomasNeural",
            displayName: "Thomas (en-GB)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-GB"]
          },
          {
            id: "en-HK-SamNeural",
            displayName: "Sam (en-HK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-HK"]
          },
          {
            id: "en-HK-YanNeural",
            displayName: "Yan (en-HK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-HK"]
          },
          {
            id: "en-IE-ConnorNeural",
            displayName: "Connor (en-IE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IE"]
          },
          {
            id: "en-IE-EmilyNeural",
            displayName: "Emily (en-IE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IE"]
          },
          {
            id: "en-IN-AaravNeural",
            displayName: "Aarav (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-AartiNeural",
            displayName: "Aarti (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-AartiIndicNeural",
            displayName: "AartiIndic (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-AashiNeural",
            displayName: "Aashi (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-AnanyaNeural",
            displayName: "Ananya (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-ArjunNeural",
            displayName: "Arjun (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-ArjunIndicNeural",
            displayName: "ArjunIndic (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-KavyaNeural",
            displayName: "Kavya (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-KunalNeural",
            displayName: "Kunal (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-NeerjaNeural",
            displayName: "Neerja (en-IN)",
            description: "Supports styles: newscast, cheerful, empathetic",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-NeerjaIndicNeural",
            displayName: "NeerjaIndic (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-PrabhatNeural",
            displayName: "Prabhat (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-PrabhatIndicNeural",
            displayName: "PrabhatIndic (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-IN-RehaanNeural",
            displayName: "Rehaan (en-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-IN"]
          },
          {
            id: "en-KE-AsiliaNeural",
            displayName: "Asilia (en-KE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-KE"]
          },
          {
            id: "en-KE-ChilembaNeural",
            displayName: "Chilemba (en-KE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-KE"]
          },
          {
            id: "en-NG-AbeoNeural",
            displayName: "Abeo (en-NG)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-NG"]
          },
          {
            id: "en-NG-EzinneNeural",
            displayName: "Ezinne (en-NG)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-NG"]
          },
          {
            id: "en-NZ-MitchellNeural",
            displayName: "Mitchell (en-NZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-NZ"]
          },
          {
            id: "en-NZ-MollyNeural",
            displayName: "Molly (en-NZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-NZ"]
          },
          {
            id: "en-PH-JamesNeural",
            displayName: "James (en-PH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-PH"]
          },
          {
            id: "en-PH-RosaNeural",
            displayName: "Rosa (en-PH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-PH"]
          },
          {
            id: "en-SG-LunaNeural",
            displayName: "Luna (en-SG)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-SG"]
          },
          {
            id: "en-SG-WayneNeural",
            displayName: "Wayne (en-SG)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-SG"]
          },
          {
            id: "en-TZ-ElimuNeural",
            displayName: "Elimu (en-TZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-TZ"]
          },
          {
            id: "en-TZ-ImaniNeural",
            displayName: "Imani (en-TZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-TZ"]
          },
          {
            id: "en-US-AdamMultilingualNeural",
            displayName: "AdamMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-AIGenerate1Neural",
            displayName: "AIGenerate1 (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-AIGenerate2Neural",
            displayName: "AIGenerate2 (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AlloyTurboMultilingualNeural",
            displayName: "AlloyTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-AmandaMultilingualNeural",
            displayName: "AmandaMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AmberNeural",
            displayName: "Amber (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AnaNeural",
            displayName: "Ana (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AndrewNeural",
            displayName: "Andrew (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-AndrewMultilingualNeural",
            displayName: "AndrewMultilingual (en-US)",
            description: "Supports styles: empathetic, relieved",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-AriaNeural",
            displayName: "Aria (en-US)",
            description: "Supports styles: chat, customerservice, narration-professional, newscast-casual, newscast-formal, cheerful, empathetic, angry, sad, excited, friendly, terrified, shouting, unfriendly, whispering, hopeful",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AshleyNeural",
            displayName: "Ashley (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AshTurboMultilingualNeural",
            displayName: "AshTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-AvaNeural",
            displayName: "Ava (en-US)",
            description: "Supports styles: angry, fearful, sad",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-AvaMultilingualNeural",
            displayName: "AvaMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-BlueNeural",
            displayName: "Blue (en-US)",
            description: "Neural voice with natural prosody",
            gender: "neutral",
            languages: ["en-US"]
          },
          {
            id: "en-US-BrandonNeural",
            displayName: "Brandon (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-BrandonMultilingualNeural",
            displayName: "BrandonMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-BrianNeural",
            displayName: "Brian (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-BrianMultilingualNeural",
            displayName: "BrianMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-ChristopherNeural",
            displayName: "Christopher (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-ChristopherMultilingualNeural",
            displayName: "ChristopherMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-CoraNeural",
            displayName: "Cora (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-CoraMultilingualNeural",
            displayName: "CoraMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-DavisNeural",
            displayName: "Davis (en-US)",
            description: "Supports styles: chat, angry, cheerful, excited, friendly, hopeful, sad, shouting, terrified, unfriendly, whispering",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-DavisMultilingualNeural",
            displayName: "DavisMultilingual (en-US)",
            description: "Supports styles: empathetic, funny, relieved",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-DerekMultilingualNeural",
            displayName: "DerekMultilingual (en-US)",
            description: "Supports styles: empathetic, excited, relieved, shy",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-DustinMultilingualNeural",
            displayName: "DustinMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-EchoTurboMultilingualNeural",
            displayName: "EchoTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-ElizabethNeural",
            displayName: "Elizabeth (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-EmmaNeural",
            displayName: "Emma (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-EmmaMultilingualNeural",
            displayName: "EmmaMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-EricNeural",
            displayName: "Eric (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-EvelynMultilingualNeural",
            displayName: "EvelynMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-FableTurboMultilingualNeural",
            displayName: "FableTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "neutral",
            languages: ["en-US"]
          },
          {
            id: "en-US-GuyNeural",
            displayName: "Guy (en-US)",
            description: "Supports styles: newscast, angry, cheerful, sad, excited, friendly, terrified, shouting, unfriendly, whispering, hopeful",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-JacobNeural",
            displayName: "Jacob (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-JaneNeural",
            displayName: "Jane (en-US)",
            description: "Supports styles: angry, cheerful, excited, friendly, hopeful, sad, shouting, terrified, unfriendly, whispering",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-JasonNeural",
            displayName: "Jason (en-US)",
            description: "Supports styles: angry, cheerful, excited, friendly, hopeful, sad, shouting, terrified, unfriendly, whispering",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-JennyNeural",
            displayName: "Jenny (en-US)",
            description: "Supports styles: assistant, chat, customerservice, newscast, angry, cheerful, sad, excited, friendly, terrified, shouting, unfriendly, whispering, hopeful",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-JennyMultilingualNeural",
            displayName: "JennyMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-Jimmie:DragonHDFlashLatestNeural",
            displayName: "Jimmie:DragonHDFlashLatest (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-KaiNeural",
            displayName: "Kai (en-US)",
            description: "Supports styles: conversation",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-LewisMultilingualNeural",
            displayName: "LewisMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-LolaMultilingualNeural",
            displayName: "LolaMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-LunaNeural",
            displayName: "Luna (en-US)",
            description: "Supports styles: conversation",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-MichelleNeural",
            displayName: "Michelle (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-MonicaNeural",
            displayName: "Monica (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-NancyNeural",
            displayName: "Nancy (en-US)",
            description: "Supports styles: angry, cheerful, excited, friendly, hopeful, sad, shouting, terrified, unfriendly, whispering",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-NancyMultilingualNeural",
            displayName: "NancyMultilingual (en-US)",
            description: "Supports styles: excited, friendly, funny, relieved, shy",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-NovaTurboMultilingualNeural",
            displayName: "NovaTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-OnyxTurboMultilingualNeural",
            displayName: "OnyxTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-PhoebeMultilingualNeural",
            displayName: "PhoebeMultilingual (en-US)",
            description: "Supports styles: empathetic, sad, serious",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-RogerNeural",
            displayName: "Roger (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-RyanMultilingualNeural",
            displayName: "RyanMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-SamuelMultilingualNeural",
            displayName: "SamuelMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-SaraNeural",
            displayName: "Sara (en-US)",
            description: "Supports styles: angry, cheerful, excited, friendly, hopeful, sad, shouting, terrified, unfriendly, whispering",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-SerenaMultilingualNeural",
            displayName: "SerenaMultilingual (en-US)",
            description: "Supports styles: empathetic, excited, friendly, shy, serious, relieved, sad",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-ShimmerTurboMultilingualNeural",
            displayName: "ShimmerTurboMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-SteffanNeural",
            displayName: "Steffan (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-SteffanMultilingualNeural",
            displayName: "SteffanMultilingual (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-Tiana:DragonHDFlashLatestNeural",
            displayName: "Tiana:DragonHDFlashLatest (en-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-US"]
          },
          {
            id: "en-US-TonyNeural",
            displayName: "Tony (en-US)",
            description: "Supports styles: angry, cheerful, excited, friendly, hopeful, sad, shouting, terrified, unfriendly, whispering",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-US-Tyler:DragonHDFlashLatestNeural",
            displayName: "Tyler:DragonHDFlashLatest (en-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-US"]
          },
          {
            id: "en-ZA-LeahNeural",
            displayName: "Leah (en-ZA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["en-ZA"]
          },
          {
            id: "en-ZA-LukeNeural",
            displayName: "Luke (en-ZA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["en-ZA"]
          },
          {
            id: "es-AR-ElenaNeural",
            displayName: "Elena (es-AR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-AR"]
          },
          {
            id: "es-AR-TomasNeural",
            displayName: "Tomas (es-AR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-AR"]
          },
          {
            id: "es-BO-MarceloNeural",
            displayName: "Marcelo (es-BO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-BO"]
          },
          {
            id: "es-BO-SofiaNeural",
            displayName: "Sofia (es-BO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-BO"]
          },
          {
            id: "es-CL-CatalinaNeural",
            displayName: "Catalina (es-CL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-CL"]
          },
          {
            id: "es-CL-LorenzoNeural",
            displayName: "Lorenzo (es-CL)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-CL"]
          },
          {
            id: "es-CO-GonzaloNeural",
            displayName: "Gonzalo (es-CO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-CO"]
          },
          {
            id: "es-CO-SalomeNeural",
            displayName: "Salome (es-CO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-CO"]
          },
          {
            id: "es-CR-JuanNeural",
            displayName: "Juan (es-CR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-CR"]
          },
          {
            id: "es-CR-MariaNeural",
            displayName: "Maria (es-CR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-CR"]
          },
          {
            id: "es-CU-BelkysNeural",
            displayName: "Belkys (es-CU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-CU"]
          },
          {
            id: "es-CU-ManuelNeural",
            displayName: "Manuel (es-CU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-CU"]
          },
          {
            id: "es-DO-EmilioNeural",
            displayName: "Emilio (es-DO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-DO"]
          },
          {
            id: "es-DO-RamonaNeural",
            displayName: "Ramona (es-DO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-DO"]
          },
          {
            id: "es-EC-AndreaNeural",
            displayName: "Andrea (es-EC)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-EC"]
          },
          {
            id: "es-EC-LuisNeural",
            displayName: "Luis (es-EC)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-EC"]
          },
          {
            id: "es-ES-AbrilNeural",
            displayName: "Abril (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-AlvaroNeural",
            displayName: "Alvaro (es-ES)",
            description: "Supports styles: cheerful, sad",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-ArabellaMultilingualNeural",
            displayName: "ArabellaMultilingual (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-ArnauNeural",
            displayName: "Arnau (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-DarioNeural",
            displayName: "Dario (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-EliasNeural",
            displayName: "Elias (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-ElviraNeural",
            displayName: "Elvira (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-EstrellaNeural",
            displayName: "Estrella (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-IreneNeural",
            displayName: "Irene (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-IsidoraMultilingualNeural",
            displayName: "IsidoraMultilingual (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-LaiaNeural",
            displayName: "Laia (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-LiaNeural",
            displayName: "Lia (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-NilNeural",
            displayName: "Nil (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-SaulNeural",
            displayName: "Saul (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-TeoNeural",
            displayName: "Teo (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-TrianaNeural",
            displayName: "Triana (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-TristanMultilingualNeural",
            displayName: "TristanMultilingual (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-VeraNeural",
            displayName: "Vera (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-XimenaNeural",
            displayName: "Ximena (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-ES-XimenaMultilingualNeural",
            displayName: "XimenaMultilingual (es-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-ES"]
          },
          {
            id: "es-GQ-JavierNeural",
            displayName: "Javier (es-GQ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-GQ"]
          },
          {
            id: "es-GQ-TeresaNeural",
            displayName: "Teresa (es-GQ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-GQ"]
          },
          {
            id: "es-GT-AndresNeural",
            displayName: "Andres (es-GT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-GT"]
          },
          {
            id: "es-GT-MartaNeural",
            displayName: "Marta (es-GT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-GT"]
          },
          {
            id: "es-HN-CarlosNeural",
            displayName: "Carlos (es-HN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-HN"]
          },
          {
            id: "es-HN-KarlaNeural",
            displayName: "Karla (es-HN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-HN"]
          },
          {
            id: "es-MX-BeatrizNeural",
            displayName: "Beatriz (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-CandelaNeural",
            displayName: "Candela (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-CarlotaNeural",
            displayName: "Carlota (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-CecilioNeural",
            displayName: "Cecilio (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-DaliaNeural",
            displayName: "Dalia (es-MX)",
            description: "Supports styles: cheerful, sad, whispering",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-DaliaMultilingualNeural",
            displayName: "DaliaMultilingual (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-GerardoNeural",
            displayName: "Gerardo (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-JorgeNeural",
            displayName: "Jorge (es-MX)",
            description: "Supports styles: cheerful, chat, whispering, sad, excited",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-JorgeMultilingualNeural",
            displayName: "JorgeMultilingual (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-LarissaNeural",
            displayName: "Larissa (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-LibertoNeural",
            displayName: "Liberto (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-LucianoNeural",
            displayName: "Luciano (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-MarinaNeural",
            displayName: "Marina (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-NuriaNeural",
            displayName: "Nuria (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-PelayoNeural",
            displayName: "Pelayo (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-RenataNeural",
            displayName: "Renata (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-MX"]
          },
          {
            id: "es-MX-YagoNeural",
            displayName: "Yago (es-MX)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-MX"]
          },
          {
            id: "es-NI-FedericoNeural",
            displayName: "Federico (es-NI)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-NI"]
          },
          {
            id: "es-NI-YolandaNeural",
            displayName: "Yolanda (es-NI)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-NI"]
          },
          {
            id: "es-PA-MargaritaNeural",
            displayName: "Margarita (es-PA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-PA"]
          },
          {
            id: "es-PA-RobertoNeural",
            displayName: "Roberto (es-PA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-PA"]
          },
          {
            id: "es-PE-AlexNeural",
            displayName: "Alex (es-PE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-PE"]
          },
          {
            id: "es-PE-CamilaNeural",
            displayName: "Camila (es-PE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-PE"]
          },
          {
            id: "es-PR-KarinaNeural",
            displayName: "Karina (es-PR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-PR"]
          },
          {
            id: "es-PR-VictorNeural",
            displayName: "Victor (es-PR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-PR"]
          },
          {
            id: "es-PY-MarioNeural",
            displayName: "Mario (es-PY)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-PY"]
          },
          {
            id: "es-PY-TaniaNeural",
            displayName: "Tania (es-PY)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-PY"]
          },
          {
            id: "es-SV-LorenaNeural",
            displayName: "Lorena (es-SV)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-SV"]
          },
          {
            id: "es-SV-RodrigoNeural",
            displayName: "Rodrigo (es-SV)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-SV"]
          },
          {
            id: "es-US-AlonsoNeural",
            displayName: "Alonso (es-US)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-US"]
          },
          {
            id: "es-US-PalomaNeural",
            displayName: "Paloma (es-US)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-US"]
          },
          {
            id: "es-UY-MateoNeural",
            displayName: "Mateo (es-UY)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-UY"]
          },
          {
            id: "es-UY-ValentinaNeural",
            displayName: "Valentina (es-UY)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-UY"]
          },
          {
            id: "es-VE-PaolaNeural",
            displayName: "Paola (es-VE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["es-VE"]
          },
          {
            id: "es-VE-SebastianNeural",
            displayName: "Sebastian (es-VE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["es-VE"]
          },
          {
            id: "et-EE-AnuNeural",
            displayName: "Anu (et-EE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["et-EE"]
          },
          {
            id: "et-EE-KertNeural",
            displayName: "Kert (et-EE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["et-EE"]
          },
          {
            id: "eu-ES-AinhoaNeural",
            displayName: "Ainhoa (eu-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["eu-ES"]
          },
          {
            id: "eu-ES-AnderNeural",
            displayName: "Ander (eu-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["eu-ES"]
          },
          {
            id: "fa-IR-DilaraNeural",
            displayName: "Dilara (fa-IR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fa-IR"]
          },
          {
            id: "fa-IR-FaridNeural",
            displayName: "Farid (fa-IR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fa-IR"]
          },
          {
            id: "fi-FI-HarriNeural",
            displayName: "Harri (fi-FI)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fi-FI"]
          },
          {
            id: "fi-FI-NooraNeural",
            displayName: "Noora (fi-FI)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fi-FI"]
          },
          {
            id: "fi-FI-SelmaNeural",
            displayName: "Selma (fi-FI)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fi-FI"]
          },
          {
            id: "fil-PH-AngeloNeural",
            displayName: "Angelo (fil-PH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fil-PH"]
          },
          {
            id: "fil-PH-BlessicaNeural",
            displayName: "Blessica (fil-PH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fil-PH"]
          },
          {
            id: "fr-BE-CharlineNeural",
            displayName: "Charline (fr-BE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-BE"]
          },
          {
            id: "fr-BE-GerardNeural",
            displayName: "Gerard (fr-BE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-BE"]
          },
          {
            id: "fr-CA-AntoineNeural",
            displayName: "Antoine (fr-CA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-CA"]
          },
          {
            id: "fr-CA-JeanNeural",
            displayName: "Jean (fr-CA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-CA"]
          },
          {
            id: "fr-CA-SylvieNeural",
            displayName: "Sylvie (fr-CA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-CA"]
          },
          {
            id: "fr-CA-ThierryNeural",
            displayName: "Thierry (fr-CA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-CA"]
          },
          {
            id: "fr-CH-ArianeNeural",
            displayName: "Ariane (fr-CH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-CH"]
          },
          {
            id: "fr-CH-FabriceNeural",
            displayName: "Fabrice (fr-CH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-CH"]
          },
          {
            id: "fr-FR-AlainNeural",
            displayName: "Alain (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-BrigitteNeural",
            displayName: "Brigitte (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-CelesteNeural",
            displayName: "Celeste (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-ClaudeNeural",
            displayName: "Claude (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-CoralieNeural",
            displayName: "Coralie (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-DeniseNeural",
            displayName: "Denise (fr-FR)",
            description: "Supports styles: cheerful, sad, whispering, excited",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-EloiseNeural",
            displayName: "Eloise (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-HenriNeural",
            displayName: "Henri (fr-FR)",
            description: "Supports styles: cheerful, sad, whispering, excited",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-JacquelineNeural",
            displayName: "Jacqueline (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-JeromeNeural",
            displayName: "Jerome (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-JosephineNeural",
            displayName: "Josephine (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-LucienMultilingualNeural",
            displayName: "LucienMultilingual (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-MauriceNeural",
            displayName: "Maurice (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-RemyMultilingualNeural",
            displayName: "RemyMultilingual (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-VivienneMultilingualNeural",
            displayName: "VivienneMultilingual (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-YvesNeural",
            displayName: "Yves (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["fr-FR"]
          },
          {
            id: "fr-FR-YvetteNeural",
            displayName: "Yvette (fr-FR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["fr-FR"]
          },
          {
            id: "ga-IE-ColmNeural",
            displayName: "Colm (ga-IE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ga-IE"]
          },
          {
            id: "ga-IE-OrlaNeural",
            displayName: "Orla (ga-IE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ga-IE"]
          },
          {
            id: "gl-ES-RoiNeural",
            displayName: "Roi (gl-ES)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["gl-ES"]
          },
          {
            id: "gl-ES-SabelaNeural",
            displayName: "Sabela (gl-ES)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["gl-ES"]
          },
          {
            id: "gu-IN-DhwaniNeural",
            displayName: "Dhwani (gu-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["gu-IN"]
          },
          {
            id: "gu-IN-NiranjanNeural",
            displayName: "Niranjan (gu-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["gu-IN"]
          },
          {
            id: "he-IL-AvriNeural",
            displayName: "Avri (he-IL)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["he-IL"]
          },
          {
            id: "he-IL-HilaNeural",
            displayName: "Hila (he-IL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["he-IL"]
          },
          {
            id: "hi-IN-AaravNeural",
            displayName: "Aarav (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-AartiNeural",
            displayName: "Aarti (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-AnanyaNeural",
            displayName: "Ananya (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-ArjunNeural",
            displayName: "Arjun (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-KavyaNeural",
            displayName: "Kavya (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-KunalNeural",
            displayName: "Kunal (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-MadhurNeural",
            displayName: "Madhur (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-RehaanNeural",
            displayName: "Rehaan (hi-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hi-IN"]
          },
          {
            id: "hi-IN-SwaraNeural",
            displayName: "Swara (hi-IN)",
            description: "Supports styles: newscast, cheerful, empathetic",
            gender: "female",
            languages: ["hi-IN"]
          },
          {
            id: "hr-HR-GabrijelaNeural",
            displayName: "Gabrijela (hr-HR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["hr-HR"]
          },
          {
            id: "hr-HR-SreckoNeural",
            displayName: "Srecko (hr-HR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hr-HR"]
          },
          {
            id: "hu-HU-NoemiNeural",
            displayName: "Noemi (hu-HU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["hu-HU"]
          },
          {
            id: "hu-HU-TamasNeural",
            displayName: "Tamas (hu-HU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hu-HU"]
          },
          {
            id: "hy-AM-AnahitNeural",
            displayName: "Anahit (hy-AM)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["hy-AM"]
          },
          {
            id: "hy-AM-HaykNeural",
            displayName: "Hayk (hy-AM)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["hy-AM"]
          },
          {
            id: "id-ID-ArdiNeural",
            displayName: "Ardi (id-ID)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["id-ID"]
          },
          {
            id: "id-ID-GadisNeural",
            displayName: "Gadis (id-ID)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["id-ID"]
          },
          {
            id: "is-IS-GudrunNeural",
            displayName: "Gudrun (is-IS)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["is-IS"]
          },
          {
            id: "is-IS-GunnarNeural",
            displayName: "Gunnar (is-IS)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["is-IS"]
          },
          {
            id: "it-IT-AlessioMultilingualNeural",
            displayName: "AlessioMultilingual (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-BenignoNeural",
            displayName: "Benigno (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-CalimeroNeural",
            displayName: "Calimero (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-CataldoNeural",
            displayName: "Cataldo (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-DiegoNeural",
            displayName: "Diego (it-IT)",
            description: "Supports styles: cheerful, sad, excited",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-ElsaNeural",
            displayName: "Elsa (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-FabiolaNeural",
            displayName: "Fabiola (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-FiammaNeural",
            displayName: "Fiamma (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-GianniNeural",
            displayName: "Gianni (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-GiuseppeNeural",
            displayName: "Giuseppe (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-GiuseppeMultilingualNeural",
            displayName: "GiuseppeMultilingual (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-ImeldaNeural",
            displayName: "Imelda (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-IrmaNeural",
            displayName: "Irma (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-IsabellaNeural",
            displayName: "Isabella (it-IT)",
            description: "Supports styles: cheerful, chat, whispering, sad, excited",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-IsabellaMultilingualNeural",
            displayName: "IsabellaMultilingual (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-LisandroNeural",
            displayName: "Lisandro (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-MarcelloMultilingualNeural",
            displayName: "MarcelloMultilingual (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-PalmiraNeural",
            displayName: "Palmira (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-PierinaNeural",
            displayName: "Pierina (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["it-IT"]
          },
          {
            id: "it-IT-RinaldoNeural",
            displayName: "Rinaldo (it-IT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["it-IT"]
          },
          {
            id: "iu-Cans-CA-SiqiniqNeural",
            displayName: "Siqiniq (iu-Cans-CA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["iu-Cans-CA"]
          },
          {
            id: "iu-Cans-CA-TaqqiqNeural",
            displayName: "Taqqiq (iu-Cans-CA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["iu-Cans-CA"]
          },
          {
            id: "iu-Latn-CA-SiqiniqNeural",
            displayName: "Siqiniq (iu-Latn-CA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["iu-Latn-CA"]
          },
          {
            id: "iu-Latn-CA-TaqqiqNeural",
            displayName: "Taqqiq (iu-Latn-CA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["iu-Latn-CA"]
          },
          {
            id: "ja-JP-AoiNeural",
            displayName: "Aoi (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-DaichiNeural",
            displayName: "Daichi (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-KeitaNeural",
            displayName: "Keita (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-MasaruMultilingualNeural",
            displayName: "MasaruMultilingual (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-MayuNeural",
            displayName: "Mayu (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-NanamiNeural",
            displayName: "Nanami (ja-JP)",
            description: "Supports styles: chat, customerservice, cheerful",
            gender: "female",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-NaokiNeural",
            displayName: "Naoki (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ja-JP"]
          },
          {
            id: "ja-JP-ShioriNeural",
            displayName: "Shiori (ja-JP)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ja-JP"]
          },
          {
            id: "jv-ID-DimasNeural",
            displayName: "Dimas (jv-ID)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["jv-ID"]
          },
          {
            id: "jv-ID-SitiNeural",
            displayName: "Siti (jv-ID)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["jv-ID"]
          },
          {
            id: "ka-GE-EkaNeural",
            displayName: "Eka (ka-GE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ka-GE"]
          },
          {
            id: "ka-GE-GiorgiNeural",
            displayName: "Giorgi (ka-GE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ka-GE"]
          },
          {
            id: "kk-KZ-AigulNeural",
            displayName: "Aigul (kk-KZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["kk-KZ"]
          },
          {
            id: "kk-KZ-DauletNeural",
            displayName: "Daulet (kk-KZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["kk-KZ"]
          },
          {
            id: "km-KH-PisethNeural",
            displayName: "Piseth (km-KH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["km-KH"]
          },
          {
            id: "km-KH-SreymomNeural",
            displayName: "Sreymom (km-KH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["km-KH"]
          },
          {
            id: "kn-IN-GaganNeural",
            displayName: "Gagan (kn-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["kn-IN"]
          },
          {
            id: "kn-IN-SapnaNeural",
            displayName: "Sapna (kn-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["kn-IN"]
          },
          {
            id: "ko-KR-BongJinNeural",
            displayName: "BongJin (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-GookMinNeural",
            displayName: "GookMin (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-HyunsuNeural",
            displayName: "Hyunsu (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-HyunsuMultilingualNeural",
            displayName: "HyunsuMultilingual (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-InJoonNeural",
            displayName: "InJoon (ko-KR)",
            description: "Supports styles: sad",
            gender: "male",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-JiMinNeural",
            displayName: "JiMin (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-SeoHyeonNeural",
            displayName: "SeoHyeon (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-SoonBokNeural",
            displayName: "SoonBok (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-SunHiNeural",
            displayName: "SunHi (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ko-KR"]
          },
          {
            id: "ko-KR-YuJinNeural",
            displayName: "YuJin (ko-KR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ko-KR"]
          },
          {
            id: "lo-LA-ChanthavongNeural",
            displayName: "Chanthavong (lo-LA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["lo-LA"]
          },
          {
            id: "lo-LA-KeomanyNeural",
            displayName: "Keomany (lo-LA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["lo-LA"]
          },
          {
            id: "lt-LT-LeonasNeural",
            displayName: "Leonas (lt-LT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["lt-LT"]
          },
          {
            id: "lt-LT-OnaNeural",
            displayName: "Ona (lt-LT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["lt-LT"]
          },
          {
            id: "lv-LV-EveritaNeural",
            displayName: "Everita (lv-LV)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["lv-LV"]
          },
          {
            id: "lv-LV-NilsNeural",
            displayName: "Nils (lv-LV)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["lv-LV"]
          },
          {
            id: "mk-MK-AleksandarNeural",
            displayName: "Aleksandar (mk-MK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["mk-MK"]
          },
          {
            id: "mk-MK-MarijaNeural",
            displayName: "Marija (mk-MK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["mk-MK"]
          },
          {
            id: "ml-IN-MidhunNeural",
            displayName: "Midhun (ml-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ml-IN"]
          },
          {
            id: "ml-IN-SobhanaNeural",
            displayName: "Sobhana (ml-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ml-IN"]
          },
          {
            id: "mn-MN-BataaNeural",
            displayName: "Bataa (mn-MN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["mn-MN"]
          },
          {
            id: "mn-MN-YesuiNeural",
            displayName: "Yesui (mn-MN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["mn-MN"]
          },
          {
            id: "mr-IN-AarohiNeural",
            displayName: "Aarohi (mr-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["mr-IN"]
          },
          {
            id: "mr-IN-ManoharNeural",
            displayName: "Manohar (mr-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["mr-IN"]
          },
          {
            id: "ms-MY-OsmanNeural",
            displayName: "Osman (ms-MY)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ms-MY"]
          },
          {
            id: "ms-MY-YasminNeural",
            displayName: "Yasmin (ms-MY)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ms-MY"]
          },
          {
            id: "mt-MT-GraceNeural",
            displayName: "Grace (mt-MT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["mt-MT"]
          },
          {
            id: "mt-MT-JosephNeural",
            displayName: "Joseph (mt-MT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["mt-MT"]
          },
          {
            id: "my-MM-NilarNeural",
            displayName: "Nilar (my-MM)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["my-MM"]
          },
          {
            id: "my-MM-ThihaNeural",
            displayName: "Thiha (my-MM)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["my-MM"]
          },
          {
            id: "nb-NO-FinnNeural",
            displayName: "Finn (nb-NO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["nb-NO"]
          },
          {
            id: "nb-NO-IselinNeural",
            displayName: "Iselin (nb-NO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["nb-NO"]
          },
          {
            id: "nb-NO-PernilleNeural",
            displayName: "Pernille (nb-NO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["nb-NO"]
          },
          {
            id: "ne-NP-HemkalaNeural",
            displayName: "Hemkala (ne-NP)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ne-NP"]
          },
          {
            id: "ne-NP-SagarNeural",
            displayName: "Sagar (ne-NP)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ne-NP"]
          },
          {
            id: "nl-BE-ArnaudNeural",
            displayName: "Arnaud (nl-BE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["nl-BE"]
          },
          {
            id: "nl-BE-DenaNeural",
            displayName: "Dena (nl-BE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["nl-BE"]
          },
          {
            id: "nl-NL-ColetteNeural",
            displayName: "Colette (nl-NL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["nl-NL"]
          },
          {
            id: "nl-NL-FennaNeural",
            displayName: "Fenna (nl-NL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["nl-NL"]
          },
          {
            id: "nl-NL-MaartenNeural",
            displayName: "Maarten (nl-NL)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["nl-NL"]
          },
          {
            id: "or-IN-SubhasiniNeural",
            displayName: "Subhasini (or-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["or-IN"]
          },
          {
            id: "or-IN-SukantNeural",
            displayName: "Sukant (or-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["or-IN"]
          },
          {
            id: "pa-IN-OjasNeural",
            displayName: "Ojas (pa-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pa-IN"]
          },
          {
            id: "pa-IN-VaaniNeural",
            displayName: "Vaani (pa-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pa-IN"]
          },
          {
            id: "pl-PL-AgnieszkaNeural",
            displayName: "Agnieszka (pl-PL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pl-PL"]
          },
          {
            id: "pl-PL-MarekNeural",
            displayName: "Marek (pl-PL)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pl-PL"]
          },
          {
            id: "pl-PL-ZofiaNeural",
            displayName: "Zofia (pl-PL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pl-PL"]
          },
          {
            id: "ps-AF-GulNawazNeural",
            displayName: "GulNawaz (ps-AF)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ps-AF"]
          },
          {
            id: "ps-AF-LatifaNeural",
            displayName: "Latifa (ps-AF)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ps-AF"]
          },
          {
            id: "pt-BR-AntonioNeural",
            displayName: "Antonio (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-BrendaNeural",
            displayName: "Brenda (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-DonatoNeural",
            displayName: "Donato (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-ElzaNeural",
            displayName: "Elza (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-FabioNeural",
            displayName: "Fabio (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-FranciscaNeural",
            displayName: "Francisca (pt-BR)",
            description: "Supports styles: calm",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-GiovannaNeural",
            displayName: "Giovanna (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-HumbertoNeural",
            displayName: "Humberto (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-JulioNeural",
            displayName: "Julio (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-LeilaNeural",
            displayName: "Leila (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-LeticiaNeural",
            displayName: "Leticia (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-MacerioMultilingualNeural",
            displayName: "MacerioMultilingual (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-ManuelaNeural",
            displayName: "Manuela (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-NicolauNeural",
            displayName: "Nicolau (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-ThalitaNeural",
            displayName: "Thalita (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-ThalitaMultilingualNeural",
            displayName: "ThalitaMultilingual (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-ValerioNeural",
            displayName: "Valerio (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-BR"]
          },
          {
            id: "pt-BR-YaraNeural",
            displayName: "Yara (pt-BR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-BR"]
          },
          {
            id: "pt-PT-DuarteNeural",
            displayName: "Duarte (pt-PT)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["pt-PT"]
          },
          {
            id: "pt-PT-FernandaNeural",
            displayName: "Fernanda (pt-PT)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["pt-PT"]
          },
          {
            id: "pt-PT-RaquelNeural",
            displayName: "Raquel (pt-PT)",
            description: "Supports styles: sad, whispering",
            gender: "female",
            languages: ["pt-PT"]
          },
          {
            id: "ro-RO-AlinaNeural",
            displayName: "Alina (ro-RO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ro-RO"]
          },
          {
            id: "ro-RO-EmilNeural",
            displayName: "Emil (ro-RO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ro-RO"]
          },
          {
            id: "ru-RU-DariyaNeural",
            displayName: "Dariya (ru-RU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ru-RU"]
          },
          {
            id: "ru-RU-DmitryNeural",
            displayName: "Dmitry (ru-RU)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ru-RU"]
          },
          {
            id: "ru-RU-SvetlanaNeural",
            displayName: "Svetlana (ru-RU)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ru-RU"]
          },
          {
            id: "si-LK-SameeraNeural",
            displayName: "Sameera (si-LK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["si-LK"]
          },
          {
            id: "si-LK-ThiliniNeural",
            displayName: "Thilini (si-LK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["si-LK"]
          },
          {
            id: "sk-SK-LukasNeural",
            displayName: "Lukas (sk-SK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sk-SK"]
          },
          {
            id: "sk-SK-ViktoriaNeural",
            displayName: "Viktoria (sk-SK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sk-SK"]
          },
          {
            id: "sl-SI-PetraNeural",
            displayName: "Petra (sl-SI)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sl-SI"]
          },
          {
            id: "sl-SI-RokNeural",
            displayName: "Rok (sl-SI)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sl-SI"]
          },
          {
            id: "so-SO-MuuseNeural",
            displayName: "Muuse (so-SO)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["so-SO"]
          },
          {
            id: "so-SO-UbaxNeural",
            displayName: "Ubax (so-SO)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["so-SO"]
          },
          {
            id: "sq-AL-AnilaNeural",
            displayName: "Anila (sq-AL)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sq-AL"]
          },
          {
            id: "sq-AL-IlirNeural",
            displayName: "Ilir (sq-AL)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sq-AL"]
          },
          {
            id: "sr-Latn-RS-NicholasNeural",
            displayName: "Nicholas (sr-Latn-RS)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sr-Latn-RS"]
          },
          {
            id: "sr-Latn-RS-SophieNeural",
            displayName: "Sophie (sr-Latn-RS)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sr-Latn-RS"]
          },
          {
            id: "sr-RS-NicholasNeural",
            displayName: "Nicholas (sr-RS)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sr-RS"]
          },
          {
            id: "sr-RS-SophieNeural",
            displayName: "Sophie (sr-RS)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sr-RS"]
          },
          {
            id: "su-ID-JajangNeural",
            displayName: "Jajang (su-ID)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["su-ID"]
          },
          {
            id: "su-ID-TutiNeural",
            displayName: "Tuti (su-ID)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["su-ID"]
          },
          {
            id: "sv-SE-HilleviNeural",
            displayName: "Hillevi (sv-SE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sv-SE"]
          },
          {
            id: "sv-SE-MattiasNeural",
            displayName: "Mattias (sv-SE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sv-SE"]
          },
          {
            id: "sv-SE-SofieNeural",
            displayName: "Sofie (sv-SE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sv-SE"]
          },
          {
            id: "sw-KE-RafikiNeural",
            displayName: "Rafiki (sw-KE)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sw-KE"]
          },
          {
            id: "sw-KE-ZuriNeural",
            displayName: "Zuri (sw-KE)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sw-KE"]
          },
          {
            id: "sw-TZ-DaudiNeural",
            displayName: "Daudi (sw-TZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["sw-TZ"]
          },
          {
            id: "sw-TZ-RehemaNeural",
            displayName: "Rehema (sw-TZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["sw-TZ"]
          },
          {
            id: "ta-IN-PallaviNeural",
            displayName: "Pallavi (ta-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ta-IN"]
          },
          {
            id: "ta-IN-ValluvarNeural",
            displayName: "Valluvar (ta-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ta-IN"]
          },
          {
            id: "ta-LK-KumarNeural",
            displayName: "Kumar (ta-LK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ta-LK"]
          },
          {
            id: "ta-LK-SaranyaNeural",
            displayName: "Saranya (ta-LK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ta-LK"]
          },
          {
            id: "ta-MY-KaniNeural",
            displayName: "Kani (ta-MY)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ta-MY"]
          },
          {
            id: "ta-MY-SuryaNeural",
            displayName: "Surya (ta-MY)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ta-MY"]
          },
          {
            id: "ta-SG-AnbuNeural",
            displayName: "Anbu (ta-SG)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ta-SG"]
          },
          {
            id: "ta-SG-VenbaNeural",
            displayName: "Venba (ta-SG)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ta-SG"]
          },
          {
            id: "te-IN-MohanNeural",
            displayName: "Mohan (te-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["te-IN"]
          },
          {
            id: "te-IN-ShrutiNeural",
            displayName: "Shruti (te-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["te-IN"]
          },
          {
            id: "th-TH-AcharaNeural",
            displayName: "Achara (th-TH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["th-TH"]
          },
          {
            id: "th-TH-NiwatNeural",
            displayName: "Niwat (th-TH)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["th-TH"]
          },
          {
            id: "th-TH-PremwadeeNeural",
            displayName: "Premwadee (th-TH)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["th-TH"]
          },
          {
            id: "tr-TR-AhmetNeural",
            displayName: "Ahmet (tr-TR)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["tr-TR"]
          },
          {
            id: "tr-TR-EmelNeural",
            displayName: "Emel (tr-TR)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["tr-TR"]
          },
          {
            id: "uk-UA-OstapNeural",
            displayName: "Ostap (uk-UA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["uk-UA"]
          },
          {
            id: "uk-UA-PolinaNeural",
            displayName: "Polina (uk-UA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["uk-UA"]
          },
          {
            id: "ur-IN-GulNeural",
            displayName: "Gul (ur-IN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ur-IN"]
          },
          {
            id: "ur-IN-SalmanNeural",
            displayName: "Salman (ur-IN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ur-IN"]
          },
          {
            id: "ur-PK-AsadNeural",
            displayName: "Asad (ur-PK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["ur-PK"]
          },
          {
            id: "ur-PK-UzmaNeural",
            displayName: "Uzma (ur-PK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["ur-PK"]
          },
          {
            id: "uz-UZ-MadinaNeural",
            displayName: "Madina (uz-UZ)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["uz-UZ"]
          },
          {
            id: "uz-UZ-SardorNeural",
            displayName: "Sardor (uz-UZ)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["uz-UZ"]
          },
          {
            id: "vi-VN-HoaiMyNeural",
            displayName: "HoaiMy (vi-VN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["vi-VN"]
          },
          {
            id: "vi-VN-NamMinhNeural",
            displayName: "NamMinh (vi-VN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["vi-VN"]
          },
          {
            id: "wuu-CN-XiaotongNeural",
            displayName: "Xiaotong (wuu-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["wuu-CN"]
          },
          {
            id: "wuu-CN-YunzheNeural",
            displayName: "Yunzhe (wuu-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["wuu-CN"]
          },
          {
            id: "yue-CN-XiaoMinNeural",
            displayName: "XiaoMin (yue-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["yue-CN"]
          },
          {
            id: "yue-CN-YunSongNeural",
            displayName: "YunSong (yue-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["yue-CN"]
          },
          {
            id: "zh-CN-XiaochenNeural",
            displayName: "Xiaochen (zh-CN)",
            description: "Supports styles: livecommercial",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaochen:DragonHDFlashLatestNeural",
            displayName: "Xiaochen:DragonHDFlashLatest (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaochenMultilingualNeural",
            displayName: "XiaochenMultilingual (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaohanNeural",
            displayName: "Xiaohan (zh-CN)",
            description: "Supports styles: calm, fearful, cheerful, disgruntled, serious, angry, sad, gentle, affectionate, embarrassed",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaomengNeural",
            displayName: "Xiaomeng (zh-CN)",
            description: "Supports styles: chat",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaomoNeural",
            displayName: "Xiaomo (zh-CN)",
            description: "Supports styles: embarrassed, calm, fearful, cheerful, disgruntled, serious, angry, sad, depressed, affectionate, gentle, envious",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoqiuNeural",
            displayName: "Xiaoqiu (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaorouNeural",
            displayName: "Xiaorou (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoruiNeural",
            displayName: "Xiaorui (zh-CN)",
            description: "Supports styles: calm, fearful, angry, sad",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoshuangNeural",
            displayName: "Xiaoshuang (zh-CN)",
            description: "Supports styles: chat",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaoshuang:DragonHDFlashLatestNeural",
            displayName: "Xiaoshuang:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: chat",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoshuangMultilingualNeural",
            displayName: "XiaoshuangMultilingual (zh-CN)",
            description: "Supports styles: chat",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoxiaoNeural",
            displayName: "Xiaoxiao (zh-CN)",
            description: "Supports styles: assistant, chat, customerservice, newscast, affectionate, angry, calm, cheerful, disgruntled, fearful, gentle, lyrical, sad, serious, poetry-reading, friendly, chat-casual, whispering, sorry, excited",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural",
            displayName: "Xiaoxiao:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: angry, chat, cheerful, excited, fearful, sad, voiceassistant, customerservice",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaoxiao2:DragonHDFlashLatestNeural",
            displayName: "Xiaoxiao2:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: affectionate, angry, anxious, cheerful, curious, disappointed, empathetic, encouragement, excited, fearful, guilty, lonely, poetry-reading, sad, surprised, sentiment, sorry, story, whisper, tired",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoxiaoDialectsNeural",
            displayName: "XiaoxiaoDialects (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoxiaoMultilingualNeural",
            displayName: "XiaoxiaoMultilingual (zh-CN)",
            description: "Supports styles: affectionate, cheerful, empathetic, excited, poetry-reading, sorry, story",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoyanNeural",
            displayName: "Xiaoyan (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoyiNeural",
            displayName: "Xiaoyi (zh-CN)",
            description: "Supports styles: angry, disgruntled, affectionate, cheerful, fearful, sad, embarrassed, serious, gentle",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaoyi:DragonHDFlashLatestNeural",
            displayName: "Xiaoyi:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: angry, cheerful, complaining, cutesy, gentle, nervous, sad, shy, strict",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoyouNeural",
            displayName: "Xiaoyou (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaoyou:DragonHDFlashLatestNeural",
            displayName: "Xiaoyou:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: chat, angry, cheerful, poetry-reading, sad, story, cute",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoyouMultilingualNeural",
            displayName: "XiaoyouMultilingual (zh-CN)",
            description: "Supports styles: chat, angry, cheerful, poetry-reading, sad, story, cute",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Xiaoyu:DragonHDFlashLatestNeural",
            displayName: "Xiaoyu:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: argue, angry, cheerful, comfort, sad, sorry",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaoyuMultilingualNeural",
            displayName: "XiaoyuMultilingual (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-XiaozhenNeural",
            displayName: "Xiaozhen (zh-CN)",
            description: "Supports styles: angry, disgruntled, cheerful, fearful, sad, serious",
            gender: "female",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunfanMultilingualNeural",
            displayName: "YunfanMultilingual (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunfengNeural",
            displayName: "Yunfeng (zh-CN)",
            description: "Supports styles: angry, disgruntled, cheerful, fearful, sad, serious, depressed",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunhaoNeural",
            displayName: "Yunhao (zh-CN)",
            description: "Supports styles: advertisement-upbeat",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunjianNeural",
            displayName: "Yunjian (zh-CN)",
            description: "Supports styles: narration-relaxed, sports-commentary, sports-commentary-excited, angry, disgruntled, cheerful, sad, serious, depressed, documentary-narration",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunjieNeural",
            displayName: "Yunjie (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunxiNeural",
            displayName: "Yunxi (zh-CN)",
            description: "Supports styles: narration-relaxed, embarrassed, fearful, cheerful, disgruntled, serious, angry, sad, depressed, chat, assistant, newscast",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunxiaNeural",
            displayName: "Yunxia (zh-CN)",
            description: "Supports styles: calm, fearful, cheerful, angry, sad",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Yunxia:DragonHDFlashLatestNeural",
            displayName: "Yunxia:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: affectionate, angry, comfort, cheerful, encourage, excited, fearful, sad, surprised",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Yunxiao:DragonHDFlashLatestNeural",
            displayName: "Yunxiao:DragonHDFlashLatest (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunxiaoMultilingualNeural",
            displayName: "YunxiaoMultilingual (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunyangNeural",
            displayName: "Yunyang (zh-CN)",
            description: "Supports styles: customerservice, narration-professional, newscast-casual",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunyeNeural",
            displayName: "Yunye (zh-CN)",
            description: "Supports styles: embarrassed, calm, fearful, cheerful, disgruntled, serious, angry, sad",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Yunye:DragonHDFlashLatestNeural",
            displayName: "Yunye:DragonHDFlashLatest (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-Yunyi:DragonHDFlashLatestNeural",
            displayName: "Yunyi:DragonHDFlashLatest (zh-CN)",
            description: "Supports styles: assassin, captain, cavalier, drake, gamenarrator, geomancer, poet",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunyiMultilingualNeural",
            displayName: "YunyiMultilingual (zh-CN)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-YunzeNeural",
            displayName: "Yunze (zh-CN)",
            description: "Supports styles: calm, fearful, cheerful, disgruntled, serious, angry, sad, depressed, documentary-narration",
            gender: "male",
            languages: ["zh-CN"]
          },
          {
            id: "zh-CN-guangxi-YunqiNeural",
            displayName: "Yunqi (zh-CN-guangxi)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN-guangxi"]
          },
          {
            id: "zh-CN-henan-YundengNeural",
            displayName: "Yundeng (zh-CN-henan)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN-henan"]
          },
          {
            id: "zh-CN-liaoning-XiaobeiNeural",
            displayName: "Xiaobei (zh-CN-liaoning)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN-liaoning"]
          },
          {
            id: "zh-CN-liaoning-YunbiaoNeural",
            displayName: "Yunbiao (zh-CN-liaoning)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN-liaoning"]
          },
          {
            id: "zh-CN-shaanxi-XiaoniNeural",
            displayName: "Xiaoni (zh-CN-shaanxi)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-CN-shaanxi"]
          },
          {
            id: "zh-CN-shandong-YunxiangNeural",
            displayName: "Yunxiang (zh-CN-shandong)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN-shandong"]
          },
          {
            id: "zh-CN-sichuan-YunxiNeural",
            displayName: "Yunxi (zh-CN-sichuan)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-CN-sichuan"]
          },
          {
            id: "zh-HK-HiuGaaiNeural",
            displayName: "HiuGaai (zh-HK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-HK"]
          },
          {
            id: "zh-HK-HiuMaanNeural",
            displayName: "HiuMaan (zh-HK)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-HK"]
          },
          {
            id: "zh-HK-WanLungNeural",
            displayName: "WanLung (zh-HK)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-HK"]
          },
          {
            id: "zh-TW-HsiaoChenNeural",
            displayName: "HsiaoChen (zh-TW)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-TW"]
          },
          {
            id: "zh-TW-HsiaoYuNeural",
            displayName: "HsiaoYu (zh-TW)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zh-TW"]
          },
          {
            id: "zh-TW-YunJheNeural",
            displayName: "YunJhe (zh-TW)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zh-TW"]
          },
          {
            id: "zu-ZA-ThandoNeural",
            displayName: "Thando (zu-ZA)",
            description: "Neural voice with natural prosody",
            gender: "female",
            languages: ["zu-ZA"]
          },
          {
            id: "zu-ZA-ThembaNeural",
            displayName: "Themba (zu-ZA)",
            description: "Neural voice with natural prosody",
            gender: "male",
            languages: ["zu-ZA"]
          }
        ],
        languages: [
          { code: 'en-US', displayName: 'English (United States)' },
          { code: 'en-GB', displayName: 'English (United Kingdom)' },
          { code: 'en-AU', displayName: 'English (Australia)' },
          { code: 'en-CA', displayName: 'English (Canada)' },
          { code: 'es-ES', displayName: 'Spanish (Spain)' },
          { code: 'es-MX', displayName: 'Spanish (Mexico)' },
          { code: 'fr-FR', displayName: 'French (France)' },
          { code: 'fr-CA', displayName: 'French (Canada)' },
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
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: true,
            contextWindow: 128000,
          },
          {
            id: 'gpt-5-mini',
            displayName: 'GPT-5 Mini',
            description: 'Faster, cost-efficient version of GPT-5 for well-defined tasks',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: true,
            contextWindow: 128000,
          },
          {
            id: 'gpt-5-nano',
            displayName: 'GPT-5 Nano',
            description: 'Fastest, most cost-efficient version of GPT-5',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: true,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4.1',
            displayName: 'GPT-4.1',
            description: 'Smartest non-reasoning model',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4o',
            displayName: 'GPT-4o',
            description: 'Fast, intelligent, flexible GPT model (legacy)',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4o-mini',
            displayName: 'GPT-4o Mini',
            description: 'Fast, affordable small model for focused tasks (legacy)',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
        ],
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
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4o',
            displayName: 'GPT-4o',
            description: 'Fast, intelligent, flexible GPT model',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4o-mini',
            displayName: 'GPT-4o Mini',
            description: 'Fast, affordable small model for focused tasks',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4-turbo',
            displayName: 'GPT-4 Turbo',
            description: 'Older high-intelligence GPT model',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: false,
            contextWindow: 128000,
          },
          {
            id: 'gpt-4',
            displayName: 'GPT-4',
            description: 'Legacy GPT-4 model',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 8192,
          },
          {
            id: 'gpt-3.5-turbo',
            displayName: 'GPT-3.5 Turbo',
            description: 'Legacy model for cheaper chat and non-chat tasks',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 16385,
          },
        ],
      },
      {
        apiType: 'anthropic',
        displayName: 'Anthropic Claude',
        description: 'Anthropic Claude models with advanced reasoning and extended context',
        models: [
          {
            id: 'claude-opus-4-6',
            displayName: 'Claude Opus 4.6',
            description: 'Most intelligent model for building agents and coding with adaptive thinking (200K context, 1M beta available)',
            recommended: true,
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: true,
            contextWindow: 200000,
          },
          {
            id: 'claude-sonnet-4-5',
            displayName: 'Claude Sonnet 4.5',
            description: 'Best combination of speed and intelligence with extended thinking (200K context, 1M beta available)',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: true,
            contextWindow: 200000,
          },
          {
            id: 'claude-haiku-4-5',
            displayName: 'Claude Haiku 4.5',
            description: 'Fastest model with near-frontier intelligence and extended thinking',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsReasoning: true,
            contextWindow: 200000,
          },
        ],
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
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 2000000,
          },
          {
            id: 'gemini-3-flash',
            displayName: 'Gemini 3 Flash',
            description: 'Most balanced model built for speed, scale, and frontier intelligence',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            description: 'Best price-performance model for large scale processing and agentic use',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-2.5-flash-lite',
            displayName: 'Gemini 2.5 Flash-Lite',
            description: 'Fastest flash model optimized for cost-efficiency and high throughput',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: false,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            description: 'Advanced thinking model for reasoning over complex problems',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 2000000,
          },
          {
            id: 'gemini-2.5-flash-image',
            displayName: 'Gemini 2.5 Flash Image (Nano Banana)',
            description: 'Fast and efficient image generation model optimized for high-volume, low-latency tasks',
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: true,
            supportsReasoning: false,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-3-pro-image-preview',
            displayName: 'Gemini 3 Pro Image Preview (Nano Banana Pro)',
            description: 'Professional image generation with advanced reasoning (thinking mode), up to 4K resolution, and Google Search grounding',
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: true,
            supportsReasoning: true,
            contextWindow: 2000000,
          },
        ],
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
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 131072,
          },
          {
            id: 'openai/gpt-oss-20b',
            displayName: 'OpenAI GPT-OSS 20B',
            description: 'Medium-sized open-weight model for low latency',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 131072,
          },
          {
            id: 'llama-3.3-70b-versatile',
            displayName: 'Llama 3.3 70B Versatile',
            description: 'Latest Llama model with balanced capabilities',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 131072,
          },
          {
            id: 'llama-3.1-70b-versatile',
            displayName: 'Llama 3.1 70B Versatile',
            description: 'Large model for complex tasks',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 131072,
          },
          {
            id: 'llama-3.1-8b-instant',
            displayName: 'Llama 3.1 8B Instant',
            description: 'Ultra-fast model for simple tasks',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: false,
            supportsReasoning: false,
            contextWindow: 131072,
          },
        ],
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
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 2000000,
          },
          {
            id: 'gemini-3-flash',
            displayName: 'Gemini 3 Flash',
            description: 'Most balanced model via Vertex AI',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-2.5-flash',
            displayName: 'Gemini 2.5 Flash',
            description: 'Fast model optimized for large scale processing',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            description: 'Advanced thinking model via Vertex AI',
            supportsToolCalling: true,
            supportsJsonOutput: true,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: false,
            supportsReasoning: true,
            contextWindow: 2000000,
          },
          {
            id: 'gemini-2.5-flash-image',
            displayName: 'Gemini 2.5 Flash Image (Nano Banana)',
            description: 'Fast and efficient image generation model via Vertex AI',
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: true,
            supportsReasoning: false,
            contextWindow: 1000000,
          },
          {
            id: 'gemini-3-pro-image-preview',
            displayName: 'Gemini 3 Pro Image Preview (Nano Banana Pro)',
            description: 'Professional image generation with thinking mode and up to 4K resolution via Vertex AI',
            supportsToolCalling: false,
            supportsJsonOutput: false,
            supportsStreaming: true,
            supportsVision: true,
            supportsImageGeneration: true,
            supportsReasoning: true,
            contextWindow: 2000000,
          },
        ],
      },
    ];
  }

  /**
   * Gets all storage provider information
   */
  private getStorageProviders(): StorageProviderInfo[] {
    return [
      {
        apiType: 's3',
        displayName: 'AWS S3 / MinIO',
        description: 'Amazon S3 compatible object storage (including MinIO and other S3-compatible services)',
        features: ['Signed URLs', 'Server-side encryption', 'ACL support', 'Custom endpoints for S3-compatible services'],
      },
      {
        apiType: 'azure-blob',
        displayName: 'Azure Blob Storage',
        description: 'Microsoft Azure Blob Storage service',
        features: ['SAS URLs', 'Access tiers (Hot/Cool/Archive)', 'Custom metadata', 'Custom endpoints'],
      },
      {
        apiType: 'gcs',
        displayName: 'Google Cloud Storage',
        description: 'Google Cloud Platform object storage',
        features: ['Signed URLs (v4)', 'Storage classes', 'Custom metadata', 'Service account authentication'],
      },
      {
        apiType: 'local',
        displayName: 'Local Filesystem',
        description: 'Local filesystem storage (for development and testing)',
        features: ['Token-based URLs', 'Metadata sidecar files', 'Configurable base path', 'Optional HTTP serving'],
      },
    ];
  }
}
