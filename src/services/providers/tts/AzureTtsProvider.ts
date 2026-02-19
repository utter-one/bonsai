import * as azureSDK from 'microsoft-cognitiveservices-speech-sdk';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import type { AudioFormat } from '../../../types/audio';

extendZodWithOpenApi(z);

/**
 * Schema for Azure TTS provider configuration
 */
export const azureTtsProviderConfigSchema = z.object({
  region: z.string().describe('The Azure region to use for the speech service (e.g., "eastus", "westeurope")'),
  subscriptionKey: z.string().describe('The subscription key to use for the speech service'),
});

export type AzureTtsProviderConfig = z.infer<typeof azureTtsProviderConfigSchema>;

/**
 * Schema for Azure TTS settings
 */
export const azureTtsSettingsSchema = z.object({
  provider: z.literal('azure').describe('TTS provider type identifier'),
  model: z.enum(['neural']).optional().describe('Azure TTS model to use. Currently only "neural" is supported for high-quality neural text-to-speech'),
  voiceId: z.string().optional().describe('Voice name to use for speech synthesis (e.g., "en-US-AriaNeural", "en-US-GuyNeural")'),
  audioFormat: z.enum(['pcm_16000', 'pcm_24000', 'pcm_48000', 'opus', 'mp3', 'mulaw', 'alaw']).optional().describe('Preferred audio output format for synthesized speech. Defaults to "pcm_24000"'),
  style: z.string().optional().describe('Speaking style for voices that support it (e.g., "cheerful", "sad", "angry", "friendly")'),
  rate: z.string().optional().describe('Speaking rate adjustment (e.g., "+10%", "-5%", "1.2"). Range: 0.5 to 2.0 or percentage'),
  pitch: z.string().optional().describe('Pitch adjustment (e.g., "+5%", "-10%", "high", "low"). Range typically -50% to +50%'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing. Defaults to true'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
}).openapi('AzureTtsSettings');

export type AzureTtsSettings = z.infer<typeof azureTtsSettingsSchema>;

/**
 * Azure TTS provider implementation
 * Provides text-to-speech synthesis using Microsoft Azure Cognitive Services TTS with streaming support
 */
export class AzureTtsProvider extends TtsProviderBase<AzureTtsProviderConfig> {
  /** Sentence splitter for processing streaming text */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Buffer for accumulating text when sentence splitter is disabled */
  private textBuffer: string = '';

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** TTS settings for this provider instance */
  private settings: AzureTtsSettings;

  /** Audio output format for the current session */
  private audioFormat: AudioFormat = 'pcm_24000';

  /** Whether the generation session has started */
  private isStarted: boolean = false;

  /** Azure Speech configuration */
  private speechConfig?: azureSDK.SpeechConfig;

  /** Queue of text items waiting to be synthesized */
  private synthesisQueue: string[] = [];

  /** Whether synthesis is currently in progress */
  private isProcessing: boolean = false;

  constructor(config: AzureTtsProviderConfig, settings: AzureTtsSettings) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> {
    // Check if the required configuration is present
    if (!this.config.subscriptionKey || !this.config.region) {
      const errorMessage = 'Missing required Azure Speech configuration (subscription key or region)';
      logger.error(`[Azure TTS] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    // Create Azure Speech configuration
    this.speechConfig = azureSDK.SpeechConfig.fromSubscription(
      this.config.subscriptionKey,
      this.config.region
    );

    // Set voice name if provided
    const voiceName = this.settings.voiceId || 'en-US-AriaNeural';
    this.speechConfig.speechSynthesisVoiceName = voiceName;

    logger.info(`[Azure TTS] Initialized with voice: ${voiceName}, region: ${this.config.region}`);
  }

  /**
   * Gets the list of supported audio output formats for Azure TTS
   */
  getSupportedFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_24000', 'pcm_48000', 'opus', 'mp3', 'mulaw', 'alaw'];
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    if (!this.speechConfig) {
      throw new Error('Azure Speech config not initialized. Call init() first.');
    }

    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.isStarted = true;
    this.textBuffer = '';
    this.synthesisQueue = [];
    this.isProcessing = false;

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

    // Resolve audio format
    this.audioFormat = this.resolveAudioFormat(this.settings.audioFormat);

    // Map audio format to Azure's output format enum
    this.speechConfig.speechSynthesisOutputFormat = this.mapAudioFormatToAzure(this.audioFormat);

    const voiceName = this.settings.voiceId || 'en-US-AriaNeural';
    logger.info(`[Azure TTS] Starting speech generation with voice: ${voiceName}, audioFormat: ${this.audioFormat}`);

    this.handleGenerationStarted();
  }

  /**
   * Stops and finalizes the speech generation session
   */
  async end(): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[Azure TTS] No speech generation instance to end`);
      return;
    }

    // Finalize any remaining text in the sentence splitter
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    } else if (this.textBuffer.trim()) {
      // Synthesize buffered text when sentence splitter is disabled
      logger.info(`[Azure TTS] Synthesizing buffered text: "${this.textBuffer}"`);
      await this.synthesizeSentence(this.textBuffer);
      this.textBuffer = '';
    }

    logger.info(`[Azure TTS] Ending speech generation`);

    // Ensure all queued synthesis is processed before ending
    await this.processQueue();

    this.isStarted = false;
    this.handleGenerationEnded();
  }

  /**
   * Sends text to the speech generation service
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    if (!this.isStarted) {
      logger.warn(`[Azure TTS] Cannot send text, generation not started`);
      return;
    }

    if (this.sentenceSplitter) {
      logger.debug(`[Azure TTS] Adding text to sentence splitter: "${text}"`);
      // Add text to sentence splitter - it will automatically call synthesizeSentence for each complete sentence
      await this.sentenceSplitter.addText(text);
    } else {
      logger.debug(`[Azure TTS] Buffering text: "${text}"`);
      // Buffer text until end() is called to allow TTS provider to handle complete text
      this.textBuffer += text;
    }
  }

  /**
   * Synthesizes a single sentence using Azure TTS streaming API
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

    logger.info(`[Azure TTS] Queueing sentence for synthesis: "${text}"`);

    // Add to queue and start processing if not already running
    this.synthesisQueue.push(text);
    this.processQueue();
  }

  /**
   * Processes the synthesis queue sequentially
   */
  private async processQueue(): Promise<void> {
    // If already processing or queue is empty, return
    if (this.isProcessing || this.synthesisQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.synthesisQueue.length > 0) {
      const text = this.synthesisQueue.shift();
      if (text) {
        logger.info(`[Azure TTS] Processing synthesis for queued sentence: "${text}"`);
        try {
          await this.performSynthesis(text);
          logger.info(`[Azure TTS] Finished synthesis for queued sentence: "${text}"`);
        } catch (error) {
          logger.error(`[Azure TTS] Error processing queued synthesis: ${error}`);
          await this.handleError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    }

    this.isProcessing = false;
  }

  /**
   * Performs the actual synthesis using Azure SDK
   * @param text The text to synthesize
   */
  private async performSynthesis(text: string): Promise<void> {
    if (!this.speechConfig) {
      throw new Error('Speech config not initialized');
    }

    logger.info(`[Azure TTS] Starting synthesis for: "${text}"`);

    // Create synthesizer with null audio config to get audio data directly in result
    const synthesizer = new azureSDK.SpeechSynthesizer(this.speechConfig, undefined);

    return new Promise<void>((resolve, reject) => {
      // Build SSML if style or rate/pitch are specified
      const ssml = this.buildSSML(text);

      // Handler for successful synthesis
      const handleResult = (result: azureSDK.SpeechSynthesisResult) => {
        if (result.reason === azureSDK.ResultReason.SynthesizingAudioCompleted) {
          logger.debug(`[Azure TTS] Synthesis result received with ${result.audioData.byteLength} bytes`);

          // Convert ArrayBuffer to Buffer and emit as chunks
          this.emitAudioChunks(Buffer.from(result.audioData), text)
            .then(() => {
              synthesizer.close();
              resolve();
            })
            .catch((err) => {
              logger.error(`[Azure TTS] Error emitting audio chunks: ${err}`);
              synthesizer.close();
              reject(err);
            });
        } else {
          logger.error(`[Azure TTS] Synthesis failed: ${result.errorDetails}`);
          synthesizer.close();
          reject(new Error(`Synthesis failed: ${result.errorDetails}`));
        }
      };

      // Handler for synthesis error
      const handleError = (error: string) => {
        logger.error(`[Azure TTS] Synthesis error: ${error}`);
        this.handleError(new Error(error)).finally(() => {
          synthesizer.close();
          reject(new Error(error));
        });
      };

      // Start synthesis
      if (ssml) {
        logger.debug(`[Azure TTS] Synthesizing with SSML`);
        synthesizer.speakSsmlAsync(ssml, handleResult, handleError);
      } else {
        synthesizer.speakTextAsync(text, handleResult, handleError);
      }
    });
  }

  /**
   * Emits audio data as chunks to consumers
   * @param audioData Complete audio buffer from synthesis
   * @param text The text that was synthesized
   */
  private async emitAudioChunks(audioData: Buffer, text: string): Promise<void> {
    const chunkSize = 4096;
    let offset = 0;

    // Emit audio in chunks
    while (offset < audioData.length) {
      const chunk = audioData.slice(offset, offset + chunkSize);

      const generatedChunk: GeneratedAudioChunk = {
        chunkId: this.generateChunkId(),
        ordinal: this.getNextOrdinal(),
        audio: chunk,
        audioFormat: this.audioFormat,
        text: text,
        isFinal: false,
      };

      logger.debug(`[Azure TTS] Emitting audio chunk: ${chunk.length} bytes, ordinal: ${generatedChunk.ordinal}`);
      await this.handleSpeechGenerating(generatedChunk);

      offset += chunkSize;
    }

    // Send final marker
    const finalChunk: GeneratedAudioChunk = {
      chunkId: this.generateChunkId(),
      ordinal: this.getNextOrdinal(),
      audio: Buffer.alloc(0),
      audioFormat: this.audioFormat,
      text: text,
      isFinal: true,
    };
    await this.handleSpeechGenerating(finalChunk);

    logger.info(`[Azure TTS] Synthesis completed for: "${text}" (${audioData.length} total bytes)`);
  }

  /**
   * Builds SSML for advanced voice settings
   * @param text The text to wrap in SSML
   * @returns SSML string or null if no special settings
   */
  private buildSSML(text: string): string | null {
    const hasStyle = !!this.settings.style;
    const hasRate = !!this.settings.rate;
    const hasPitch = !!this.settings.pitch;

    if (!hasStyle && !hasRate && !hasPitch) {
      return null;
    }

    const voiceName = this.settings.voiceId || 'en-US-AriaNeural';
    let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">`;
    ssml += `<voice name="${voiceName}">`;

    // Add style if specified
    if (hasStyle) {
      ssml += `<mstts:express-as style="${this.settings.style}">`;
    }

    // Add prosody for rate/pitch if specified
    if (hasRate || hasPitch) {
      ssml += '<prosody';
      if (hasRate) {
        ssml += ` rate="${this.settings.rate}"`;
      }
      if (hasPitch) {
        ssml += ` pitch="${this.settings.pitch}"`;
      }
      ssml += '>';
    }

    // Add the text (escape XML special characters)
    ssml += this.escapeXml(text);

    // Close prosody
    if (hasRate || hasPitch) {
      ssml += '</prosody>';
    }

    // Close style
    if (hasStyle) {
      ssml += '</mstts:express-as>';
    }

    ssml += '</voice></speak>';

    return ssml;
  }

  /**
   * Escapes XML special characters
   * @param text The text to escape
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Maps internal audio format to Azure's SpeechSynthesisOutputFormat enum
   * @param format The internal audio format
   */
  private mapAudioFormatToAzure(format: AudioFormat): azureSDK.SpeechSynthesisOutputFormat {
    switch (format) {
      case 'pcm_16000':
        return azureSDK.SpeechSynthesisOutputFormat.Raw16Khz16BitMonoPcm;
      case 'pcm_24000':
        return azureSDK.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
      case 'pcm_48000':
        return azureSDK.SpeechSynthesisOutputFormat.Raw48Khz16BitMonoPcm;
      case 'opus':
        return azureSDK.SpeechSynthesisOutputFormat.Ogg24Khz16BitMonoOpus;
      case 'mp3':
        return azureSDK.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3;
      case 'mulaw':
        return azureSDK.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoMULaw;
      case 'alaw':
        return azureSDK.SpeechSynthesisOutputFormat.Raw8Khz8BitMonoALaw;
      default:
        logger.warn(`[Azure TTS] Unsupported audio format: ${format}, defaulting to pcm_24000`);
        return azureSDK.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
    }
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
      return 'pcm_24000'; // Default to 24kHz PCM
    }

    if (supportedFormats.includes(requestedFormat)) {
      return requestedFormat;
    }

    logger.warn(`[Azure TTS] Requested audio format ${requestedFormat} is not supported. Falling back to pcm_24000.`);
    return 'pcm_24000';
  }
}
