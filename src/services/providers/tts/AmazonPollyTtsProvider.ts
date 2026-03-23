import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import type { AudioFormat } from '../../../types/audio';

extendZodWithOpenApi(z);

/**
 * Schema for Amazon Polly TTS provider configuration
 */
export const amazonPollyTtsProviderConfigSchema = z.strictObject({
  region: z.string().describe('AWS region where Amazon Polly is available (e.g., "us-east-1", "eu-west-1")'),
  accessKeyId: z.string().describe('AWS access key ID for authenticating with Amazon Polly'),
  secretAccessKey: z.string().describe('AWS secret access key for authenticating with Amazon Polly'),
});

export type AmazonPollyTtsProviderConfig = z.infer<typeof amazonPollyTtsProviderConfigSchema>;

/**
 * Schema for Amazon Polly TTS settings
 */
export const amazonPollyTtsSettingsSchema = z.object({
  provider: z.literal('amazon-polly').describe('TTS provider type identifier'),
  voiceId: z.string().optional().describe('Voice ID to use for speech synthesis (e.g., "Joanna", "Matthew", "Amy"). Defaults to "Joanna"'),
  engine: z.enum(['standard', 'neural', 'long-form', 'generative']).optional().describe('Polly engine to use. "neural" provides higher quality, "long-form" supports longer texts, "generative" provides most natural speech. Defaults to "neural"'),
  languageCode: z.string().optional().describe('BCP-47 language code (e.g., "en-US", "en-GB", "es-ES"). By default inferred from the selected voice'),
  audioFormat: z.enum(['mp3', 'pcm_8000', 'pcm_16000']).optional().describe('Preferred audio output format. "mp3" for compressed audio, "pcm_8000" or "pcm_16000" for raw PCM. Defaults to "pcm_16000"'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to split text into sentences and synthesize each individually. Defaults to false (full text is synthesized when end() is called)'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
}).openapi('AmazonPollyTtsSettings');

export type AmazonPollyTtsSettings = z.infer<typeof amazonPollyTtsSettingsSchema>;

/**
 * Amazon Polly TTS provider implementation
 * Provides text-to-speech synthesis using AWS Amazon Polly.
 * Since Polly does not support streaming input, text is accumulated and synthesized in batch
 * when end() is called (or per-sentence when useSentenceSplitter is enabled).
 */
export class AmazonPollyTtsProvider extends TtsProviderBase<AmazonPollyTtsProviderConfig> {
  /** Amazon Polly client instance */
  private pollyClient: PollyClient | null = null;

  /** Sentence splitter for processing streaming text */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Buffer for accumulating text when sentence splitter is disabled */
  private textBuffer: string = '';

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** TTS settings for this provider instance */
  private settings: AmazonPollyTtsSettings;

  /** Audio output format for the current session */
  private audioFormat: AudioFormat = 'pcm_16000';

  /** Whether the generation session has started */
  private isStarted: boolean = false;

  /** Promise chain to ensure sequential chunk delivery */
  private requestQueue: Promise<void> = Promise.resolve();

  /**
   * Creates a new Amazon Polly TTS provider instance
   * @param config Provider configuration with AWS credentials and region
   * @param settings TTS-specific settings (voice, engine, format, etc.)
   */
  constructor(config: AmazonPollyTtsProviderConfig, settings: AmazonPollyTtsSettings) {
    super(config);
    this.settings = settings;
  }

  /**
   * Initializes the Amazon Polly client with configured credentials
   */
  async init(): Promise<void> {
    if (!this.config.region || !this.config.accessKeyId || !this.config.secretAccessKey) {
      const errorMessage = 'Missing required Amazon Polly configuration (region, accessKeyId, or secretAccessKey)';
      logger.error(`[Amazon Polly TTS] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    this.pollyClient = new PollyClient({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    });

    logger.info(`[Amazon Polly TTS] Initialized with region: ${this.config.region}`);
  }

  /**
   * Gets the list of supported audio output formats for Amazon Polly
   */
  getSupportedFormats(): AudioFormat[] {
    return ['mp3', 'pcm_8000', 'pcm_16000'];
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    if (!this.pollyClient) {
      throw new Error('Amazon Polly client not initialized. Call init() first.');
    }

    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.isStarted = true;
    this.textBuffer = '';
    this.requestQueue = Promise.resolve();

    this.audioFormat = this.resolveAudioFormat(this.preferredOutputFormat ?? this.settings.audioFormat);

    const useSentenceSplitter = this.settings.useSentenceSplitter ?? false;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        await this.synthesizeSentence(sentence);
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    const effectiveVoice = this.settings.voiceId ?? 'Joanna';
    const effectiveEngine = this.settings.engine ?? 'neural';
    logger.info(`[Amazon Polly TTS] Starting speech generation with voice: ${effectiveVoice}, engine: ${effectiveEngine}, audioFormat: ${this.audioFormat}`);

    this.handleGenerationStarted();
  }

  /**
   * Stops and finalizes the speech generation session.
   * Flushes remaining buffered text and synthesizes it before ending.
   */
  async end(): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[Amazon Polly TTS] No speech generation instance to end`);
      return;
    }

    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    } else if (this.textBuffer.trim()) {
      logger.info(`[Amazon Polly TTS] Synthesizing buffered text: "${this.textBuffer}"`);
      await this.synthesizeSentence(this.textBuffer);
      this.textBuffer = '';
    }

    logger.info(`[Amazon Polly TTS] Ending speech generation`);

    // Wait for all queued synthesis requests to complete
    await this.requestQueue;

    this.isStarted = false;
    this.handleGenerationEnded();
  }

  /**
   * Sends text to be converted to speech.
   * Text is buffered until end() is called (or per sentence when sentence splitter is enabled).
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[Amazon Polly TTS] Cannot send text, generation not started`);
      return;
    }

    if (this.sentenceSplitter) {
      logger.debug(`[Amazon Polly TTS] Adding text to sentence splitter: "${text}"`);
      await this.sentenceSplitter.addText(text);
    } else {
      logger.debug(`[Amazon Polly TTS] Buffering text: "${text}"`);
      this.textBuffer += text;
    }
  }

  /**
   * Queues a single text segment for synthesis and emits resulting audio chunks
   * @param text The text to synthesize
   */
  private async synthesizeSentence(text: string): Promise<void> {
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

    if (this.settings.removeExclamationMarks) {
      text = text.replace(/!/g, '.');
    }

    if (!text.trim()) {
      return;
    }

    logger.info(`[Amazon Polly TTS] Queuing sentence for synthesis: "${text}"`);

    // Chain request to ensure sequential audio chunk delivery
    this.requestQueue = this.requestQueue.then(async () => {
      try {
        await this.performSynthesis(text);
      } catch (error) {
        logger.error(`[Amazon Polly TTS] Error synthesizing sentence: ${error instanceof Error ? error.message : String(error)}`);
        await this.handleError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Calls the Amazon Polly SynthesizeSpeech API and emits audio chunks as they arrive.
   * Uses a rolling buffer to emit fixed-size chunks without waiting for the full response.
   * @param text The text to synthesize
   */
  private async performSynthesis(text: string): Promise<void> {
    if (!this.pollyClient) {
      throw new Error('Amazon Polly client not initialized');
    }

    const effectiveVoice = this.settings.voiceId ?? 'Joanna';
    const effectiveEngine = this.settings.engine ?? 'neural';
    const { outputFormat, sampleRate } = this.mapAudioFormat(this.audioFormat);

    logger.info(`[Amazon Polly TTS] Calling SynthesizeSpeech for: "${text}"`);

    const command = new SynthesizeSpeechCommand({
      Text: text,
      VoiceId: effectiveVoice as any,
      Engine: effectiveEngine as any,
      OutputFormat: outputFormat,
      SampleRate: sampleRate,
      ...(this.settings.languageCode ? { LanguageCode: this.settings.languageCode as any } : {}),
    });

    const response = await this.pollyClient.send(command);

    if (!response.AudioStream) {
      throw new Error('Amazon Polly returned no audio stream');
    }

    const chunkSize = 4096;
    let buffer = Buffer.alloc(0);
    let totalBytes = 0;

    for await (const incoming of response.AudioStream as AsyncIterable<Uint8Array>) {
      buffer = Buffer.concat([buffer, incoming]);
      totalBytes += incoming.length;

      while (buffer.length >= chunkSize) {
        const chunk = buffer.subarray(0, chunkSize);
        buffer = buffer.subarray(chunkSize);

        const generatedChunk: GeneratedAudioChunk = {
          chunkId: this.generateChunkId(),
          ordinal: this.getNextOrdinal(),
          audio: chunk,
          audioFormat: this.audioFormat,
          text: text,
          isFinal: false,
        };
        logger.debug(`[Amazon Polly TTS] Emitting audio chunk: ${chunk.length} bytes, ordinal: ${generatedChunk.ordinal}`);
        await this.handleSpeechGenerating(generatedChunk);
      }
    }

    // Emit any remaining bytes below chunkSize
    if (buffer.length > 0) {
      const generatedChunk: GeneratedAudioChunk = {
        chunkId: this.generateChunkId(),
        ordinal: this.getNextOrdinal(),
        audio: buffer,
        audioFormat: this.audioFormat,
        text: text,
        isFinal: false,
      };
      logger.debug(`[Amazon Polly TTS] Emitting final audio chunk: ${buffer.length} bytes, ordinal: ${generatedChunk.ordinal}`);
      await this.handleSpeechGenerating(generatedChunk);
    }

    // Emit final marker chunk
    const finalChunk: GeneratedAudioChunk = {
      chunkId: this.generateChunkId(),
      ordinal: this.getNextOrdinal(),
      audio: Buffer.alloc(0),
      audioFormat: this.audioFormat,
      text: text,
      isFinal: true,
    };
    await this.handleSpeechGenerating(finalChunk);

    logger.info(`[Amazon Polly TTS] Synthesis completed for: "${text}" (${totalBytes} total bytes)`);
  }

  /**
   * Maps internal AudioFormat to Amazon Polly output format and sample rate parameters
   * @param format Internal audio format identifier
   * @returns Polly API output format string and optional sample rate
   */
  private mapAudioFormat(format: AudioFormat): { outputFormat: 'mp3' | 'pcm'; sampleRate?: string } {
    switch (format) {
      case 'mp3':
        return { outputFormat: 'mp3' };
      case 'pcm_8000':
        return { outputFormat: 'pcm', sampleRate: '8000' };
      case 'pcm_16000':
        return { outputFormat: 'pcm', sampleRate: '16000' };
      default:
        logger.warn(`[Amazon Polly TTS] Unsupported audio format: ${format}, defaulting to pcm 16000`);
        return { outputFormat: 'pcm', sampleRate: '16000' };
    }
  }

  /**
   * Resolves the requested audio format to a supported format
   * @param requestedFormat Optional requested audio format
   * @returns Supported audio format to use for output
   */
  private resolveAudioFormat(requestedFormat?: AudioFormat): AudioFormat {
    if (!requestedFormat) {
      return 'pcm_16000';
    }
    return requestedFormat;
  }

  /**
   * Gets filter indexes for no-speech markers in text
   * @param text The text to analyze
   * @param markers The no-speech markers to look for
   * @param currentMarker The current marker being processed (if any)
   * @returns Object containing boundary indexes and updated current marker
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

    this.pollyClient = null;
    this.textBuffer = '';
    this.isStarted = false;
    this.inNoSpeechSection = undefined;

    await super.cleanup();
  }
}
