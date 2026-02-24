import WebSocket from 'ws';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';
import type { AudioFormat } from '../../../types/audio';
import { generateId, ID_PREFIXES } from '../../../utils/idGenerator';

extendZodWithOpenApi(z);

/**
 * Schema for Deepgram ASR provider configuration
 */
export const deepgramAsrProviderConfigSchema = z.object({
  apiKey: z.string().describe('API key for authenticating with Deepgram'),
});

export type DeepgramAsrProviderConfig = z.infer<typeof deepgramAsrProviderConfigSchema>;

/**
 * Schema for Deepgram ASR settings
 */
export const deepgramAsrSettingsSchema = z.looseObject({
  modelId: z.string().default('nova-3').describe('Model ID to use for transcription (e.g., "nova-3", "nova-2", "base", "enhanced"), defaults to nova-3'),
  audioFormat: z.enum(['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100']).default('pcm_16000').describe('Audio encoding format for speech-to-text, defaults to pcm_16000'),
  language: z.string().optional().describe('BCP-47 language tag (e.g., "en-US", "es", "fr")'),
  interimResults: z.boolean().default(false).describe('Enable interim (partial) transcription results during streaming, defaults to false'),
  endpointing: z.union([z.number().int().min(10), z.boolean()]).default(300).describe('Milliseconds of silence to wait before finalizing speech (10+) or false to disable, defaults to 300'),
  smartFormat: z.boolean().default(true).describe('Apply formatting (punctuation, capitalization, currency, etc.) to improve readability, defaults to true'),
  punctuate: z.boolean().default(true).describe('Add punctuation and capitalization to transcript, defaults to true'),
  diarize: z.boolean().default(false).describe('Recognize and label different speakers in the audio, defaults to false'),
  utteranceEndMs: z.number().int().min(10).optional().describe('Milliseconds to wait before sending UtteranceEnd event (use with interim_results)'),
  vadEvents: z.boolean().default(false).describe('Send SpeechStarted events when speech is detected, defaults to false'),
}).openapi('DeepgramAsrSettings').describe('Deepgram speech-to-text settings');

export type DeepgramAsrSettings = z.infer<typeof deepgramAsrSettingsSchema>;

/**
 * Deepgram ASR provider implementation
 * Provides real-time speech recognition using Deepgram streaming API
 */
export class DeepgramAsrProvider extends AsrProviderBase<DeepgramAsrProviderConfig> {
  /** WebSocket connection to Deepgram streaming API */
  private socket: WebSocket | null = null;

  /** Buffer for audio chunks received before WebSocket connection is established */
  private audioBuffer: Buffer[] = [];

  /** Current chunk ID being processed */
  private currentChunkId: string;

  /** Flag indicating if recognition is active */
  private isRecognizing = false;

  /** Audio format for the recognition session */
  private audioFormat: AudioFormat = 'pcm_16000';

  /** Request ID received from Deepgram metadata */
  private requestId: string | null = null;

  /** ASR settings for this provider instance */
  private settings: DeepgramAsrSettings;

  constructor(config: DeepgramAsrProviderConfig, settings: DeepgramAsrSettings) {
    super(config);
    this.settings = settings;
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
  }

  /**
   * Gets the list of supported audio input formats for Deepgram ASR
   */
  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100'];
  }

  /**
   * Initializes the Deepgram speech recognition session
   */
  async init(): Promise<void> {
    await super.init();
    this.audioBuffer = [];
    this.isRecognizing = false;
    this.requestId = null;
    this.audioFormat = this.resolveAudioFormat(this.settings?.audioFormat);
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    logger.info(`[Deepgram ASR] Initialized with audio format: ${this.audioFormat}`);
  }

  /**
   * Starts the Deepgram speech recognition session
   */
  async start(): Promise<void> {
    if (!this.config.apiKey) {
      const errorMessage = 'Missing required Deepgram API key';
      logger.error(`[Deepgram ASR] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    this.audioBuffer = [];
    this.textChunks = [];
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    this.requestId = null;

    // Build WebSocket URL with query parameters
    const params = new URLSearchParams({
      model: this.settings.modelId,
      encoding: 'linear16',
      sample_rate: this.getSampleRateFromFormat(this.audioFormat).toString(),
      channels: '1',
    });

    // Add optional parameters
    if (this.settings.language) {
      params.append('language', this.settings.language);
    }
    if (this.settings.interimResults) {
      params.append('interim_results', 'true');
    }
    if (this.settings.endpointing !== false) {
      params.append('endpointing', this.settings.endpointing.toString());
    }
    if (this.settings.smartFormat) {
      params.append('smart_format', 'true');
    }
    if (this.settings.punctuate) {
      params.append('punctuate', 'true');
    }
    if (this.settings.diarize) {
      params.append('diarize', 'true');
    }
    if (this.settings.utteranceEndMs) {
      params.append('utterance_end_ms', this.settings.utteranceEndMs.toString());
    }
    if (this.settings.vadEvents) {
      params.append('vad_events', 'true');
    }

    const wsUrl = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    logger.info(`[Deepgram ASR] Connecting to WebSocket with model: ${this.settings.modelId}, audioFormat: ${this.audioFormat}`);

    return new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Token ${this.config.apiKey}`,
        },
      });

      this.socket.on('open', () => {
        logger.info(`[Deepgram ASR] WebSocket connection established`);
        this.isRecognizing = true;
        if (this.onRecognitionStartedCallback) {
          this.onRecognitionStartedCallback();
        }
        // Send buffered audio chunks
        this.flushAudioBuffer();
        resolve();
      });

      this.socket.on('message', async (data: Buffer) => {
        try {
          await this.handleWebSocketMessage(data);
        } catch (error) {
          logger.error(`[Deepgram ASR] Error handling message: ${error}`);
          await this.handleError(error instanceof Error ? error : new Error(String(error)));
        }
      });

      this.socket.on('error', async (error: Error) => {
        logger.error(`[Deepgram ASR] WebSocket error: ${error.message}`);
        await this.handleError(error);
        reject(error);
      });

      this.socket.on('close', async (code: number, reason: Buffer) => {
        logger.info(`[Deepgram ASR] WebSocket closed: code=${code}, reason=${reason.toString()}`);
        const wasRecognizing = this.isRecognizing;
        this.isRecognizing = false;
        this.socket = null;

        // Trigger recognition stopped callback if we were recognizing
        if (wasRecognizing) {
          this.handleRecognitionStopped();
        }
      });
    });
  }

  /**
   * Stops the Deepgram speech recognition session
   */
  async stop(): Promise<void> {
    logger.info(`[Deepgram ASR] Stopping recognition`);

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logger.warn(`[Deepgram ASR] Socket not open, cannot stop`);
      return;
    }

    // Send CloseStream message to finalize transcription
    try {
      const closeMessage = JSON.stringify({ type: 'CloseStream' });
      this.socket.send(closeMessage);
      logger.info(`[Deepgram ASR] Sent CloseStream message`);
    } catch (error) {
      logger.error(`[Deepgram ASR] Error sending CloseStream: ${error}`);
    }

    // Give Deepgram a moment to process and send final transcripts
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now close the socket (this will trigger handleRecognitionStopped in the close handler)
    this.socket.close();
  }

  /**
   * Sends audio data to the Deepgram speech recognition service
   * @param audio Binary audio data buffer to be processed
   * @param format Optional audio format (should match configured format)
   */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    if (format && format !== this.audioFormat) {
      logger.warn(`[Deepgram ASR] Received audio format ${format} does not match configured format ${this.audioFormat}. Using ${this.audioFormat}.`);
    }

    if (this.isRecognizing && this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send raw audio bytes to Deepgram
      this.socket.send(audio);
      logger.debug(`[Deepgram ASR] Sent audio chunk (${audio.length} bytes)`);
    } else {
      // Buffer audio until WebSocket is ready
      this.audioBuffer.push(audio);
      logger.debug(`[Deepgram ASR] Buffered audio chunk (${audio.length} bytes)`);
    }
  }

  /**
   * Handles WebSocket message events
   * @param data The raw WebSocket message data
   */
  private async handleWebSocketMessage(data: Buffer): Promise<void> {
    const message = JSON.parse(data.toString());
    const messageType = message.type;

    logger.debug(`[Deepgram ASR] Received message type: ${messageType}`);

    switch (messageType) {
      case 'Results':
        await this.handleResultsMessage(message);
        break;

      case 'Metadata':
        this.requestId = message.request_id;
        logger.info(`[Deepgram ASR] Metadata received: request_id=${this.requestId}`);
        break;

      case 'UtteranceEnd':
        logger.info(`[Deepgram ASR] UtteranceEnd event received`);
        // UtteranceEnd indicates the end of a natural utterance
        // We don't need to do anything special here, as Results messages handle transcription
        break;

      case 'SpeechStarted':
        logger.info(`[Deepgram ASR] SpeechStarted event received at timestamp: ${message.timestamp}`);
        // Speech activity detected - useful for debugging/monitoring
        break;

      case 'Error':
        const errorMessage = message.description || message.message || 'Unknown Deepgram ASR error';
        logger.error(`[Deepgram ASR] Error: ${errorMessage}`);
        await this.handleError(new Error(`Deepgram Error: ${errorMessage}`));
        break;

      default:
        logger.warn(`[Deepgram ASR] Unknown message type: ${messageType}`);
    }
  }

  /**
   * Handles Results messages from Deepgram
   * @param message The Results message object
   */
  private async handleResultsMessage(message: any): Promise<void> {
    const channel = message.channel;
    if (!channel || !channel.alternatives || channel.alternatives.length === 0) {
      logger.debug(`[Deepgram ASR] Results message has no alternatives`);
      return;
    }

    const alternative = channel.alternatives[0];
    const transcript = alternative.transcript;

    // Empty transcript - skip
    if (!transcript || transcript.trim() === '') {
      logger.debug(`[Deepgram ASR] Empty transcript received`);
      return;
    }

    const isFinal = message.is_final === true;

    logger.info(`[Deepgram ASR] Transcript: "${transcript}" (is_final=${isFinal})`);

    // Deepgram uses is_final flag to indicate finalized text
    // We ignore speech_final as it doesn't reliably indicate chunk completion
    if (isFinal) {
      // Final transcription result - send and generate new chunk ID
      this.handleRecognized(this.currentChunkId, transcript);
      this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    } else if (this.settings.interimResults) {
      // Interim (partial) result - only send if interim results are enabled
      this.handleRecognizing(this.currentChunkId, transcript);
    }
  }

  /**
   * Flushes buffered audio chunks to the WebSocket
   */
  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) {
      return;
    }

    logger.info(`[Deepgram ASR] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const buffer of this.audioBuffer) {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(buffer);
      }
    }
    this.audioBuffer = [];
  }

  /**
   * Extracts sample rate from audio format string
   * @param format Audio format string (e.g., 'pcm_16000')
   * @returns Sample rate in Hz
   */
  private getSampleRateFromFormat(format: AudioFormat): number {
    const match = format.match(/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Default to 16000 if format doesn't contain sample rate
    return 16000;
  }

  /**
   * Resolves the requested audio format to a supported format
   * @param requestedFormat Optional requested audio format
   * @returns Supported audio format to use for input
   */
  private resolveAudioFormat(requestedFormat?: AudioFormat): AudioFormat {
    const supportedFormats = this.getSupportedInputFormats();
    if (!requestedFormat) {
      return supportedFormats[0];
    }

    if (supportedFormats.includes(requestedFormat)) {
      return requestedFormat;
    }

    logger.warn(`[Deepgram ASR] Requested audio format ${requestedFormat} is not supported. Falling back to ${supportedFormats[0]}.`);
    return supportedFormats[0];
  }

  /**
   * Cleans up Deepgram ASR resources
   */
  async cleanup(): Promise<void> {
    await super.cleanup();

    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      this.socket = null;
    }

    this.audioBuffer = [];
    this.isRecognizing = false;
    this.requestId = null;
    logger.info(`[Deepgram ASR] Cleaned up resources`);
  }
}
