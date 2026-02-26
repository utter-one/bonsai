import WebSocket from 'ws';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';
import type { AudioFormat } from '../../../types/audio';
import { generateId, ID_PREFIXES } from '../../../utils/idGenerator';

extendZodWithOpenApi(z);

/**
 * Schema for ElevenLabs ASR provider configuration
 */
export const elevenLabsAsrProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('API key for authenticating with ElevenLabs'),
});

export type ElevenLabsAsrProviderConfig = z.infer<typeof elevenLabsAsrProviderConfigSchema>;

/**
 * Schema for ElevenLabs ASR settings
 */
export const elevenLabsAsrSettingsSchema = z.looseObject({
  modelId: z.string().default('scribe_v2_realtime').describe('Model ID to use for transcription (e.g., "scribe_v2_realtime"), defaults to scribe_v2_realtime'),
  audioFormat: z.enum(['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100']).default('pcm_16000').describe('Audio encoding format for speech-to-text, defaults to pcm_16000'),
  languageCode: z.string().optional().describe('Language code in ISO 639-1 or ISO 639-3 format (e.g., "en", "es")'),
  includeTimestamps: z.boolean().default(false).describe('Whether to receive word-level timestamps in transcription results, defaults to false'),
  includeLanguageDetection: z.boolean().default(false).describe('Whether to include detected language code in transcription results, defaults to false'),
  commitStrategy: z.enum(['manual', 'vad']).default('manual').describe('Strategy for committing transcriptions - manual or voice activity detection, defaults to manual'),
  vadSilenceThresholdSecs: z.number().min(0.3).max(3).default(1.5).describe('Silence threshold in seconds for VAD (0.3-3), defaults to 1.5'),
  vadThreshold: z.number().min(0.1).max(0.9).default(0.4).describe('Threshold for voice activity detection (0.1-0.9), defaults to 0.4'),
  minSpeechDurationMs: z.number().int().min(50).max(2000).default(100).describe('Minimum speech duration in milliseconds (50-2000), defaults to 100'),
  minSilenceDurationMs: z.number().int().min(50).max(2000).default(100).describe('Minimum silence duration in milliseconds (50-2000), defaults to 100'),
  enableLogging: z.boolean().default(true).describe('When false, zero retention mode is used (enterprise only), defaults to true'),
}).openapi('ElevenLabsAsrSettings').describe('ElevenLabs Scribe settings');

export type ElevenLabsAsrSettings = z.infer<typeof elevenLabsAsrSettingsSchema>;

/**
 * ElevenLabs ASR provider implementation
 * Provides real-time speech recognition using ElevenLabs streaming API
 */
export class ElevenLabsAsrProvider extends AsrProviderBase<ElevenLabsAsrProviderConfig> {
  /** WebSocket connection to ElevenLabs streaming API */
  private socket: WebSocket | null = null;

  /** Buffer for audio chunks received before WebSocket connection is established */
  private audioBuffer: Buffer[] = [];

  /** Current chunk ID being processed */
  private currentChunkId: string;

  /** Flag indicating if recognition is active */
  private isRecognizing = false;

  /** Audio format for the recognition session */
  private audioFormat: AudioFormat = 'pcm_16000';

  /** Session ID received from ElevenLabs */
  private sessionId: string | null = null;

  /** ASR settings for this provider instance */
  private settings: ElevenLabsAsrSettings;

  constructor(config: ElevenLabsAsrProviderConfig, settings: ElevenLabsAsrSettings) {
    super(config);
    this.settings = settings;
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
  }

  /**
   * Gets the list of supported audio input formats for ElevenLabs ASR
   */
  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100'];
  }

  /**
   * Initializes the ElevenLabs speech recognition session
   */
  async init(): Promise<void> {
    await super.init();
    this.audioBuffer = [];
    this.isRecognizing = false;
    this.sessionId = null;
    this.audioFormat = this.resolveAudioFormat(this.settings?.audioFormat);
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    logger.info(`[ElevenLabs ASR] Initialized with audio format: ${this.audioFormat}`);
  }

  /**
   * Starts the ElevenLabs speech recognition session
   */
  async start(): Promise<void> {
    if (!this.config.apiKey) {
      const errorMessage = 'Missing required ElevenLabs API key';
      logger.error(`[ElevenLabs ASR] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    this.audioBuffer = [];
    this.textChunks = [];
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    this.sessionId = null;

    // Build WebSocket URL with query parameters
    const modelId = this.settings.modelId;
    const audioFormat = this.audioFormat;
    const params = new URLSearchParams({
      model_id: modelId,
      audio_format: audioFormat,
      include_timestamps: this.settings.includeTimestamps.toString(),
      include_language_detection: this.settings.includeLanguageDetection.toString(),
      commit_strategy: this.settings.commitStrategy,
      vad_silence_threshold_secs: this.settings.vadSilenceThresholdSecs.toString(),
      vad_threshold: this.settings.vadThreshold.toString(),
      min_speech_duration_ms: this.settings.minSpeechDurationMs.toString(),
      min_silence_duration_ms: this.settings.minSilenceDurationMs.toString(),
      enable_logging: this.settings.enableLogging.toString(),
    });

    if (this.settings.languageCode) {
      params.append('language_code', this.settings.languageCode);
    }

    const wsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`;

    logger.info(`[ElevenLabs ASR] Connecting to WebSocket with model: ${modelId}, audioFormat: ${audioFormat}`);

    return new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(wsUrl, {
        headers: {
          'xi-api-key': this.config.apiKey,
        },
      });

      this.socket.on('open', () => {
        logger.info(`[ElevenLabs ASR] WebSocket connection established`);
      });

      this.socket.on('message', async (data: Buffer) => {
        try {
          await this.handleWebSocketMessage(data);
          // Resolve on first session_started message
          if (this.sessionId && !this.isRecognizing) {
            this.isRecognizing = true;
            if (this.onRecognitionStartedCallback) {
              this.onRecognitionStartedCallback();
            }
            // Send buffered audio chunks
            await this.flushAudioBuffer();
            resolve();
          }
        } catch (error) {
          logger.error(`[ElevenLabs ASR] Error handling message: ${error}`);
          await this.handleError(error instanceof Error ? error : new Error(String(error)));
        }
      });

      this.socket.on('error', async (error: Error) => {
        logger.error(`[ElevenLabs ASR] WebSocket error: ${error.message}`);
        await this.handleError(error);
        reject(error);
      });

      this.socket.on('close', async (code: number, reason: Buffer) => {
        logger.info(`[ElevenLabs ASR] WebSocket closed: code=${code}, reason=${reason.toString()}`);
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
   * Stops the ElevenLabs speech recognition session
   */
  async stop(): Promise<void> {
    logger.info(`[ElevenLabs ASR] Stopping recognition`);

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      logger.warn(`[ElevenLabs ASR] Socket not open, cannot stop`);
      return;
    }

    // Send a final empty audio chunk with commit to flush any pending transcriptions
    try {
      const sampleRate = this.getSampleRateFromFormat(this.audioFormat);
      const finalMessage = {
        message_type: 'input_audio_chunk',
        audio_base_64: '',
        sample_rate: sampleRate,
        commit: true,
      };
      this.socket.send(JSON.stringify(finalMessage));
      logger.info(`[ElevenLabs ASR] Sent final commit message`);
    } catch (error) {
      logger.error(`[ElevenLabs ASR] Error sending final commit: ${error}`);
    }

    // Give ElevenLabs a moment to process and send final transcripts
    await new Promise(resolve => setTimeout(resolve, 100));

    // Now close the socket (this will trigger handleRecognitionStopped in the close handler)
    this.socket.close();
  }

  /**
   * Sends audio data to the ElevenLabs speech recognition service
   * @param audio Binary audio data buffer to be processed
   * @param format Optional audio format (should match configured format)
   */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    if (format && format !== this.audioFormat) {
      logger.warn(`[ElevenLabs ASR] Received audio format ${format} does not match configured format ${this.audioFormat}. Using ${this.audioFormat}.`);
    }

    if (this.isRecognizing && this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send audio chunk to ElevenLabs
      const audioBase64 = audio.toString('base64');
      const sampleRate = this.getSampleRateFromFormat(this.audioFormat);

      const message = {
        message_type: 'input_audio_chunk',
        audio_base_64: audioBase64,
        sample_rate: sampleRate,
        commit: this.settings.commitStrategy === 'manual',
      };

      this.socket.send(JSON.stringify(message));
      logger.debug(`[ElevenLabs ASR] Sent audio chunk (${audio.length} bytes)`);
    } else {
      // Buffer audio until WebSocket is ready
      this.audioBuffer.push(audio);
      logger.debug(`[ElevenLabs ASR] Buffered audio chunk (${audio.length} bytes)`);
    }
  }

  /**
   * Handles WebSocket message events
   * @param data The raw WebSocket message data
   */
  private async handleWebSocketMessage(data: Buffer): Promise<void> {
    const message = JSON.parse(data.toString());
    logger.debug(`[ElevenLabs ASR] Received message type: ${message.message_type}`);

    switch (message.message_type) {
      case 'session_started':
        this.sessionId = message.session_id;
        logger.info(`[ElevenLabs ASR] Session started: ${this.sessionId}`);
        break;

      case 'partial_transcript':
        if (message.text) {
          logger.info(`[ElevenLabs ASR] Partial transcript received: ${message.text}`);
          this.handleRecognizing(this.currentChunkId, message.text);
        }
        break;

      case 'committed_transcript':
        // Only use committed_transcript if timestamps and language detection are disabled
        if (this.settings.includeTimestamps || this.settings.includeLanguageDetection) {
          logger.debug(`[ElevenLabs ASR] Received committed_transcript but Include Timestamps or Include Language Detection was set - ignoring in favor of committed_transcript_with_timestamps`);
        } else if (message.text) {
          logger.info(`[ElevenLabs ASR] Committed transcript received: ${message.text}`);
          this.handleRecognized(this.currentChunkId, message.text);
          this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
        }
        break;

      case 'committed_transcript_with_timestamps':
        // Only use committed_transcript_with_timestamps if timestamps or language detection are enabled
        if (!this.settings.includeTimestamps && !this.settings.includeLanguageDetection) {
          logger.debug(`[ElevenLabs ASR] Received committed_transcript_with_timestamps but Include Timestamps and Include Language Detection were not set - ignoring`);
        } else if (message.text) {
          logger.info(`[ElevenLabs ASR] Committed transcript with timestamps received: ${message.text}`);
          this.handleRecognized(this.currentChunkId, message.text);
          this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
          if (message.language_code) {
            logger.debug(`[ElevenLabs ASR] Detected language: ${message.language_code}`);
          }
        }
        break;

      case 'scribe_error':
      case 'scribe_auth_error':
      case 'scribe_quota_exceeded_error':
      case 'scribe_throttled_error':
      case 'scribe_unaccepted_terms_error':
      case 'scribe_rate_limited_error':
      case 'scribe_queue_overflow_error':
      case 'scribe_resource_exhausted_error':
      case 'scribe_session_time_limit_exceeded_error':
      case 'scribe_input_error':
      case 'scribe_chunk_size_exceeded_error':
      case 'scribe_insufficient_audio_activity_error':
      case 'scribe_transcriber_error':
        const errorMessage = message.message || message.error || 'Unknown ElevenLabs ASR error';
        logger.error(`[ElevenLabs ASR] Error: ${message.message_type} - ${errorMessage}`);
        await this.handleError(new Error(`${message.message_type}: ${errorMessage}`));
        break;

      default:
        logger.warn(`[ElevenLabs ASR] Unknown message type: ${JSON.stringify(message)}`);
    }
  }

  /**
   * Flushes buffered audio chunks to the WebSocket
   */
  private async flushAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0) {
      return;
    }

    logger.info(`[ElevenLabs ASR] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const buffer of this.audioBuffer) {
      await this.sendAudio(buffer);
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

    logger.warn(`[ElevenLabs ASR] Requested audio format ${requestedFormat} is not supported. Falling back to ${supportedFormats[0]}.`);
    return supportedFormats[0];
  }

  /**
   * Cleans up ElevenLabs ASR resources
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
    this.sessionId = null;
    logger.info(`[ElevenLabs ASR] Cleaned up resources`);
  }
}
