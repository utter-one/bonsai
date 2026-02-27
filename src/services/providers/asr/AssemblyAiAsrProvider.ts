import { AssemblyAI, StreamingTranscriber, StreamingTranscriberParams } from 'assemblyai';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';
import type { AudioFormat } from '../../../types/audio';
import { generateId, ID_PREFIXES } from '../../../utils/idGenerator';

extendZodWithOpenApi(z);

/**
 * Schema for AssemblyAI ASR provider configuration
 */
export const assemblyAiAsrProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('API key for authenticating with AssemblyAI'),
  region: z.enum(['us', 'eu']).default('us').describe('AssemblyAI region endpoint: "us" for streaming.assemblyai.com or "eu" for streaming.eu.assemblyai.com'),
});

export type AssemblyAiAsrProviderConfig = z.infer<typeof assemblyAiAsrProviderConfigSchema>;

/**
 * Schema for AssemblyAI ASR settings
 */
export const assemblyAiAsrSettingsSchema = z.looseObject({
  sampleRate: z.number().int().default(16000).describe('Audio sample rate in Hz (8000, 16000, 22050, 24000, 44100), defaults to 16000'),
  formatTurns: z.boolean().default(false).describe('Enable formatted transcripts with capitalization and punctuation (adds latency, not recommended for voice agents), defaults to false'),
  speechModel: z.enum(['universal-streaming-english', 'universal-streaming-multilingual']).default('universal-streaming-english').describe('Speech model to use: English-only or multilingual (supports English, Spanish, French, German, Italian, Portuguese), defaults to universal-streaming-english'),
  keytermsPrompt: z.array(z.string()).optional().describe('List of custom words or phrases to improve recognition accuracy'),
  vadThreshold: z.number().min(0).max(1).default(0.4).describe('Voice activity detection confidence threshold (0.0 to 1.0) for classifying audio frames as silence, defaults to 0.4'),
  endOfTurnConfidenceThreshold: z.number().min(0).max(1).default(0.4).describe('Confidence threshold (0.0 to 1.0) for determining end of turn, defaults to 0.4'),
  minEndOfTurnSilenceWhenConfident: z.number().int().min(0).default(400).describe('Minimum silence in milliseconds required to detect end of turn when confident, defaults to 400'),
  maxTurnSilence: z.number().int().min(0).default(1280).describe('Maximum silence in milliseconds allowed in a turn before triggering end of turn, defaults to 1280'),
  inactivityTimeout: z.number().int().min(5).max(3600).optional().describe('Time in seconds of inactivity before session is terminated (5-3600), no timeout if not set'),
}).openapi('AssemblyAiAsrSettings').describe('AssemblyAI speech-to-text settings');

export type AssemblyAiAsrSettings = z.infer<typeof assemblyAiAsrSettingsSchema>;

/**
 * AssemblyAI ASR provider implementation
 * Provides real-time speech recognition using AssemblyAI Universal Streaming API with official Node.js SDK
 */
export class AssemblyAiAsrProvider extends AsrProviderBase<AssemblyAiAsrProviderConfig> {
  /** AssemblyAI client instance */
  private client: AssemblyAI;

  /** Streaming transcriber instance */
  private transcriber: StreamingTranscriber | null = null;

  /** Buffer for audio chunks received before connection is established */
  private audioBuffer: Buffer[] = [];

  /** Map of turn order to chunk IDs for consistent chunk tracking */
  private turnChunkIds: Map<number, string> = new Map();

  /** Map of turn order to last known transcript for finalizing pending turns */
  private turnTranscripts: Map<number, string> = new Map();

  /** Flag indicating if recognition is active */
  private isRecognizing = false;

  /** Audio format for the recognition session */
  private audioFormat: AudioFormat = 'pcm_16000';

  /** Session ID received from AssemblyAI */
  private sessionId: string | null = null;

  /** ASR settings for this provider instance */
  private settings: AssemblyAiAsrSettings;

  constructor(config: AssemblyAiAsrProviderConfig, settings: AssemblyAiAsrSettings) {
    super(config);
    this.settings = settings;

    // Initialize AssemblyAI client with region-specific endpoint
    const baseUrl = config.region === 'eu'
      ? 'https://streaming.eu.assemblyai.com'
      : 'https://streaming.assemblyai.com';

    this.client = new AssemblyAI({
      apiKey: config.apiKey,
      baseUrl,
    });
  }

  /**
   * Gets the list of supported audio input formats for AssemblyAI ASR
   */
  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100'];
  }

  /**
   * Initializes the AssemblyAI speech recognition session
   */
  async init(): Promise<void> {
    await super.init();
    this.audioBuffer = [];
    this.isRecognizing = false;
    this.sessionId = null;
    this.turnChunkIds.clear();
    this.turnTranscripts.clear();
    this.audioFormat = this.resolveAudioFormat(this.getAudioFormatFromSampleRate(this.settings.sampleRate));
    logger.info(`[AssemblyAI ASR] Initialized with audio format: ${this.audioFormat}, model: ${this.settings.speechModel}`);
  }

  /**
   * Starts the AssemblyAI speech recognition session
   */
  async start(): Promise<void> {
    if (!this.config.apiKey) {
      const errorMessage = 'Missing required AssemblyAI API key';
      logger.error(`[AssemblyAI ASR] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    this.audioBuffer = [];
    this.textChunks = [];
    this.turnChunkIds.clear();
    this.turnTranscripts.clear();
    this.sessionId = null;

    // Build transcriber configuration
    const transcriberConfig: StreamingTranscriberParams = {
      sampleRate: this.settings.sampleRate,
      encoding: 'pcm_s16le' as const,
    };

    // Add optional parameters
    if (this.settings.formatTurns !== undefined) {
      transcriberConfig.formatTurns = this.settings.formatTurns;
    }
    if (this.settings.speechModel) {
      transcriberConfig.speechModel = this.settings.speechModel;
    }
    if (this.settings.keytermsPrompt && this.settings.keytermsPrompt.length > 0) {
      transcriberConfig.keytermsPrompt = this.settings.keytermsPrompt;
    }
    if (this.settings.vadThreshold !== undefined) {
      transcriberConfig.vadThreshold = this.settings.vadThreshold;
    }
    if (this.settings.endOfTurnConfidenceThreshold !== undefined) {
      transcriberConfig.endOfTurnConfidenceThreshold = this.settings.endOfTurnConfidenceThreshold;
    }
    if (this.settings.minEndOfTurnSilenceWhenConfident !== undefined) {
      transcriberConfig.minEndOfTurnSilenceWhenConfident = this.settings.minEndOfTurnSilenceWhenConfident;
    }
    if (this.settings.maxTurnSilence !== undefined) {
      transcriberConfig.maxTurnSilence = this.settings.maxTurnSilence;
    }
    if (this.settings.inactivityTimeout !== undefined) {
      transcriberConfig.inactivityTimeout = this.settings.inactivityTimeout;
    }

    logger.info(`[AssemblyAI ASR] Creating transcriber (region: ${this.config.region}, model: ${this.settings.speechModel}, sampleRate: ${this.settings.sampleRate})`);

    // Create transcriber instance
    this.transcriber = this.client.streaming.transcriber(transcriberConfig);

    // Set up event handlers
    this.transcriber.on('open', (event) => {
      this.sessionId = event.id;
      this.isRecognizing = true;
      logger.info(`[AssemblyAI ASR] Connection opened, session ID: ${event.id}, expires at: ${new Date(event.expires_at * 1000).toISOString()}`);

      if (this.onRecognitionStartedCallback) {
        this.onRecognitionStartedCallback();
      }

      // Send buffered audio chunks
      this.flushAudioBuffer();
    });

    this.transcriber.on('turn', (turn) => {
      this.handleTurnEvent(turn);
    });

    this.transcriber.on('close', (code, reason) => {
      logger.info(`[AssemblyAI ASR] Connection closed: code=${code}, reason=${reason}`);
      const wasRecognizing = this.isRecognizing;
      this.isRecognizing = false;
      this.transcriber = null;

      // Only finalize and trigger stopped callback if this is an unexpected close
      // (not from our explicit stop() call which already handles this)
      if (wasRecognizing) {
        logger.info(`[AssemblyAI ASR] Unexpected close, finalizing pending turns`);
        this.finalizePendingTurns();
        this.handleRecognitionStopped();
      }
    });

    this.transcriber.on('error', (error: Error) => {
      logger.error(`[AssemblyAI ASR] Error: ${error.message}`);
      this.handleError(error);
    });

    // Connect to AssemblyAI
    logger.info(`[AssemblyAI ASR] Connecting to AssemblyAI streaming service...`);
    await this.transcriber.connect();
  }

  /**
   * Stops the AssemblyAI speech recognition session
   */
  async stop(): Promise<void> {
    logger.info(`[AssemblyAI ASR] Stopping recognition`);

    if (!this.transcriber) {
      logger.warn(`[AssemblyAI ASR] No active transcriber, cannot stop`);
      return;
    }

    const wasRecognizing = this.isRecognizing;
    this.isRecognizing = false;

    try {
      // Close the transcriber
      await this.transcriber.close();
      logger.info(`[AssemblyAI ASR] Transcriber closed successfully`);
    } catch (error) {
      logger.error(`[AssemblyAI ASR] Error closing transcriber: ${error}`);
      throw error;
    } finally {
      this.transcriber = null;

      // Manually finalize pending turns and trigger stopped callback
      // (the close event doesn't always fire when explicitly calling close())
      if (wasRecognizing) {
        this.finalizePendingTurns();
        this.handleRecognitionStopped();
      }
    }
  }

  /**
   * Sends audio data to the AssemblyAI speech recognition service
   * @param audio Binary audio data buffer to be processed
   * @param format Optional audio format (should match configured format)
   */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    if (format && format !== this.audioFormat) {
      logger.warn(`[AssemblyAI ASR] Received audio format ${format} does not match configured format ${this.audioFormat}. Using ${this.audioFormat}.`);
    }

    if (this.isRecognizing && this.transcriber) {
      // Send audio data to AssemblyAI using SDK (convert Buffer to ArrayBuffer)
      const arrayBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
      this.transcriber.sendAudio(arrayBuffer);
      logger.debug(`[AssemblyAI ASR] Sent audio chunk (${audio.length} bytes)`);
    } else {
      // Buffer audio until connection is ready
      this.audioBuffer.push(audio);
      logger.debug(`[AssemblyAI ASR] Buffered audio chunk (${audio.length} bytes)`);
    }
  }

  /**
   * Handles Turn event from AssemblyAI SDK
   * @param turn The Turn event object from the SDK
   */
  private handleTurnEvent(turn: any): void {
    const { turn_order, turn_is_formatted, end_of_turn, transcript, end_of_turn_confidence } = turn;

    // Empty transcript - skip
    if (!transcript || transcript.trim() === '') {
      logger.debug(`[AssemblyAI ASR] Empty transcript received for turn ${turn_order}`);
      return;
    }

    // Get or create chunk ID for this turn
    let chunkId = this.turnChunkIds.get(turn_order);
    if (!chunkId) {
      chunkId = generateId(ID_PREFIXES.CHUNK);
      this.turnChunkIds.set(turn_order, chunkId);
    }

    // Store the latest transcript for this turn in case we need to finalize it later
    this.turnTranscripts.set(turn_order, transcript);

    logger.info(`[AssemblyAI ASR] Turn ${turn_order}: "${transcript}" (end_of_turn=${end_of_turn}, formatted=${turn_is_formatted}, confidence=${end_of_turn_confidence})`);

    // Determine if this is a partial or final result
    // Partial: turn is not ended OR turn is ended but not yet formatted (if formatting is enabled)
    // Final: turn is ended AND (formatted OR formatting is disabled)
    const isPartial = !end_of_turn || (this.settings.formatTurns && !turn_is_formatted);

    if (isPartial) {
      // Interim/partial result
      this.handleRecognizing(chunkId, transcript);
    } else {
      // Final result - this is the definitive transcript for this turn
      this.handleRecognized(chunkId, transcript);
      // Clean up the mappings for this turn
      this.turnChunkIds.delete(turn_order);
      this.turnTranscripts.delete(turn_order);
    }
  }

  /**
   * Finalizes any pending turns that haven't reached end_of_turn=true
   * This is called when the connection closes to ensure all partial transcripts are sent as final results
   */
  private finalizePendingTurns(): void {
    if (this.turnChunkIds.size === 0) {
      return;
    }

    logger.info(`[AssemblyAI ASR] Finalizing ${this.turnChunkIds.size} pending turn(s)`);

    // Iterate through all pending turns and finalize them with their last known transcript
    for (const [turnOrder, chunkId] of this.turnChunkIds.entries()) {
      const transcript = this.turnTranscripts.get(turnOrder);
      if (transcript && transcript.trim() !== '') {
        logger.info(`[AssemblyAI ASR] Finalizing pending turn ${turnOrder}: "${transcript}"`);
        this.handleRecognized(chunkId, transcript);
      }
    }

    // Clear the maps
    this.turnChunkIds.clear();
    this.turnTranscripts.clear();
  }

  /**
   * Flushes buffered audio chunks to the transcriber
   */
  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) {
      return;
    }

    logger.info(`[AssemblyAI ASR] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const buffer of this.audioBuffer) {
      if (this.transcriber) {
        // Convert Buffer to ArrayBuffer
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        this.transcriber.sendAudio(arrayBuffer);
      }
    }
    this.audioBuffer = [];
  }

  /**
   * Converts sample rate to audio format string
   * @param sampleRate Sample rate in Hz
   * @returns Audio format string (e.g., 'pcm_16000')
   */
  private getAudioFormatFromSampleRate(sampleRate: number): AudioFormat {
    return `pcm_${sampleRate}` as AudioFormat;
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

    logger.warn(`[AssemblyAI ASR] Requested audio format ${requestedFormat} is not supported. Falling back to ${supportedFormats[0]}.`);
    return supportedFormats[0];
  }

  /**
   * Cleans up AssemblyAI ASR resources
   */
  async cleanup(): Promise<void> {
    await super.cleanup();

    if (this.transcriber) {
      try {
        await this.transcriber.close();
      } catch (error) {
        logger.error(`[AssemblyAI ASR] Error closing transcriber during cleanup: ${error}`);
      }
      this.transcriber = null;
    }

    this.audioBuffer = [];
    this.turnChunkIds.clear();
    this.turnTranscripts.clear();
    this.isRecognizing = false;
    this.sessionId = null;
    logger.info(`[AssemblyAI ASR] Cleaned up resources`);
  }
}
