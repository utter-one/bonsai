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
 * Schema for Cartesia TTS provider configuration
 */
export const cartesiaTtsProviderConfigSchema = z.object({
  apiKey: z.string().describe('API key for authenticating with Cartesia'),
});

export type CartesiaTtsProviderConfig = z.infer<typeof cartesiaTtsProviderConfigSchema>;

/**
 * Schema for Cartesia TTS settings
 */
export const cartesiaTtsSettingsSchema = z.object({
  model: z.string().optional().describe('Model ID to use for speech synthesis (e.g., "sonic-3", "sonic-3-latest", "sonic-3-2026-01-12"). Defaults to "sonic-3-latest"'),
  voiceId: z.string().optional().describe('Voice ID to use for speech synthesis (e.g., "f786b574-daa5-4673-aa0c-cbe3e8534c02" for Katie). See Cartesia voice catalog'),
  language: z.string().optional().describe('Language code for speech synthesis (e.g., "en", "es", "fr"). Sonic-3 supports 42 languages'),
  audioFormat: z.enum(['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'opus', 'mulaw', 'alaw']).optional().describe('Preferred audio output format for synthesized speech. Defaults to "pcm_24000"'),
  speed: z.enum(['slowest', 'slow', 'normal', 'fast', 'fastest']).optional().describe('Speech speed control. Defaults to "normal"'),
  emotion: z.array(z.string()).optional().describe('Emotion tags for expressive speech (e.g., ["positivity:high", "curiosity"]). See Cartesia emotion documentation'),
  maxBufferDelayMs: z.number().int().min(0).max(5000).optional().describe('Maximum time in milliseconds to buffer text chunks before sending to TTS (0-5000ms). Defaults to 3000ms. Set to 0 to disable buffering'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing. Defaults to false (uses streaming with continuations instead)'),
  noSpeechMarkers: z.array(z.object({ start: z.string(), end: z.string() })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
}).openapi('CartesiaTtsSettings');

export type CartesiaTtsSettings = z.infer<typeof cartesiaTtsSettingsSchema>;

/**
 * Cartesia WebSocket message types
 */

/** Voice configuration with optional experimental controls */
interface CartesiaVoiceConfig {
  mode: 'id';
  id: string;
  __experimental_controls?: {
    speed?: string;
    emotion?: string[];
  };
}

/** Audio output format configuration */
interface CartesiaOutputFormat {
  container: 'raw';
  encoding: 'pcm_f32le' | 'pcm_s16le' | 'pcm_mulaw' | 'pcm_alaw';
  sample_rate: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
}

/** Generation request sent to Cartesia WebSocket API */
interface CartesiaGenerationRequest {
  model_id: string;
  transcript: string;
  voice: CartesiaVoiceConfig;
  output_format: CartesiaOutputFormat;
  language?: string;
  add_timestamps: false;
  context_id: string;
  continue?: boolean;
  max_buffer_delay_ms?: number;
}

interface CartesiaAudioChunkResponse {
  type: 'chunk';
  context_id: string;
  data: string; // Base64 encoded audio
  done: false;
  status_code: 206;
  step_time: number;
}

interface CartesiaFlushDoneResponse {
  type: 'flush_done';
  context_id: string;
  done: false;
  flush_done: true;
  flush_id: number;
  status_code: 206;
}

interface CartesiaDoneResponse {
  type: 'done';
  context_id: string;
  done: true;
  status_code: 206;
}

interface CartesiaTimestampsResponse {
  type: 'timestamps';
  context_id: string;
  done: false;
  status_code: 206;
  word_timestamps: {
    words: string[];
    start: number[];
    end: number[];
  };
}

interface CartesiaErrorResponse {
  type: string;
  context_id?: string;
  done: true;
  error: string;
  status_code: number;
}

/**
 * Cartesia TTS provider implementation
 * Provides real-time text-to-speech synthesis using Cartesia Sonic streaming API
 */
export class CartesiaTtsProvider extends TtsProviderBase<CartesiaTtsProviderConfig> {
  /** WebSocket connection to Cartesia streaming API */
  private socket: WebSocket | null = null;

  /** Sentence splitter for processing streaming text (optional) */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Buffer for accumulating text chunks */
  private textBuffer: string = '';

  /** Timer for flushing buffered text */
  private bufferTimer: NodeJS.Timeout | null = null;

  /** Whether this is the first request for the current context (affects continue flag) */
  private isFirstRequest: boolean = true;

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** TTS settings for this provider instance */
  private settings: CartesiaTtsSettings;

  /** Audio output format for the current session */
  private audioFormat: AudioFormat = 'pcm_24000';

  /** Unique context ID for this generation session */
  private contextId: string = '';

  /** Map of context IDs to their completion promise resolvers (used for sentence splitter) */
  private pendingCompletions: Map<string, () => void> = new Map();

  constructor(config: CartesiaTtsProviderConfig, settings: CartesiaTtsSettings) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> { }

  /**
   * Gets the list of supported audio output formats for Cartesia
   */
  getSupportedFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'pcm_48000', 'opus', 'mulaw', 'alaw'];
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.textBuffer = '';
    this.contextId = this.generateContextId();
    this.isFirstRequest = true;
    this.clearBufferTimer();

    // Initialize sentence splitter only if explicitly enabled (default is streaming with continuations)
    const useSentenceSplitter = this.settings.useSentenceSplitter ?? false;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          return false;
        }
        // Send sentence and wait for its done response before returning
        await this.sendTextToSocketAndWait(sentence);
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    // Resolve audio format
    this.audioFormat = this.resolveAudioFormat(this.settings.audioFormat);

    const effectiveModel = this.settings.model ?? 'sonic-3-latest';
    const effectiveVoiceId = this.settings.voiceId ?? 'f786b574-daa5-4673-aa0c-cbe3e8534c02'; // Katie (stable voice for agents)

    logger.info(`[Cartesia] Starting speech generation with model: ${effectiveModel}, voiceId: ${effectiveVoiceId}, audioFormat: ${this.audioFormat}, contextId: ${this.contextId}`);

    // Build WebSocket URL with query parameters (API key and version passed as query params for browser compatibility)
    const wsUrl = `wss://api.cartesia.ai/tts/websocket?api_key=${encodeURIComponent(this.config.apiKey)}&cartesia_version=2024-06-10`;

    return new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(wsUrl);

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
   * Signals end of input text - flushes remaining buffered text without closing WebSocket
   */
  async end(): Promise<void> {
    if (!this.socket) {
      logger.warn(`[Cartesia] No active WebSocket connection`);
      return;
    }

    // Clear any pending buffer timer
    this.clearBufferTimer();

    // Finalize any remaining text in the sentence splitter
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    } else if (this.textBuffer.trim()) {
      // Send any remaining buffered text
      logger.info(`[Cartesia] Sending final buffered text: "${this.textBuffer}"`);
      await this.sendTextToSocket(this.textBuffer);
      this.textBuffer = '';
    }

    logger.info(`[Cartesia] End of text input signaled - waiting for TTS completion`);
  }

  /**
   * Sends text to the speech generation service
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    if (this.sentenceSplitter) {
      logger.info(`[Cartesia] Adding text to sentence splitter: "${text}"`);
      // Add text to sentence splitter - it will automatically call sendTextToSocket for each complete sentence
      await this.sentenceSplitter.addText(text);
    } else {
      // Use streaming with continuations: buffer text and flush with timer
      logger.debug(`[Cartesia] Buffering text chunk: "${text}"`);
      this.textBuffer += text;

      // Clear existing timer and start new one
      this.clearBufferTimer();

      const maxBufferDelayMs = this.settings.maxBufferDelayMs ?? 3000;
      if (maxBufferDelayMs > 0) {
        this.bufferTimer = setTimeout(async () => {
          await this.flushTextBuffer();
        }, maxBufferDelayMs);
      }
    }
  }

  /**
   * Handles WebSocket connection open event
   */
  private async handleWebSocketOpen(): Promise<void> {
    logger.info(`[Cartesia] Connection established`);
    this.handleGenerationStarted();
  }

  /**
   * Handles WebSocket message events containing audio chunks or metadata
   * @param data The raw WebSocket message data
   */
  private async handleWebSocketMessage(data: Buffer | string): Promise<void> {
    try {
      const message = JSON.parse(data.toString());

      // All Cartesia responses have a 'type' field
      if (!message.type) {
        logger.warn(`[Cartesia] Received message without type field: ${data.toString()}`);
        return;
      }

      switch (message.type) {
        case 'chunk': {
          const audioMsg = message as CartesiaAudioChunkResponse;
          // Decode Base64 audio data
          const audioBuffer = Buffer.from(audioMsg.data, 'base64');
          logger.debug(`[Cartesia] Received audio chunk: ${audioBuffer.length} bytes (step_time: ${audioMsg.step_time}ms)`);
          const chunk: GeneratedAudioChunk = {
            chunkId: this.generateChunkId(),
            ordinal: this.getNextOrdinal(),
            audio: audioBuffer,
            audioFormat: this.audioFormat,
            isFinal: false,
          };
          await this.handleSpeechGenerating(chunk);
          break;
        }

        case 'flush_done': {
          const flushMsg = message as CartesiaFlushDoneResponse;
          logger.debug(`[Cartesia] Flush completed (flush_id: ${flushMsg.flush_id})`);
          // Flush done indicates a complete flush of buffered text - no action needed
          break;
        }

        case 'done': {
          const doneMsg = message as CartesiaDoneResponse;
          logger.info(`[Cartesia] Generation complete for context ${doneMsg.context_id} (status: ${doneMsg.status_code})`);

          // Resolve pending completion promise if waiting (sentence splitter mode)
          const resolver = this.pendingCompletions.get(doneMsg.context_id);
          if (resolver) {
            resolver();
            this.pendingCompletions.delete(doneMsg.context_id);
          }

          // Send final chunk to signal completion
          const finalChunk: GeneratedAudioChunk = {
            chunkId: this.generateChunkId(),
            ordinal: this.getNextOrdinal(),
            audio: Buffer.alloc(0),
            audioFormat: this.audioFormat,
            isFinal: true,
          };
          await this.handleSpeechGenerating(finalChunk);
          this.handleGenerationEnded();
          break;
        }

        case 'timestamps': {
          const timestampsMsg = message as CartesiaTimestampsResponse;
          logger.debug(`[Cartesia] Received word timestamps: ${timestampsMsg.word_timestamps.words.length} words`);
          // Word timestamps are available but not currently used
          break;
        }

        default: {
          // Handle error responses (type can be any string for errors)
          if ('error' in message) {
            const errorMsg = message as CartesiaErrorResponse;
            logger.error(`[Cartesia] Error response (type: ${errorMsg.type}): ${errorMsg.error} (status: ${errorMsg.status_code})`);

            // Resolve pending completion if this error is for a tracked context
            if (errorMsg.context_id) {
              const resolver = this.pendingCompletions.get(errorMsg.context_id);
              if (resolver) {
                resolver();
                this.pendingCompletions.delete(errorMsg.context_id);
              }
            }

            await this.handleError(new Error(`Cartesia error: ${errorMsg.error}`));
          } else {
            logger.warn(`[Cartesia] Unknown message type: ${message.type}`);
          }
          break;
        }
      }
    } catch (error) {
      logger.error(`[Cartesia] Failed to parse WebSocket message: ${error}`);
      await this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handles WebSocket error events
   * @param error The error that occurred
   */
  private async handleWebSocketError(error: Error): Promise<void> {
    const errorMessage = `Cartesia TTS connection error: ${error.message || 'WebSocket connection failed'}`;
    logger.error(`[Cartesia] Error: ${errorMessage}`);

    // Resolve all pending completions to avoid hanging promises
    for (const resolver of this.pendingCompletions.values()) {
      resolver();
    }
    this.pendingCompletions.clear();

    await this.handleError(new Error(errorMessage));
  }

  /**
   * Handles WebSocket close events
   * @param code The close code
   * @param reason The close reason
   */
  private async handleWebSocketClose(code: number, reason: string): Promise<void> {
    logger.info(`[Cartesia] Connection closed with code ${code}: ${reason}`);

    // Resolve all pending completions to avoid hanging promises
    for (const resolver of this.pendingCompletions.values()) {
      resolver();
    }
    this.pendingCompletions.clear();

    this.handleGenerationEnded();
  }

  /**
   * Flushes the buffered text to the WebSocket
   */
  private async flushTextBuffer(): Promise<void> {
    if (this.textBuffer.trim()) {
      logger.debug(`[Cartesia] Flushing text buffer: "${this.textBuffer}"`);
      await this.sendTextToSocket(this.textBuffer);
      this.textBuffer = '';
    }
  }

  /**
   * Clears the buffer timer if it exists
   */
  private clearBufferTimer(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  /**
   * Sends text to the WebSocket and waits for done response (sentence splitter mode)
   * @param text The text to send
   */
  private async sendTextToSocketAndWait(text: string): Promise<void> {
    const contextId = this.generateContextId();

    // Create a promise that resolves when we receive the done response
    const completionPromise = new Promise<void>((resolve) => {
      this.pendingCompletions.set(contextId, resolve);
    });

    // Send the text with unique context ID
    await this.sendTextToSocket(text, contextId);

    // Wait for the done response before returning
    await completionPromise;
  }

  /**
   * Sends text to the WebSocket after applying no-speech filtering
   * @param text The text to send (can be a complete sentence or accumulated text)
   * @param contextIdOverride Optional context ID to use (for sentence splitter mode)
   */
  private async sendTextToSocket(text: string, contextIdOverride?: string): Promise<void> {
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

    // Skip empty text
    if (!text.trim()) {
      return;
    }

    const isContinuation = !this.sentenceSplitter && !this.isFirstRequest;
    logger.info(`[Cartesia] Sending text${isContinuation ? ' (continuation)' : ''}: "${text}"`);

    // Build voice configuration
    const voice: CartesiaVoiceConfig = {
      mode: 'id',
      id: this.settings.voiceId ?? 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
    };

    // Add experimental controls (speed and emotion)
    if (this.settings.speed || this.settings.emotion) {
      voice.__experimental_controls = {};
      if (this.settings.speed) {
        voice.__experimental_controls.speed = this.settings.speed;
      }
      if (this.settings.emotion) {
        voice.__experimental_controls.emotion = this.settings.emotion;
      }
    }

    // Build generation request
    const request: CartesiaGenerationRequest = {
      model_id: this.settings.model ?? 'sonic-3-latest',
      transcript: text,
      voice,
      output_format: this.buildOutputFormat(),
      add_timestamps: false,
      // Use provided context ID (sentence splitter) or shared context ID (streaming)
      context_id: contextIdOverride ?? this.contextId,
    };

    // Add optional language parameter
    if (this.settings.language) {
      request.language = this.settings.language;
    }

    // Add continuation flag and max_buffer_delay_ms for streaming continuations (only when not using sentence splitter)
    if (!this.sentenceSplitter) {
      // Set continue flag to true for all requests AFTER the first one
      if (!this.isFirstRequest) {
        request.continue = true;
      }

      // Add max_buffer_delay_ms for streaming continuations
      const maxBufferDelayMs = this.settings.maxBufferDelayMs ?? 3000;
      if (maxBufferDelayMs > 0) {
        request.max_buffer_delay_ms = maxBufferDelayMs;
      }
    }

    this.socket.send(JSON.stringify(request), async (error?: Error) => {
      if (error) {
        const errorMessage = `Failed to send text to Cartesia TTS: ${error.message}`;
        logger.error(`[Cartesia] Error sending text: ${errorMessage}`);
        await this.handleError(new Error(errorMessage));
      } else {
        // Mark that we've sent the first request
        this.isFirstRequest = false;
      }
    });
  }

  /**
   * Builds the output format configuration for Cartesia API
   * Maps internal AudioFormat to Cartesia's output_format structure
   */
  private buildOutputFormat(): CartesiaOutputFormat {
    // Map audioFormat to encoding and sample rate
    const formatMapping = this.mapAudioFormatToCartesia(this.audioFormat);

    return {
      container: 'raw', // WebSocket API only supports raw container
      encoding: formatMapping.encoding,
      sample_rate: formatMapping.sampleRate,
    };
  }

  /**
   * Maps internal AudioFormat to Cartesia encoding and sample rate
   */
  private mapAudioFormatToCartesia(audioFormat: AudioFormat): { encoding: 'pcm_s16le' | 'pcm_f32le' | 'pcm_mulaw' | 'pcm_alaw'; sampleRate: 8000 | 16000 | 22050 | 24000 | 44100 | 48000 } {
    switch (audioFormat) {
      case 'pcm_16000':
        return { encoding: 'pcm_s16le', sampleRate: 16000 };
      case 'pcm_22050':
        return { encoding: 'pcm_s16le', sampleRate: 22050 };
      case 'pcm_24000':
        return { encoding: 'pcm_s16le', sampleRate: 24000 };
      case 'pcm_44100':
        return { encoding: 'pcm_s16le', sampleRate: 44100 };
      case 'pcm_48000':
        return { encoding: 'pcm_s16le', sampleRate: 48000 };
      case 'mulaw':
        return { encoding: 'pcm_mulaw', sampleRate: 8000 };
      case 'alaw':
        return { encoding: 'pcm_alaw', sampleRate: 8000 };
      case 'opus':
        // Opus is not directly supported by Cartesia output format, fallback to PCM
        logger.warn(`[Cartesia] Opus format requested but not supported in output_format. Falling back to pcm_s16le at 24000Hz`);
        return { encoding: 'pcm_s16le', sampleRate: 24000 };
      default:
        return { encoding: 'pcm_s16le', sampleRate: 24000 };
    }
  }

  /**
   * Generates a unique context ID for the generation session
   */
  private generateContextId(): string {
    return `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
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

    logger.warn(`[Cartesia] Requested audio format ${requestedFormat} is not supported. Falling back to pcm_24000.`);
    return 'pcm_24000';
  }

  /**
   * Cleans up resources when the provider is no longer needed
   */
  async cleanup(): Promise<void> {
    // Clear buffer timer
    this.clearBufferTimer();

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
    this.textBuffer = '';
    this.contextId = '';
    this.isFirstRequest = true;
    this.pendingCompletions.clear();

    await super.cleanup();
  }
}
