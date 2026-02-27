import { RealtimeClient, type AddPartialTranscript, type AddTranscript, type RecognitionStarted, type EndOfTranscript, type RealtimeServerMessage, type ErrorType, type Warning } from '@speechmatics/real-time-client';
import { createSpeechmaticsJWT } from '@speechmatics/auth';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';
import type { AudioFormat } from '../../../types/audio';
import { generateId, ID_PREFIXES } from '../../../utils/idGenerator';
import { appendFileSync } from 'fs';
import { TextChunk } from './IAsrProvider';

extendZodWithOpenApi(z);

/**
 * Schema for Speechmatics ASR provider configuration
 */
export const speechmaticsAsrProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('API key for authenticating with Speechmatics'),
  region: z.enum(['us', 'eu', 'apac']).default('us').describe('Speechmatics region endpoint: "us" for neu.rt.speechmatics.com, "eu" for eu2.rt.speechmatics.com, or "apac" for au.rt.speechmatics.com'),
});

export type SpeechmaticsAsrProviderConfig = z.infer<typeof speechmaticsAsrProviderConfigSchema>;

/**
 * Schema for Speechmatics ASR settings
 */
export const speechmaticsAsrSettingsSchema = z.looseObject({
  language: z.string().optional().describe('Language code for speech recognition (e.g., "en", "en-US", "es", "fr")'),
  audioFormat: z.enum(['pcm_16000', 'pcm_8000', 'pcm_44100']).default('pcm_16000').describe('Audio input format for speech recognition, defaults to pcm_16000'),
  transcriptionMode: z.enum(['standard', 'enhanced']).default('standard').describe('Transcription mode: "standard" for faster processing or "enhanced" for higher accuracy, defaults to standard'),
  enablePunctuation: z.boolean().default(true).describe('Enable automatic punctuation in transcripts, defaults to true'),
  enableFormatting: z.boolean().default(true).describe('Enable automatic formatting (numbers, dates, currency, etc.), defaults to true'),
  additionalVocab: z.array(z.string()).optional().describe('Custom vocabulary words or phrases to improve recognition accuracy'),
  enableDiarization: z.boolean().default(false).describe('Enable speaker diarization to detect different speakers, defaults to false'),
  maxDelay: z.number().min(0).max(10).optional().describe('Maximum delay in seconds for transcription results (0-10), lower values reduce latency'),
}).openapi('SpeechmaticsAsrSettings').describe('Speechmatics speech-to-text settings');

export type SpeechmaticsAsrSettings = z.infer<typeof speechmaticsAsrSettingsSchema>;

/**
 * Speechmatics ASR provider implementation
 * Provides real-time speech recognition using Speechmatics Realtime API with official Node.js SDK
 */
export class SpeechmaticsAsrProvider extends AsrProviderBase<SpeechmaticsAsrProviderConfig> {
  /** Speechmatics Realtime client instance */
  private client: RealtimeClient | null = null;

  /** Buffer for audio chunks received before connection is established */
  private audioBuffer: Buffer[] = [];

  /** Current chunk ID being processed */
  private currentChunkId: string;

  /** Flag indicating if recognition is active */
  private isRecognizing = false;

  /** Audio format for the recognition session */
  private audioFormat: AudioFormat = 'pcm_16000';

  /** Session ID received from Speechmatics */
  private sessionId: string | null = null;

  /** ASR settings for this provider instance */
  private settings: SpeechmaticsAsrSettings;

  /** JWT token for authentication */
  private jwtToken: string | null = null;

  constructor(config: SpeechmaticsAsrProviderConfig, settings: SpeechmaticsAsrSettings) {
    super(config);
    this.settings = settings;
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
  }

  /**
   * Gets the list of supported audio input formats for Speechmatics ASR
   */
  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_8000', 'pcm_44100'];
  }

  /**
   * Initializes the Speechmatics speech recognition session
   */
  async init(): Promise<void> {
    await super.init();
    this.audioBuffer = [];
    this.isRecognizing = false;
    this.sessionId = null;
    this.jwtToken = null;
    this.audioFormat = this.resolveAudioFormat(this.settings?.audioFormat);
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    logger.info(`[Speechmatics ASR] Initialized with audio format: ${this.audioFormat}, mode: ${this.settings.transcriptionMode}`);
  }

  /**
   * Starts the Speechmatics speech recognition session
   */
  async start(): Promise<void> {
    if (!this.config.apiKey) {
      const errorMessage = 'Missing required Speechmatics API key';
      logger.error(`[Speechmatics ASR] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    this.audioBuffer = [];
    this.textChunks = [];
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    this.sessionId = null;

    try {
      // Generate JWT token for authentication
      const authRegion = this.getAuthRegion(this.config.region);
      this.jwtToken = await createSpeechmaticsJWT({
        type: 'rt',
        apiKey: this.config.apiKey,
        region: authRegion,
        ttl: 3600, // 1 hour
      });

      logger.info(`[Speechmatics ASR] JWT token generated for region: ${authRegion}`);

      // Get region-specific WebSocket endpoint
      const url = this.getWebSocketUrl(this.config.region);
      const sampleRate = this.getSampleRateFromFormat(this.audioFormat);

      // Create Speechmatics Realtime client
      this.client = new RealtimeClient({
        url,
        appId: 'nexus-backend',
      });

      // Set up event handler for all server messages
      this.client.addEventListener('receiveMessage', (event) => {
        this.handleServerMessage(event.data);
      });

      // Set up socket state change handler
      this.client.addEventListener('socketStateChange', (event) => {
        logger.debug(`[Speechmatics ASR] Socket state changed to: ${event.socketState}`);
      });

      // Build transcription configuration
      const transcriptionConfig: any = {
        language: this.settings.language || 'en',
        enable_partials: true,
      };

      // Add operating point (transcription mode)
      if (this.settings.transcriptionMode) {
        transcriptionConfig.operating_point = this.settings.transcriptionMode;
      }

      // Add max delay
      if (this.settings.maxDelay !== undefined) {
        transcriptionConfig.max_delay = this.settings.maxDelay;
      }

      // Add punctuation configuration
      if (this.settings.enablePunctuation !== undefined) {
        transcriptionConfig.punctuation_overrides = {
          sensitivity: this.settings.enablePunctuation ? 0.5 : 0,
        };
      }

      // Add entities/formatting configuration
      if (this.settings.enableFormatting !== undefined) {
        transcriptionConfig.enable_entities = this.settings.enableFormatting;
      }

      // Add diarization configuration
      if (this.settings.enableDiarization) {
        transcriptionConfig.diarization = 'speaker';
      }

      // Add custom vocabulary
      if (this.settings.additionalVocab && this.settings.additionalVocab.length > 0) {
        transcriptionConfig.additional_vocab = this.settings.additionalVocab.map((word) => ({
          content: word,
          sounds_like: [word],
        }));
      }

      logger.info(`[Speechmatics ASR] Starting client (region: ${this.config.region}, language: ${transcriptionConfig.language}, mode: ${this.settings.transcriptionMode}, sampleRate: ${sampleRate})`);

      // Start the client with JWT and configuration
      const recognitionStarted = await this.client.start(this.jwtToken, {
        transcription_config: transcriptionConfig,
        audio_format: {
          type: 'raw',
          encoding: 'pcm_s16le',
          sample_rate: sampleRate,
        },
      });

      this.sessionId = recognitionStarted.id || null;
      this.isRecognizing = true;
      logger.info(`[Speechmatics ASR] Recognition started, session ID: ${this.sessionId}`);

      if (this.onRecognitionStartedCallback) {
        this.onRecognitionStartedCallback();
      }

      // Send buffered audio chunks
      this.flushAudioBuffer();
    } catch (error) {
      const errorMessage = `Failed to start Speechmatics recognition: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[Speechmatics ASR] ${errorMessage}`);
      await this.handleError(error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * Stops the Speechmatics speech recognition session
   */
  async stop(): Promise<void> {
    logger.info(`[Speechmatics ASR] Stopping recognition`);

    if (!this.client) {
      logger.warn(`[Speechmatics ASR] No active client, cannot stop`);
      return;
    }

    try {
      // Stop recognition by sending EndOfStream message
      await this.client.stopRecognition();
      logger.info(`[Speechmatics ASR] Recognition stopped successfully`);
    } catch (error) {
      logger.error(`[Speechmatics ASR] Error stopping recognition: ${error}`);
      throw error;
    }
  }

  /**
   * Sends audio data to the Speechmatics speech recognition service
   * @param audio Binary audio data buffer to be processed
   * @param format Optional audio format (should match configured format)
   */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    if (format && format !== this.audioFormat) {
      logger.warn(`[Speechmatics ASR] Received audio format ${format} does not match configured format ${this.audioFormat}. Using ${this.audioFormat}.`);
    }

    if (this.isRecognizing && this.client) {
      // Send audio data to Speechmatics using SDK
      this.client.sendAudio(audio);
      logger.debug(`[Speechmatics ASR] Sent audio chunk (${audio.length} bytes)`);
    } else {
      // Buffer audio until connection is established
      this.audioBuffer.push(audio);
      logger.debug(`[Speechmatics ASR] Buffered audio chunk (${audio.length} bytes), total buffered: ${this.audioBuffer.length}`);
    }
  }

  /**
   * Handles server messages from Speechmatics
   * @param message Server message from Speechmatics
   */
  private handleServerMessage(message: RealtimeServerMessage): void {
    appendFileSync('speechmatics_messages.log', JSON.stringify(message) + '\n'); // Log raw messages for debugging
    try {
      switch (message.message) {
        case 'RecognitionStarted':
          this.handleRecognitionStartedMessage(message as RecognitionStarted);
          break;

        case 'AddPartialTranscript':
          this.handlePartialTranscript(message as AddPartialTranscript);
          break;

        case 'AddTranscript':
          this.handleFinalTranscript(message as AddTranscript);
          break;

        case 'EndOfTranscript':
          this.handleEndOfTranscript(message as EndOfTranscript);
          break;

        case 'Error':
          this.handleErrorMessage(message as ErrorType);
          break;

        case 'Warning':
          this.handleWarningMessage(message as Warning);
          break;

        default:
          // Ignore other message types (AudioAdded, Info, etc.)
          logger.debug(`[Speechmatics ASR] Received message: ${message.message}`);
          break;
      }
    } catch (error) {
      logger.error(`[Speechmatics ASR] Error handling server message: ${error}`);
    }
  }

  /**
   * Handles RecognitionStarted messages
   */
  private handleRecognitionStartedMessage(message: RecognitionStarted): void {
    logger.info(`[Speechmatics ASR] Recognition started message received, ID: ${message.id}`);
  }

  /**
   * Handles partial transcript events from Speechmatics
   * @param message Partial transcript message containing interim results
   */
  private handlePartialTranscript(message: AddPartialTranscript): void {
    try {
      const partialText = message.metadata.transcript;

      if (partialText) {
        logger.debug(`[Speechmatics ASR] Partial transcript: "${partialText}"`);
        this.handleRecognizing(this.currentChunkId, partialText);
      }
    } catch (error) {
      logger.error(`[Speechmatics ASR] Error handling partial transcript: ${error}`);
    }
  }

  /**
   * Handles final transcript events from Speechmatics
   * @param message Final transcript message containing completed results
   */
  private handleFinalTranscript(message: AddTranscript): void {
    try {
      const finalText = message.metadata.transcript;

      if (finalText) {
        logger.info(`[Speechmatics ASR] Final transcript: "${finalText}"`);
        this.handleRecognized(this.currentChunkId, finalText);
        // Generate new chunk ID for next transcript
        this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
      }
    } catch (error) {
      logger.error(`[Speechmatics ASR] Error handling final transcript: ${error}`);
    }
  }

  getAllTextChunks(): TextChunk[] {
    const chunk: TextChunk = {
      chunkId: this.textChunks[0].chunkId,
      text: this.textChunks.map((c) => c.text).join(''),
      timestamp: new Date(),
    }
    return [chunk];
  }

  /**
   * Handles end of transcript messages
   */
  private handleEndOfTranscript(message: EndOfTranscript): void {
    logger.info(`[Speechmatics ASR] End of transcript received`);
    const wasRecognizing = this.isRecognizing;
    this.isRecognizing = false;
    this.client = null;
    this.jwtToken = null;

    if (wasRecognizing) {
      this.handleRecognitionStopped();
    }
  }

  /**
   * Handles error messages from Speechmatics
   */
  private handleErrorMessage(message: ErrorType): void {
    const errorText = `Speechmatics error: ${message.type} - ${message.reason || 'Unknown error'}`;
    logger.error(`[Speechmatics ASR] ${errorText}`);
    this.handleError(new Error(errorText));
  }

  /**
   * Handles warning messages from Speechmatics
   */
  private handleWarningMessage(message: Warning): void {
    logger.warn(`[Speechmatics ASR] Warning: ${message.type} - ${message.reason || 'Unknown warning'}`);
  }

  /**
   * Flushes buffered audio chunks to the Speechmatics client
   */
  private flushAudioBuffer(): void {
    if (this.audioBuffer.length > 0 && this.client && this.isRecognizing) {
      logger.info(`[Speechmatics ASR] Flushing ${this.audioBuffer.length} buffered audio chunks`);
      for (const buffer of this.audioBuffer) {
        this.client.sendAudio(buffer);
      }
      this.audioBuffer = [];
    }
  }

  /**
   * Gets the WebSocket URL for the specified region
   * @param region Region identifier
   * @returns WebSocket endpoint URL for the specified region
   */
  private getWebSocketUrl(region: string): string {
    switch (region) {
      case 'eu':
        return 'wss://eu2.rt.speechmatics.com/v2';
      case 'apac':
        return 'wss://au.rt.speechmatics.com/v2';
      case 'us':
      default:
        return 'wss://neu.rt.speechmatics.com/v2';
    }
  }

  /**
   * Gets the auth region code for JWT generation
   * @param region Region identifier
   * @returns Auth region code for createSpeechmaticsJWT
   */
  private getAuthRegion(region: string): 'eu' | 'usa' | 'au' {
    switch (region) {
      case 'eu':
        return 'eu';
      case 'apac':
        return 'au';
      case 'us':
      default:
        return 'usa';
    }
  }

  /**
   * Resolves the requested audio format to a supported format
   * @param requestedFormat The requested audio format
   * @returns The resolved audio format (falls back to default if unsupported)
   */
  private resolveAudioFormat(requestedFormat?: AudioFormat): AudioFormat {
    const supportedFormats = this.getSupportedInputFormats();
    if (requestedFormat && supportedFormats.includes(requestedFormat)) {
      return requestedFormat;
    }
    logger.warn(`[Speechmatics ASR] Requested audio format ${requestedFormat} not supported. Using default: pcm_16000`);
    return 'pcm_16000';
  }

  /**
   * Gets the sample rate from an audio format string
   * @param format Audio format string (e.g., 'pcm_16000')
   * @returns Sample rate in Hz
   */
  private getSampleRateFromFormat(format: AudioFormat): number {
    const match = format.match(/(\d+)/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 16000; // Default to 16kHz
  }
}

