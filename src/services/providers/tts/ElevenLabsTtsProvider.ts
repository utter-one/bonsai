import WebSocket, {  } from 'ws';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import { VoiceConfig } from '../../../http/contracts/persona';

extendZodWithOpenApi(z);

/**
 * Schema for ElevenLabs TTS provider configuration
 */
export const elevenLabsTtsProviderConfigSchema = z.object({
  apiKey: z.string().describe('API key for authenticating with ElevenLabs'),
});

export type ElevenLabsTtsProviderConfig = z.infer<typeof elevenLabsTtsProviderConfigSchema>;

/**
 * Voice-specific settings for ElevenLabs TTS
 */
export type ElevenLabsTtsVoiceSettings = {
  /** Model ID to use for speech synthesis (e.g., 'eleven_flash_v2_5') */
  model?: string;
  /** Default voice ID to use if not specified in start() */
  voiceId?: string;
  /** Markers to identify sections of text that should not be spoken */
  noSpeechMarkers?: NoSpeechMarker[];
  /** Whether to replace exclamation marks with periods */
  removeExclamationMarks?: boolean;
  /** Voice stability setting (0.0 - 1.0), defaults to 0.5 */
  stability?: number | null;
  /** Similarity boost setting (0.0 - 1.0), defaults to 0.75 */
  similarityBoost?: number | null;
  /** Style setting for V2+ models (0.0 - 1.0), defaults to 0 */
  style?: number | null;
  /** Enable speaker boost for V2+ models, defaults to true */
  useSpeakerBoost?: boolean | null;
  /** Speech speed (0.7 - 1.2), defaults to 1.0 */
  speed?: number | null;
  /** Use global preview endpoint for geographic proximity optimization */
  useGlobalPreview?: boolean;
  /** WebSocket inactivity timeout in seconds, defaults to 180 */
  inactivityTimeout?: number;
  /** Whether to use sentence splitter for text processing, defaults to true */
  useSentenceSplitter?: boolean;
};

/**
 * ElevenLabs TTS provider implementation
 * Provides real-time text-to-speech synthesis using ElevenLabs streaming API
 */
export class ElevenLabsTtsProvider extends TtsProviderBase<ElevenLabsTtsProviderConfig> {
  /** WebSocket connection to ElevenLabs streaming API */
  private socket: WebSocket | null = null;

  /** Sentence splitter for processing streaming text */
  private sentenceSplitter: SentenceSplitter | null = null;

  /** Current no-speech marker being processed */
  private inNoSpeechSection?: NoSpeechMarker;

  /** Buffer for accumulating audio chunks */
  private audioChunks: Buffer[] = [];

  /** Total duration of audio generated so far in milliseconds */
  private audioDurationMs: number = 0;

  /** Voice configuration used for this TTS session */
  private voiceSettings: ElevenLabsTtsVoiceSettings = null;

  async init(voiceConfig: VoiceConfig): Promise<void> {
    this.voiceSettings = voiceConfig as ElevenLabsTtsVoiceSettings;
  }

  /**
   * Starts the speech generation session
   */
  async start(): Promise<void> {
    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.audioChunks = [];
    this.audioDurationMs = 0;

    // Merge conversation config with provider config
    const effectiveVoiceId = this.voiceSettings.voiceId;
    const effectiveSpeed = this.voiceSettings.speed ?? 1.0;
    const effectiveModel = this.voiceSettings.model ?? 'eleven_flash_v2_5';

    if (!effectiveVoiceId) {
      throw new Error('Voice ID must be provided either in config or start() parameters');
    }

    // Initialize sentence splitter with callback to send complete sentences (if enabled)
    const useSentenceSplitter = this.voiceSettings.useSentenceSplitter ?? true;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          return false;
        }
        await this.sendTextToSocket(sentence);
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    logger.info(`[ElevenLabs] Starting speech generation with voiceId: ${effectiveVoiceId}, model: ${effectiveModel}, speed: ${effectiveSpeed}, stability: ${this.voiceSettings.stability}, similarityBoost: ${this.voiceSettings.similarityBoost}`);

    const useGlobalPreview = this.voiceSettings.useGlobalPreview ?? true;
    const baseUrl = useGlobalPreview ? 'wss://api-global-preview.elevenlabs.io' : 'wss://api.elevenlabs.io';
    const inactivityTimeout = this.voiceSettings.inactivityTimeout ?? 180;
    const wsUrl = `${baseUrl}/v1/text-to-speech/${effectiveVoiceId}/stream-input?model_id=${effectiveModel}&output_format=pcm_16000&inactivity_timeout=${inactivityTimeout}`;

    return new Promise<void>((resolve, reject) => {
      this.socket = new WebSocket(wsUrl);

      this.socket.on('open', async () => {
        await this.handleWebSocketOpen(effectiveSpeed);
        resolve();
      });

      this.socket.on('message', async (data: Buffer) => {
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
      logger.warn(`[ElevenLabs] No speech generation instance to end`);
      return;
    }

    // Finalize any remaining text in the sentence splitter
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    }

    logger.info(`[ElevenLabs] Ending speech generation`);

    // Send end-of-stream message
    const eosMessage = { text: '' };
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(eosMessage));
    }
  }

  /**
   * Sends text to the speech generation service
   * @param text The text content to be converted to speech
   */
  async sendText(text: string): Promise<void> {
    if (this.sentenceSplitter) {
      logger.info(`[ElevenLabs] Adding text to sentence splitter: "${text}"`);
      // Add text to sentence splitter - it will automatically call sendTextToSocket for each complete sentence
      await this.sentenceSplitter.addText(text);
    } else {
      logger.info(`[ElevenLabs] Sending text directly: "${text}"`);
      // Send text directly without sentence splitting
      await this.sendTextToSocket(text);
    }
  }

  /**
   * Handles WebSocket connection open event
   * @param speed The speech speed to use
   */
  private async handleWebSocketOpen(speed: number): Promise<void> {
    if (!this.socket) return;

    // Build voice_settings object, only including defined values
    const voiceSettings: Record<string, any> = {};

    if (this.voiceSettings.stability !== null && this.voiceSettings.stability !== undefined) {
      voiceSettings.stability = this.voiceSettings.stability;
    }
    if (this.voiceSettings.similarityBoost !== null && this.voiceSettings.similarityBoost !== undefined) {
      voiceSettings.similarity_boost = this.voiceSettings.similarityBoost;
    }
    if (speed !== null && speed !== undefined) {
      voiceSettings.speed = speed;
    }
    if (this.voiceSettings.style !== null && this.voiceSettings.style !== undefined) {
      voiceSettings.style = this.voiceSettings.style;
    }
    if (this.voiceSettings.useSpeakerBoost !== null && this.voiceSettings.useSpeakerBoost !== undefined) {
      voiceSettings.use_speaker_boost = this.voiceSettings.useSpeakerBoost;
    }

    const bosMessage: Record<string, any> = {
      text: ' ',
      xi_api_key: this.config.apiKey,
      auto_mode: true,
      generation_config: {
        chunk_length_schedule: [50, 50, 50, 80, 120],
      },
    };

    // Only include voice_settings if we have any settings to apply
    if (Object.keys(voiceSettings).length > 0) {
      bosMessage.voice_settings = voiceSettings;
    }

    this.socket.send(JSON.stringify(bosMessage));
    logger.info(`[ElevenLabs] Connection established with voice settings: ${JSON.stringify(voiceSettings)}`);

    this.handleGenerationStarted();
  }

  /**
   * Handles WebSocket message events containing audio chunks
   * @param data The raw WebSocket message data
   */
  private async handleWebSocketMessage(data: Buffer): Promise<void> {
    const response = JSON.parse(data.toString());
    logger.debug(`[ElevenLabs] Message received`);

    if (response.audio) {
      const buffer = Buffer.from(response.audio, 'base64');
      this.audioChunks.push(buffer);

      if (response.alignment?.chars?.length) {
        const text = response.alignment.chars.join('').replace(/\s+/g, ' ');
        const concatenatedBuffer = Buffer.concat([...this.audioChunks]);
        const chunkDuration = response.alignment.charStartTimesMs.at(-1) + response.alignment.charDurationsMs.at(-1);
        this.audioDurationMs += chunkDuration;
        this.audioChunks = [];

        logger.info(`[ElevenLabs] Chunk #${this.chunkOrdinal} duration: ${chunkDuration}ms`);

        const chunk: GeneratedAudioChunk = {
          chunkId: this.generateChunkId(),
          ordinal: this.getNextOrdinal(),
          audio: concatenatedBuffer,
          text: text + ' ',
          durationMs: chunkDuration,
          startMs: this.audioDurationMs - chunkDuration,
          endMs: this.audioDurationMs,
          isFinal: false,
        };
        await this.handleSpeechGenerating(chunk);
      }
    }

    if (response.isFinal) {
      logger.info(`[ElevenLabs] Final response received`);

      if (this.audioChunks.length > 0) {
        const concatenatedBuffer = Buffer.concat([...this.audioChunks]);
        logger.info(`[ElevenLabs] Chunk #${this.chunkOrdinal} duration: 0ms (final)`);

        const chunk: GeneratedAudioChunk = {
          chunkId: this.generateChunkId(),
          ordinal: this.getNextOrdinal(),
          audio: concatenatedBuffer,
          text: '',
          durationMs: 0,
          startMs: this.audioDurationMs,
          endMs: this.audioDurationMs,
          isFinal: true,
        };
        await this.handleSpeechGenerating(chunk);
        this.audioChunks = [];
      }

      if (this.socket) {
        this.socket.close();
      }
    }
  }

  /**
   * Handles WebSocket error events
   * @param error The error that occurred
   */
  private async handleWebSocketError(error: Error): Promise<void> {
    const errorMessage = `ElevenLabs TTS connection error: ${error.message || 'WebSocket connection failed'}`;
    logger.error(`[ElevenLabs] Error: ${errorMessage}`);
    await this.handleError(new Error(errorMessage));
  }

  /**
   * Handles WebSocket close events
   * @param code The close code
   * @param reason The close reason
   */
  private async handleWebSocketClose(code: number, reason: string): Promise<void> {
    logger.info(`[ElevenLabs] Connection closed with code ${code}: ${reason}`);
    this.handleGenerationEnded();
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
    if (this.voiceSettings.noSpeechMarkers && this.voiceSettings.noSpeechMarkers.length > 0) {
      const startsInFilter = !!this.inNoSpeechSection;
      const { indexes, currentMarker } = this.getFilterIndexes(text, this.voiceSettings.noSpeechMarkers, this.inNoSpeechSection);
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
    if (this.voiceSettings.removeExclamationMarks) {
      text = text.replace(/!/g, '.');
    }

    logger.info(`[ElevenLabs] Sending sentence: "${text}"`);

    const textMessage = {
      text: text,
      flush: true,
    };

    this.socket.send(JSON.stringify(textMessage), async (error?: Error) => {
      if (error) {
        const errorMessage = `Failed to send text to ElevenLabs TTS: ${error.message}`;
        logger.error(`[ElevenLabs] Error sending sentence: ${errorMessage}`);
        await this.handleError(new Error(errorMessage));
      }
    });
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
    this.audioChunks = [];
    this.audioDurationMs = 0;

    await super.cleanup();
  }
}
