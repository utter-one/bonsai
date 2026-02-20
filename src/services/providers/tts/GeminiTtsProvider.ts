import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import type { AudioFormat } from '../../../types/audio';

extendZodWithOpenApi(z);

/**
 * Schema for Gemini TTS provider configuration
 */
export const geminiTtsProviderConfigSchema = z.object({
  apiKey: z.string().describe('API key for authenticating with Google Gemini API'),
});

export type GeminiTtsProviderConfig = z.infer<typeof geminiTtsProviderConfigSchema>;

/**
 * Schema for Gemini TTS settings
 */
export const geminiTtsSettingsSchema = z.object({
  provider: z.literal('gemini').describe('TTS provider type identifier'),
  model: z.string().optional().describe('Model ID to use for speech synthesis: "gemini-2.5-flash-preview-tts" (default) or "gemini-2.5-pro-preview-tts"'),
  voiceId: z.string().optional().describe('Voice ID to use (e.g., Kore, Puck, Zephyr, Leda, Aoede, etc.)'),
  audioFormat: z.enum(['pcm_24000']).optional().describe('Audio output format (Gemini TTS only supports PCM at 24kHz)'),
  prompt: z.string().optional().describe('Custom prompt template for controlling voice style, accent, pace, etc. Use {text} as placeholder for the text to be spoken. If not provided, text is sent directly without additional prompting.'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing, defaults to false for Gemini (optimal with full context)'),
}).openapi('GeminiTtsSettings');

export type GeminiTtsSettings = z.infer<typeof geminiTtsSettingsSchema>;

/**
 * Gemini TTS provider implementation
 * Provides text-to-speech synthesis using Google Gemini's TTS API via @google/genai SDK
 */
export class GeminiTtsProvider extends TtsProviderBase<GeminiTtsProviderConfig> {
  /** Google Gemini client instance */
  private client?: GoogleGenAI;

  /** Sentence splitter for processing streaming text */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Buffer for accumulating text when sentence splitter is disabled */
  private textBuffer: string = '';

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** TTS settings for this provider instance */
  private settings: GeminiTtsSettings;

  /** Audio output format for the current session */
  private audioFormat: AudioFormat = 'pcm_24000';

  /** Whether the generation session has started */
  private isStarted: boolean = false;

  /** Promise chain to ensure sequential chunk delivery */
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(config: GeminiTtsProviderConfig, settings: GeminiTtsSettings) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> {
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey });
    logger.info(`[Gemini TTS] Initialized with API key`);
  }

  /**
   * Gets the list of supported audio output formats for Gemini
   * Note: Gemini TTS API (unary mode) only outputs PCM at 24kHz, format selection is not supported
   */
  getSupportedFormats(): AudioFormat[] {
    return ['pcm_24000'];
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.isStarted = true;
    this.textBuffer = '';

    // Set default values
    const effectiveModel = this.settings.model ?? 'gemini-2.5-flash-preview-tts';
    const effectiveVoice = this.settings.voiceId ?? 'Kore';

    // Initialize sentence splitter with callback to synthesize complete sentences (if enabled)
    // Default to false for Gemini as it performs better with full context
    const useSentenceSplitter = this.settings.useSentenceSplitter ?? false;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        await this.synthesizeSentence(sentence);
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    // Gemini TTS only supports PCM at 24kHz
    this.audioFormat = this.settings.audioFormat ?? 'pcm_24000';

    logger.info(`[Gemini TTS] Starting speech generation with model: ${effectiveModel}, voice: ${effectiveVoice}, audioFormat: ${this.audioFormat}`);

    this.handleGenerationStarted();
  }

  /**
   * Stops and finalizes the speech generation session
   */
  async end(): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[Gemini TTS] No speech generation instance to end`);
      return;
    }

    // Finalize any remaining text in the sentence splitter
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    } else if (this.textBuffer.trim()) {
      // Synthesize buffered text when sentence splitter is disabled
      logger.info(`[Gemini TTS] Synthesizing buffered text: "${this.textBuffer}"`);
      await this.synthesizeSentence(this.textBuffer);
      this.textBuffer = '';
    }

    logger.info(`[Gemini TTS] Ending speech generation`);

    // Wait for all in-flight requests to complete
    await this.requestQueue;

    this.isStarted = false;
    this.handleGenerationEnded();
  }

  /**
   * Sends text to the speech generation service
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[Gemini TTS] Cannot send text, generation not started`);
      return;
    }

    if (this.sentenceSplitter) {
      logger.debug(`[Gemini TTS] Adding text to sentence splitter: "${text}"`);
      // Add text to sentence splitter - it will automatically call synthesizeSentence for each complete sentence
      await this.sentenceSplitter.addText(text);
    } else {
      logger.debug(`[Gemini TTS] Buffering text: "${text}"`);
      // Buffer text until end() is called to allow TTS provider to handle complete text
      this.textBuffer += text;
    }
  }

  /**
   * Synthesizes a single sentence by making an HTTP request to Gemini TTS API
   * @param text The sentence text to synthesize
   */
  private async synthesizeSentence(text: string): Promise<void> {
    // Apply no-speech marker filtering
    if (this.settings.noSpeechMarkers && this.settings.noSpeechMarkers.length > 0) {
      const startsInFilter = !!this.inNoSpeechSection;
      const { indexes, currentMarker } = this.getFilterIndexes(text, this.settings.noSpeechMarkers, this.inNoSpeechSection);
      this.inNoSpeechSection = currentMarker;

      if (currentMarker !== undefined || indexes.length !== 0) {
        const result = this.cutText(text, indexes, startsInFilter);
        text = result.join(' ');

        if (!text) {
          return;
        }
      }
    }

    // Apply text transformations
    if (this.settings.removeExclamationMarks) {
      text = text.replace(/!/g, '.');
    }

    // Skip empty text
    if (!text.trim()) {
      return;
    }

    logger.info(`[Gemini TTS] Synthesizing sentence: "${text}"`);

    // Chain this request to ensure sequential delivery
    this.requestQueue = this.requestQueue.then(async () => {
      try {
        await this.makeHttpRequest(text);
      } catch (error) {
        logger.error(`[Gemini TTS] Error synthesizing sentence: ${error.message}`);
        await this.handleError(error);
      }
    });
  }

  /**
   * Makes a request to Gemini TTS API using the @google/genai SDK
   * @param text The text to synthesize
   */
  private async makeHttpRequest(text: string): Promise<void> {
    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    const effectiveModel = this.settings.model ?? 'gemini-2.5-flash-preview-tts';
    const effectiveVoice = this.settings.voiceId ?? 'Kore';

    // Build the prompt using custom template or plain text
    let prompt: string;
    if (this.settings.prompt) {
      // Use custom prompt template, replacing {text} placeholder with actual text
      prompt = this.settings.prompt.replace(/\{text\}/g, text);
    } else {
      // Simple text without prompting directives
      prompt = text;
    }

    // Call Gemini API using SDK
    const response = await this.client.models.generateContent({
      model: effectiveModel,
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: effectiveVoice,
            },
          },
        },
      },
    });

    // Extract audio data from response
    // Response structure: { candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }] }
    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No candidates in Gemini TTS response');
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      throw new Error('No content parts in Gemini TTS response');
    }

    const part = candidate.content.parts[0];
    if (!(part as any).inlineData || !(part as any).inlineData.data) {
      throw new Error('No inline data in Gemini TTS response');
    }

    // Decode base64 audio data
    const audioBase64 = (part as any).inlineData.data;
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    logger.info(`[Gemini TTS] Received audio data: ${audioBuffer.length} bytes`);

    // Create and emit audio chunk
    const generatedChunk: GeneratedAudioChunk = {
      chunkId: this.generateChunkId(),
      ordinal: this.getNextOrdinal(),
      audio: audioBuffer,
      audioFormat: this.audioFormat,
      text: text,
      isFinal: false,
    };

    await this.handleSpeechGenerating(generatedChunk);
  }



  /**
   * Gets filter indexes for no-speech markers in text
   * @param text The text to analyze
   * @param markers The no-speech markers to look for
   * @param currentMarker The current marker being processed (if any)
   * @returns Object containing indexes and updated current marker
   */
  private getFilterIndexes(text: string, markers: NoSpeechMarker[], currentMarker?: NoSpeechMarker): { indexes: number[]; currentMarker?: NoSpeechMarker } {
    const indexes: number[] = [];
    let updatedMarker = currentMarker;

    for (let i = 0; i < text.length; i++) {
      if (updatedMarker) {
        let searchIndex = indexes.at(-1);
        searchIndex = searchIndex === undefined ? 0 : searchIndex + 1;
        const endId = text.indexOf(updatedMarker.end, searchIndex);
        if (endId !== -1) {
          indexes.push(endId);
          updatedMarker = undefined;
        }
      } else {
        let startId = -1;
        for (const m of markers) {
          let searchIndex = indexes.at(-1);
          searchIndex = searchIndex === undefined ? 0 : searchIndex + 1;
          const id = text.indexOf(m.start, searchIndex);
          if ((startId === -1 || startId > id) && id !== -1) {
            startId = id;
            updatedMarker = m;
          }
        }

        if (startId !== -1) {
          indexes.push(startId);
        }
      }
    }

    return { indexes, currentMarker: updatedMarker };
  }

  /**
   * Cuts text based on filter indexes, keeping only non-filtered sections
   * @param text The text to cut
   * @param indexes The filter boundary indexes
   * @param isInFilter Whether the text starts inside a filter section
   * @returns Array of non-filtered text sections
   */
  private cutText(text: string, indexes: number[], isInFilter: boolean): string[] {
    if (indexes.length === 0 && isInFilter) {
      return [];
    }

    const parts: string[] = [];
    if (!isInFilter) {
      indexes.unshift(-1);
    }

    for (let i = 0; i < indexes.length; i++) {
      const subStr = text.substring(indexes[i] + 1, indexes[i + 1] ?? 999);
      parts.push(subStr);
    }

    return parts.filter((p, id) => id % 2 === 0);
  }



  /**
   * Cleans up resources when the provider is no longer needed
   */
  async cleanup(): Promise<void> {
    if (this.sentenceSplitter) {
      this.sentenceSplitter.clear();
      this.sentenceSplitter = null;
    }

    this.inNoSpeechSection = undefined;
    this.isStarted = false;
    this.textBuffer = '';
    this.client = undefined;

    await super.cleanup();
  }
}
