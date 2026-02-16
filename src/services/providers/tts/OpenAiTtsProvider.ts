import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import type { AudioFormat } from '../../../types/audio';

extendZodWithOpenApi(z);

/**
 * Schema for OpenAI TTS provider configuration
 */
export const openAiTtsProviderConfigSchema = z.object({
  apiKey: z.string().describe('API key for authenticating with OpenAI'),
});

export type OpenAiTtsProviderConfig = z.infer<typeof openAiTtsProviderConfigSchema>;

/**
 * Schema for OpenAI TTS settings
 */
export const openAiTtsSettingsSchema = z.object({
  model: z.string().optional().describe('Model ID to use for speech synthesis: "gpt-4o-mini-tts" (promptable), "tts-1" (low latency), or "tts-1-hd" (high quality)'),
  voiceId: z.string().optional().describe('Voice ID to use (alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar)'),
  audioFormat: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm_24000']).optional().describe('Preferred audio output format for synthesized speech'),
  speed: z.number().min(0.25).max(4.0).optional().describe('Speech speed (0.25-4.0), defaults to 1.0'),
  instructions: z.string().optional().describe('Voice control instructions for gpt-4o-mini-tts model. Controls accent, tone, emotion, speed, whispering, etc. Only supported by gpt-4o-mini-tts model'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing, defaults to true'),
}).openapi('OpenAiTtsSettings');

export type OpenAiTtsSettings = z.infer<typeof openAiTtsSettingsSchema>;

/**
 * OpenAI TTS provider implementation
 * Provides text-to-speech synthesis using OpenAI's TTS API with HTTP streaming
 */
export class OpenAiTtsProvider extends TtsProviderBase<OpenAiTtsProviderConfig> {
  /** Sentence splitter for processing streaming text */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** TTS settings for this provider instance */
  private settings: OpenAiTtsSettings;

  /** Audio output format for the current session */
  private audioFormat: AudioFormat = 'pcm_24000';

  /** Whether the generation session has started */
  private isStarted: boolean = false;

  /** Set of active HTTP request abort controllers for cleanup */
  private activeRequests: Set<AbortController> = new Set();

  /** Promise chain to ensure sequential chunk delivery */
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(config: OpenAiTtsProviderConfig, settings: OpenAiTtsSettings) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> { }

  /**
   * Gets the list of supported audio output formats for OpenAI
   */
  getSupportedFormats(): AudioFormat[] {
    return ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm_24000'];
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.isStarted = true;

    // Set default values
    const effectiveModel = this.settings.model ?? 'gpt-4o-mini-tts';
    const effectiveVoice = this.settings.voiceId ?? 'alloy';
    const effectiveSpeed = this.settings.speed ?? 1.0;

    // Validate instructions only used with gpt-4o-mini-tts
    if (this.settings.instructions && effectiveModel !== 'gpt-4o-mini-tts') {
      logger.warn(`[OpenAI TTS] Instructions parameter is only supported by gpt-4o-mini-tts model, ignoring for ${effectiveModel}`);
    }

    // Initialize sentence splitter with callback to synthesize complete sentences (if enabled)
    const useSentenceSplitter = this.settings.useSentenceSplitter ?? true;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        await this.synthesizeSentence(sentence);
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    this.audioFormat = this.resolveAudioFormat(this.settings.audioFormat);

    logger.info(`[OpenAI TTS] Starting speech generation with model: ${effectiveModel}, voice: ${effectiveVoice}, speed: ${effectiveSpeed}, audioFormat: ${this.audioFormat}`);

    this.handleGenerationStarted();
  }

  /**
   * Stops and finalizes the speech generation session
   */
  async end(): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[OpenAI TTS] No speech generation instance to end`);
      return;
    }

    // Finalize any remaining text in the sentence splitter
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    }

    logger.info(`[OpenAI TTS] Ending speech generation`);

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
      logger.warn(`[OpenAI TTS] Cannot send text, generation not started`);
      return;
    }

    if (this.sentenceSplitter) {
      logger.debug(`[OpenAI TTS] Adding text to sentence splitter: "${text}"`);
      // Add text to sentence splitter - it will automatically call synthesizeSentence for each complete sentence
      await this.sentenceSplitter.addText(text);
    } else {
      logger.debug(`[OpenAI TTS] Synthesizing text directly: "${text}"`);
      // Synthesize text directly without sentence splitting
      await this.synthesizeSentence(text);
    }
  }

  /**
   * Synthesizes a single sentence by making an HTTP request to OpenAI TTS API
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

    logger.info(`[OpenAI TTS] Synthesizing sentence: "${text}"`);

    // Create abort controller for this request
    const abortController = new AbortController();
    this.activeRequests.add(abortController);

    // Chain this request to ensure sequential delivery
    this.requestQueue = this.requestQueue.then(async () => {
      try {
        await this.makeHttpRequest(text, abortController);
      } catch (error) {
        if (error.name !== 'AbortError') {
          logger.error(`[OpenAI TTS] Error synthesizing sentence: ${error.message}`);
          await this.handleError(error);
        }
      } finally {
        this.activeRequests.delete(abortController);
      }
    });
  }

  /**
   * Makes an HTTP streaming request to OpenAI TTS API
   * @param text The text to synthesize
   * @param abortController Abort controller for cancelling the request
   */
  private async makeHttpRequest(text: string, abortController: AbortController): Promise<void> {
    const effectiveModel = this.settings.model ?? 'gpt-4o-mini-tts';
    const effectiveVoice = this.settings.voiceId ?? 'alloy';
    const effectiveSpeed = this.settings.speed ?? 1.0;

    // Build request body
    const requestBody: any = {
      model: effectiveModel,
      voice: effectiveVoice,
      input: text,
      response_format: this.mapAudioFormat(this.audioFormat),
      speed: effectiveSpeed,
    };

    // Add instructions only for gpt-4o-mini-tts
    if (effectiveModel === 'gpt-4o-mini-tts' && this.settings.instructions) {
      requestBody.instructions = this.settings.instructions;
    }

    // Make streaming HTTP request
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS API error (${response.status}): ${errorText}`);
    }

    // Read the streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    // Concatenate all chunks into a single buffer
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const audioBuffer = Buffer.alloc(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audioBuffer.set(chunk, offset);
      offset += chunk.length;
    }

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
   * Maps internal audio format to OpenAI API format string
   * @param format Internal audio format
   * @returns OpenAI API format string
   */
  private mapAudioFormat(format: AudioFormat): string {
    if (format === 'pcm_24000') {
      return 'pcm';
    }
    return format; // mp3, opus, aac, flac, wav map directly
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
   * Resolves the requested audio format to a supported format
   * @param requestedFormat Optional requested audio format
   * @returns Supported audio format to use for output
   */
  private resolveAudioFormat(requestedFormat?: AudioFormat): AudioFormat {
    const supportedFormats = this.getSupportedFormats();
    if (!requestedFormat) {
      return 'pcm_24000'; // Default to OpenAI's native PCM format
    }

    if (supportedFormats.includes(requestedFormat)) {
      return requestedFormat;
    }

    logger.warn(`[OpenAI TTS] Requested audio format ${requestedFormat} is not supported. Falling back to pcm_24000.`);
    return 'pcm_24000';
  }

  /**
   * Cleans up resources when the provider is no longer needed
   */
  async cleanup(): Promise<void> {
    // Abort all active HTTP requests
    for (const controller of this.activeRequests) {
      controller.abort();
    }
    this.activeRequests.clear();

    if (this.sentenceSplitter) {
      this.sentenceSplitter.clear();
      this.sentenceSplitter = null;
    }

    this.inNoSpeechSection = undefined;
    this.isStarted = false;

    await super.cleanup();
  }
}
