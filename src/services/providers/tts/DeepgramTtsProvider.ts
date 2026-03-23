import WebSocket from 'ws';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import type { AudioFormat } from '../../../types/audio';

extendZodWithOpenApi(z);

/**
 * Schema for Deepgram TTS provider configuration
 */
export const deepgramTtsProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('API key for authenticating with Deepgram'),
});

export type DeepgramTtsProviderConfig = z.infer<typeof deepgramTtsProviderConfigSchema>;

/**
 * Schema for Deepgram TTS settings
 */
export const deepgramTtsSettingsSchema = z.object({
  provider: z.literal('deepgram').describe('TTS provider type identifier'),
  model: z.enum(['aura-1', 'aura-2']).optional().describe('Model version to use ("aura-1" or "aura-2")'),
  voiceId: z.string().optional().describe('Voice ID to use for speech synthesis (e.g., "thalia-en", "andromeda-en"). Combined with model to form full model string (e.g., "aura-2-thalia-en")'),
  audioFormat: z.enum(['pcm_8000', 'pcm_16000', 'pcm_24000', 'pcm_48000', 'mulaw', 'alaw']).optional().describe('Preferred audio output format. Defaults to "pcm_16000"'),  
  sampleRate: z.number().int().positive().optional().describe('Sample rate for audio output in Hz (e.g., 8000, 16000, 24000, 48000). Availability depends on audio format'),
  bitRate: z.number().int().positive().optional().describe('Bit rate for audio output (e.g., 32000, 64000, 128000). Applies to certain formats like mp3, opus, aac'),
  container: z.enum(['none', 'wav', 'ogg']).optional().describe('Audio container format. Use "none" for raw audio, "wav" for WAV container, "ogg" for Ogg container'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing, defaults to true'),
}).openapi('DeepgramTtsSettings');

export type DeepgramTtsSettings = z.infer<typeof deepgramTtsSettingsSchema>;

/**
 * Deepgram-specific audio chunk with provider metadata
 */
export type DeepgramAudioChunk = GeneratedAudioChunk & {
  /** Sample rate in Hz for this audio chunk */
  sampleRate: number;
  /** Bit rate in bits per second for this audio chunk */
  bitRate?: number;
};

/**
 * Deepgram message types
 */
interface DeepgramSpeakMessage {
  type: 'Speak';
  text: string;
}

interface DeepgramFlushMessage {
  type: 'Flush';
}

interface DeepgramCloseMessage {
  type: 'Close';
}

type DeepgramMessage = DeepgramSpeakMessage | DeepgramFlushMessage | DeepgramCloseMessage;

/**
 * Deepgram TTS provider implementation
 * Provides real-time text-to-speech synthesis using Deepgram Aura streaming API
 */
export class DeepgramTtsProvider extends TtsProviderBase<DeepgramTtsProviderConfig, DeepgramAudioChunk> {
  /** WebSocket connection to Deepgram streaming API */
  private socket: WebSocket | null = null;

  /** Sentence splitter for processing streaming text */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Buffer for accumulating text when sentence splitter is disabled */
  private textBuffer: string = '';

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** TTS settings for this provider instance */
  private settings: DeepgramTtsSettings;

  /** Audio output format for the current session */
  private audioFormat: AudioFormat = 'pcm_16000';

  /** Sample rate for audio output */
  private sampleRate: number = 24000;

  /** Bit rate for audio output (optional) */
  private bitRate?: number;

  /** Container format (optional) */
  private container?: string;

  /** Buffer for the first audio chunk to avoid playback timing issues */
  private firstChunkBuffer: DeepgramAudioChunk | null = null;

  /** Track flush count for rate limiting (20 flushes per 60 seconds) */
  private flushTimestamps: number[] = [];

  /** Maximum flushes allowed per time window */
  private readonly MAX_FLUSHES = 20;

  /** Time window for flush rate limiting in milliseconds */
  private readonly FLUSH_WINDOW_MS = 60000;

  /** Maximum text length per Speak message (Deepgram limit: 2000) */
  private readonly MAX_TEXT_LENGTH = 2000;

  /** Whether generation has ended */
  private generationEnded: boolean = false;

  constructor(config: DeepgramTtsProviderConfig, settings: DeepgramTtsSettings) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> { }

  /**
   * Gets the list of supported audio output formats for Deepgram
   * Supported formats are PCM variants (8/16/24/48 kHz), μ-law, and A-law.
   */
  getSupportedFormats(): AudioFormat[] {
    return ['pcm_8000', 'pcm_16000', 'pcm_24000', 'pcm_48000', 'mulaw', 'alaw'];
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.flushTimestamps = [];
    this.generationEnded = false;
    this.firstChunkBuffer = null;
    this.textBuffer = '';

    // Construct full model string from model version and voice ID
    const modelVersion = this.settings.model ?? 'aura-2';
    const voiceId = this.settings.voiceId ?? 'thalia-en';
    const effectiveModel = `${modelVersion}-${voiceId}`;

    // Initialize sentence splitter with callback to send complete sentences (if enabled)
    const useSentenceSplitter = this.settings.useSentenceSplitter ?? true;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          return false;
        }
        await this.sendTextToSocket(sentence);
        await this.flushAudio();
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    // Resolve audio format and encoding
    this.resolveAudioFormatAndEncoding();

    logger.info(`[Deepgram] Starting speech generation with model: ${effectiveModel}, encoding: ${this.audioFormat}, sample_rate: ${this.sampleRate}, audioFormat: ${this.audioFormat}`);

    // Build WebSocket URL with query parameters
    // Map pcm_* formats to Deepgram's API encoding name 'linear16' (sample rate is set separately)
    const deepgramEncoding = this.audioFormat.startsWith('pcm_') ? 'linear16' : this.audioFormat;
    let wsUrl = `wss://api.deepgram.com/v1/speak?model=${effectiveModel}&encoding=${deepgramEncoding}`;

    // Add optional parameters
    if (this.sampleRate) {
      wsUrl += `&sample_rate=${this.sampleRate}`;
    }
    if (this.bitRate) {
      wsUrl += `&bit_rate=${this.bitRate}`;
    }
    if (this.container) {
      wsUrl += `&container=${this.container}`;
    }

    return new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Token ${this.config.apiKey}`,
        },
      });

      this.socket.on('open', async () => {
        await this.handleWebSocketOpen();
        resolve();
      });

      this.socket.on('message', async (data: Buffer | string) => {
        await this.handleWebSocketMessage(data);
      });

      this.socket.on('error', async (error: Error) => {
        await this.handleWebSocketError(error);
        reject(error);
      });

      this.socket.on('close', async (code: number, reason: Buffer) => {
        await this.handleWebSocketClose(code, reason.toString());
      });
    });
  }

  /**
   * Stops and finalizes the speech generation session
   */
  async end(): Promise<void> {
    if (!this.socket) {
      logger.warn(`[Deepgram] No speech generation instance to end`);
      return;
    }

    // Send any buffered first chunk if it wasn't sent yet
    if (this.firstChunkBuffer !== null && this.firstChunkBuffer !== undefined) {
      logger.debug(`[Deepgram] Sending buffered first chunk on end`);
      await this.handleSpeechGenerating(this.firstChunkBuffer);
      this.firstChunkBuffer = undefined;
    }

    // Finalize any remaining text in the sentence splitter
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    } else if (this.textBuffer.trim()) {
      // Send buffered text when sentence splitter is disabled
      logger.info(`[Deepgram] Sending buffered text: "${this.textBuffer}"`);
      await this.sendTextToSocket(this.textBuffer);
      await this.flushAudio();
      this.textBuffer = '';
    }

    logger.info(`[Deepgram] Ending speech generation`);

    // Send Close message
    if (this.socket.readyState === WebSocket.OPEN) {
      const closeMessage: DeepgramCloseMessage = { type: 'Close' };
      this.socket.send(JSON.stringify(closeMessage));
    }
  }

  /**
   * Sends text to the speech generation service
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    if (this.sentenceSplitter) {
      logger.info(`[Deepgram] Adding text to sentence splitter: "${text}"`);
      // Add text to sentence splitter - it will automatically call sendTextToSocket for each complete sentence
      await this.sentenceSplitter.addText(text);
    } else {
      logger.debug(`[Deepgram] Buffering text: "${text}"`);
      // Buffer text until end() is called to allow TTS provider to handle complete text
      this.textBuffer += text;
    }
  }

  /**
   * Handles WebSocket connection open event
   */
  private async handleWebSocketOpen(): Promise<void> {
    logger.info(`[Deepgram] Connection established`);
    this.handleGenerationStarted();
  }

  /**
   * Handles WebSocket message events containing audio chunks or metadata
   * @param data The raw WebSocket message data
   */
  private async handleWebSocketMessage(data: Buffer | string): Promise<void> {
    // Convert to string to check for JSON
    const dataStr = data.toString();

    // Check if it looks like JSON (starts with '{' and ends with '}')
    if (dataStr.startsWith('{') && dataStr.endsWith('}')) {
      try {
        const jsonMessage = JSON.parse(dataStr);
        logger.info(`[Deepgram] Received JSON message: ${JSON.stringify(jsonMessage)}`);

        // Handle specific message types if needed
        if (jsonMessage.type === 'Warning') {
          logger.warn(`[Deepgram] Warning: ${jsonMessage.message || JSON.stringify(jsonMessage)}`);
        } else if (jsonMessage.type === 'Error') {
          logger.error(`[Deepgram] Error: ${jsonMessage.message || JSON.stringify(jsonMessage)}`);
          await this.handleError(new Error(`Deepgram error: ${jsonMessage.message || 'Unknown error'}`));
        }

        // Don't call handleSpeechGenerating for JSON messages
        return;
      } catch (error) {
        // If JSON parsing fails, treat as binary data below
        logger.debug(`[Deepgram] JSON parsing failed, treating as binary data`);
      }
    }

    // Treat as binary audio data
    const audioBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    logger.debug(`[Deepgram] Received binary audio chunk of ${audioBuffer.length} bytes`);

    const chunk: DeepgramAudioChunk = {
      chunkId: this.generateChunkId(),
      ordinal: this.getNextOrdinal(),
      audio: audioBuffer,
      audioFormat: this.audioFormat,
      durationMs: 0, // Deepgram doesn't provide duration in the stream
      isFinal: false,
      sampleRate: this.sampleRate,
      bitRate: this.bitRate,
    };

    // Buffer the first chunk to avoid playback timing issues
    // (there's typically a ~1s delay between 1st and 2nd chunk)
    if (this.firstChunkBuffer === null) {
      logger.debug(`[Deepgram] Buffering first chunk`);
      this.firstChunkBuffer = chunk;
    } else if (this.firstChunkBuffer) {
      // When second chunk arrives, send the buffered first chunk
      logger.debug(`[Deepgram] Sending buffered first chunk`);
      await this.handleSpeechGenerating(this.firstChunkBuffer);
      this.firstChunkBuffer = undefined; // Mark as sent (not null)
      // Then send the current chunk
      await this.handleSpeechGenerating(chunk);
    } else {
      // For all subsequent chunks, send immediately
      await this.handleSpeechGenerating(chunk);
    }
  }

  /**
   * Handles WebSocket error events
   * @param error The error that occurred
   */
  private async handleWebSocketError(error: Error): Promise<void> {
    const errorMessage = `Deepgram TTS connection error: ${error.message || 'WebSocket connection failed'}`;
    logger.error(`[Deepgram] Error: ${errorMessage}`);
    await this.handleError(new Error(errorMessage));
  }

  /**
   * Handles WebSocket close events
   * @param code The close code
   * @param reason The close reason
   */
  private async handleWebSocketClose(code: number, reason: string): Promise<void> {
    logger.info(`[Deepgram] Connection closed with code ${code}: ${reason}`);

    if (!this.generationEnded) {
      this.generationEnded = true;
      this.handleGenerationEnded();
    }
  }

  /**
   * Sends text to the WebSocket after applying no-speech filtering
   * @param text The text to send (can be a complete sentence or partial text)
   */
  private async sendTextToSocket(text: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }

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

    // Trim and skip empty text
    text = text.trim();
    if (!text) {
      return;
    }

    // Split text if it exceeds maximum length
    if (text.length > this.MAX_TEXT_LENGTH) {
      logger.warn(`[Deepgram] Text exceeds max length (${this.MAX_TEXT_LENGTH}), splitting into chunks`);
      const chunks = this.splitTextIntoChunks(text, this.MAX_TEXT_LENGTH);
      for (const chunk of chunks) {
        await this.sendSingleTextChunk(chunk);
      }
    } else {
      await this.sendSingleTextChunk(text);
    }
  }

  /**
   * Sends a single text chunk to the WebSocket
   * @param text The text chunk to send (must be <= MAX_TEXT_LENGTH)
   */
  private async sendSingleTextChunk(text: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }

    logger.info(`[Deepgram] Sending text: "${text}"`);

    const speakMessage: DeepgramSpeakMessage = {
      type: 'Speak',
      text: text,
    };

    return new Promise<void>((resolve, reject) => {
      this.socket!.send(JSON.stringify(speakMessage), (error?: Error) => {
        if (error) {
          const errorMessage = `Failed to send text to Deepgram TTS: ${error.message}`;
          logger.error(`[Deepgram] Error sending text: ${errorMessage}`);
          this.handleError(new Error(errorMessage));
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Sends a Flush message to retrieve queued audio
   * Respects rate limiting of 20 flushes per 60 seconds
   */
  private async flushAudio(): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    // Check rate limit
    const now = Date.now();
    this.flushTimestamps = this.flushTimestamps.filter(ts => now - ts < this.FLUSH_WINDOW_MS);

    if (this.flushTimestamps.length >= this.MAX_FLUSHES) {
      logger.warn(`[Deepgram] Flush rate limit reached (${this.MAX_FLUSHES} per ${this.FLUSH_WINDOW_MS}ms), skipping flush`);
      return;
    }

    logger.debug(`[Deepgram] Sending Flush message`);

    const flushMessage: DeepgramFlushMessage = { type: 'Flush' };
    this.socket.send(JSON.stringify(flushMessage));

    this.flushTimestamps.push(now);
  }

  /**
   * Splits text into chunks that don't exceed the maximum length
   * Tries to split at sentence boundaries when possible
   * @param text The text to split
   * @param maxLength Maximum length per chunk
   * @returns Array of text chunks
   */
  private splitTextIntoChunks(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      let splitIndex = maxLength;

      // Try to find a sentence boundary within the max length
      const sentenceEndings = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
      for (const ending of sentenceEndings) {
        const index = remaining.lastIndexOf(ending, maxLength);
        if (index > 0) {
          splitIndex = index + ending.length;
          break;
        }
      }

      // If no sentence boundary, try to split at a word boundary
      if (splitIndex === maxLength) {
        const lastSpace = remaining.lastIndexOf(' ', maxLength);
        if (lastSpace > 0) {
          splitIndex = lastSpace + 1;
        }
      }

      chunks.push(remaining.substring(0, splitIndex).trim());
      remaining = remaining.substring(splitIndex).trim();
    }

    if (remaining) {
      chunks.push(remaining);
    }

    return chunks;
  }

  /**
   * Resolves the audio format and encoding based on settings
   * Maps audio format to Deepgram encoding, sample rate, bit rate, and container
   */
  private resolveAudioFormatAndEncoding(): void {
    const requestedAudioFormat = this.settings.audioFormat;
    const requestedSampleRate = this.settings.sampleRate;
    const requestedBitRate = this.settings.bitRate;
    const requestedContainer = this.settings.container;

    // Default values for streaming WebSocket
    this.audioFormat = this.preferredOutputFormat ?? requestedAudioFormat ?? 'pcm_16000';
    this.sampleRate = requestedSampleRate || this.getDefaultSampleRate(this.audioFormat);
    this.bitRate = requestedBitRate;
    this.container = requestedContainer;

    // Validate audio format is supported
    const supportedFormats = this.getSupportedFormats();
    if (!supportedFormats.includes(this.audioFormat)) {
      logger.warn(`[Deepgram] Requested audio format ${this.audioFormat} is not supported. Falling back to pcm_16000.`);
      this.audioFormat = 'pcm_16000';
      this.sampleRate = 16000;
    }
  }

  /**
   * Gets the default sample rate for a given audio format
   * @param audioFormat The audio format
   * @returns Default sample rate in Hz
   */
  private getDefaultSampleRate(audioFormat: string): number {
    switch (audioFormat) {
      case 'pcm_8000': return 8000;
      case 'pcm_16000': return 16000;
      case 'pcm_24000': return 24000;
      case 'pcm_48000': return 48000;
      case 'mulaw':
      case 'alaw':
        return 8000;
      default:
        return 16000;
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
   * Cleans up resources when the provider is no longer needed
   */
  async cleanup(): Promise<void> {
    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
        this.socket.close();
      }
      this.socket = null;
    }

    if (this.sentenceSplitter) {
      this.sentenceSplitter.clear();
      this.sentenceSplitter = null;
    }

    this.inNoSpeechSection = undefined;
    this.flushTimestamps = [];
    this.generationEnded = false;
    this.bitRate = undefined;
    this.container = undefined;
    this.textBuffer = '';

    await super.cleanup();
  }
}
