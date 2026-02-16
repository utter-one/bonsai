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
}
