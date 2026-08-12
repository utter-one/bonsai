import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { SonioxNodeClient } from '@soniox/node';
import { logger } from '../../../utils/logger';
import { TtsProviderBase } from './TtsProviderBase';
import { GeneratedAudioChunk, NoSpeechMarker } from './ITtsProvider';
import { SentenceSplitter } from './SentenceSplitter';
import type { AudioFormat } from '../../../types/audio';

extendZodWithOpenApi(z);

export const sonioxTtsProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('API key for authenticating with Soniox'),
  region: z.enum(['us', 'eu', 'jp']).default('us').describe('Soniox region: "us" (default), "eu", or "jp"'),
});

export type SonioxTtsProviderConfig = z.infer<typeof sonioxTtsProviderConfigSchema>;

export const sonioxTtsSettingsSchema = z.object({
  provider: z.literal('soniox').describe('TTS provider type identifier'),
  model: z.string().default('tts-rt-v1').describe('TTS model to use. Defaults to "tts-rt-v1"'),
  voiceId: z.string().default('Adrian').describe('Voice ID to use for speech synthesis. Defaults to "Adrian"'),
  language: z.string().default('en').describe('Language code for speech synthesis (e.g., "en", "es", "fr"). Defaults to "en"'),
  audioFormat: z.enum(['pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'mulaw', 'alaw', 'mp3', 'opus', 'flac', 'aac']).optional().describe('Preferred audio output format. Defaults to "pcm_16000"'),
  speed: z.number().min(0.7).max(1.3).optional().describe('Speaking rate multiplier (0.7 to 1.3, default: 1.0)'),
  bitrate: z.number().int().positive().optional().describe('Codec bitrate in bps for compressed formats (e.g., 128000)'),
  noSpeechMarkers: z.array(z.object({ start: z.string().min(1), end: z.string().min(1) })).optional().describe('Markers to identify sections of text that should not be spoken'),
  removeExclamationMarks: z.boolean().optional().describe('Whether to replace exclamation marks with periods'),
  useSentenceSplitter: z.boolean().optional().describe('Whether to use sentence splitter for text processing. Defaults to true'),
}).loose().openapi('SonioxTtsSettings');

export type SonioxTtsSettings = z.infer<typeof sonioxTtsSettingsSchema>;

export type SonioxAudioChunk = GeneratedAudioChunk & {
  sampleRate: number;
};

export class SonioxTtsProvider extends TtsProviderBase<SonioxTtsProviderConfig, SonioxAudioChunk> {
  private client: SonioxNodeClient | null = null;

  private stream: Awaited<ReturnType<SonioxNodeClient['realtime']['tts']>> | null = null;

  private sentenceSplitter: SentenceSplitter | null = null;

  private textBuffer: string = '';

  private inNoSpeechSection?: NoSpeechMarker;

  private settings: SonioxTtsSettings;

  private audioFormat: AudioFormat = 'pcm_16000';

  private sampleRate: number = 16000;

  private isActiveGeneration: boolean = false;

  private pendingGenerationEnd: boolean = false;

  private pendingFlushCount: number = 0;

  constructor(config: SonioxTtsProviderConfig, settings: SonioxTtsSettings) {
    super(config);
    this.settings = settings;
  }

  async init(): Promise<void> {
    this.resolveAudioFormat();
    logger.info(`[Soniox TTS] Initialized with audio format: ${this.audioFormat}, sample rate: ${this.sampleRate}`);
  }

  getSupportedFormats(): AudioFormat[] {
    return ['pcm_8000', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100', 'mulaw', 'alaw', 'mp3', 'opus', 'flac', 'aac'];
  }

  getOutputFormat(): AudioFormat {
    const requestedFormat = this.settings.audioFormat ?? 'pcm_16000';
    const supportedFormats = this.getSupportedFormats();
    if (!supportedFormats.includes(requestedFormat)) {
      return 'pcm_16000';
    }
    return requestedFormat;
  }

  async start(): Promise<void> {
    this.resetOrdinal();
    this.inNoSpeechSection = undefined;
    this.textBuffer = '';
    this.isActiveGeneration = true;
    this.pendingGenerationEnd = false;
    this.pendingFlushCount = 0;

    const useSentenceSplitter = this.settings.useSentenceSplitter ?? true;
    if (useSentenceSplitter) {
      this.sentenceSplitter = new SentenceSplitter(async (sentence: string) => {
        if (!this.stream || this.stream.state !== 'active') {
          return false;
        }
        await this.sendTextToStream(sentence);
        return true;
      });
    } else {
      this.sentenceSplitter = null;
    }

    this.client = new SonioxNodeClient({
      api_key: this.config.apiKey,
      region: this.config.region,
    });

    const streamConfig = this.buildStreamConfig();
    this.stream = await this.client.realtime.tts(streamConfig);

    this.stream.on('audio', (chunk: Uint8Array) => {
      const audioBuffer = Buffer.from(chunk);
      const audioChunk: SonioxAudioChunk = {
        chunkId: this.generateChunkId(),
        ordinal: this.getNextOrdinal(),
        audio: audioBuffer,
        audioFormat: this.audioFormat,
        isFinal: false,
        sampleRate: this.sampleRate,
      };
      this.handleSpeechGenerating(audioChunk);
    });

    this.stream.on('audioEnd', () => {
      logger.info(`[Soniox TTS] Audio end received`);
      this.pendingFlushCount = Math.max(0, this.pendingFlushCount - 1);
      if (this.pendingGenerationEnd && this.pendingFlushCount === 0) {
        this.pendingGenerationEnd = false;
        this.handleGenerationEnded();
      }
    });

    this.stream.on('terminated', () => {
      logger.info(`[Soniox TTS] Stream terminated`);
      this.isActiveGeneration = false;
      if (this.pendingGenerationEnd) {
        this.pendingGenerationEnd = false;
        this.handleGenerationEnded();
      }
    });

    this.stream.on('error', async (error: Error) => {
      logger.error(`[Soniox TTS] Stream error: ${error.message}`);
      await this.handleError(error);
    });

    logger.info(`[Soniox TTS] Starting session with model: ${this.settings.model}, voiceId: ${this.settings.voiceId}, language: ${this.settings.language}`);
    this.handleGenerationStarted();
  }

  async end(): Promise<void> {
    if (!this.stream) {
      logger.warn(`[Soniox TTS] No active stream to end`);
      return;
    }

    if (this.sentenceSplitter) {
      await this.sentenceSplitter.finalize();
    } else if (this.textBuffer.trim()) {
      logger.info(`[Soniox TTS] Sending final buffered text: "${this.textBuffer}"`);
      await this.sendTextToStream(this.textBuffer);
      this.textBuffer = '';
    }

    logger.info(`[Soniox TTS] Ending utterance`);
    this.isActiveGeneration = false;
    this.pendingGenerationEnd = true;

    try {
      this.stream.finish();
    } catch (error) {
      logger.error(`[Soniox TTS] Error finishing stream: ${error}`);
    }

    if (this.pendingFlushCount === 0) {
      this.pendingGenerationEnd = false;
      this.handleGenerationEnded();
    }
  }

  async cancel(): Promise<void> {
    if (!this.stream) {
      logger.info(`[Soniox TTS] No active stream to cancel`);
      return;
    }

    logger.info(`[Soniox TTS] Cancelling speech generation (barge-in)`);

    const wasActive = this.isActiveGeneration || this.pendingGenerationEnd;
    this.isActiveGeneration = false;
    this.pendingGenerationEnd = false;
    this.pendingFlushCount = 0;

    try {
      this.stream.cancel();
    } catch (error) {
      logger.error(`[Soniox TTS] Error cancelling stream: ${error}`);
    }

    if (wasActive) {
      this.handleGenerationEnded();
    }
  }

  async sendText(text: string): Promise<void> {
    if (this.sentenceSplitter) {
      await this.sentenceSplitter.addText(text);
    } else {
      logger.debug(`[Soniox TTS] Buffering text: "${text}"`);
      this.textBuffer += text;
    }
  }

  private async sendTextToStream(text: string): Promise<void> {
    if (!this.stream || this.stream.state !== 'active') {
      logger.warn(`[Soniox TTS] Stream not active, state: ${this.stream?.state}`);
      return;
    }

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

    text = text.trim();
    if (!text) {
      return;
    }

    logger.debug(`[Soniox TTS] Sending text to stream: "${text}"`);
    this.pendingFlushCount++;
    this.stream.sendText(text);
  }

  private buildStreamConfig(): Parameters<SonioxNodeClient['realtime']['tts']>[0] {
    const formatMapping = this.mapAudioFormatToSoniox(this.audioFormat);

    const config: Parameters<SonioxNodeClient['realtime']['tts']>[0] = {
      model: this.settings.model,
      voice: this.settings.voiceId,
      language: this.settings.language,
      audio_format: formatMapping.format,
      sample_rate: formatMapping.sampleRate,
    };

    if (this.settings.speed) {
      config.speed = this.settings.speed;
    }

    if (this.settings.bitrate) {
      config.bitrate = this.settings.bitrate;
    }

    return config;
  }

  private mapAudioFormatToSoniox(audioFormat: AudioFormat): { format: string; sampleRate?: number } {
    switch (audioFormat) {
      case 'pcm_8000':
        return { format: 'pcm_s16le', sampleRate: 8000 };
      case 'pcm_16000':
        return { format: 'pcm_s16le', sampleRate: 16000 };
      case 'pcm_22050':
        return { format: 'pcm_s16le', sampleRate: 22050 };
      case 'pcm_24000':
        return { format: 'pcm_s16le', sampleRate: 24000 };
      case 'pcm_44100':
        return { format: 'pcm_s16le', sampleRate: 44100 };
      case 'mulaw':
        return { format: 'pcm_mulaw', sampleRate: 8000 };
      case 'alaw':
        return { format: 'pcm_alaw', sampleRate: 8000 };
      case 'mp3':
        return { format: 'mp3' };
      case 'opus':
        return { format: 'opus' };
      case 'flac':
        return { format: 'flac' };
      case 'aac':
        return { format: 'aac' };
      default:
        return { format: 'pcm_s16le', sampleRate: 16000 };
    }
  }

  private resolveAudioFormat(): void {
    const requestedAudioFormat = this.settings.audioFormat;
    this.audioFormat = this.getOutputFormat();
    this.sampleRate = this.getDefaultSampleRate(this.audioFormat);
  }

  private getDefaultSampleRate(audioFormat: AudioFormat): number {
    switch (audioFormat) {
      case 'pcm_8000': return 8000;
      case 'pcm_16000': return 16000;
      case 'pcm_22050': return 22050;
      case 'pcm_24000': return 24000;
      case 'pcm_44100': return 44100;
      case 'mulaw':
      case 'alaw':
        return 8000;
      default:
        return 16000;
    }
  }

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

  async cleanup(): Promise<void> {

    if (this.stream) {
      try {
        this.stream.close();
      } catch (error) {
        logger.error(`[Soniox TTS] Error closing stream during cleanup: ${error}`);
      }
      this.stream = null;
    }

    if (this.sentenceSplitter) {
      this.sentenceSplitter.clear();
      this.sentenceSplitter = null;
    }

    this.inNoSpeechSection = undefined;
    this.textBuffer = '';
    this.isActiveGeneration = false;
    this.pendingGenerationEnd = false;
    this.pendingFlushCount = 0;

    await super.cleanup();
    logger.info(`[Soniox TTS] Cleaned up resources`);
  }
}
