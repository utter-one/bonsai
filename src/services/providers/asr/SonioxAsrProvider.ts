import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { SonioxNodeClient } from '@soniox/node';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';
import type { AudioFormat } from '../../../types/audio';
import { generateId, ID_PREFIXES } from '../../../utils/idGenerator';
import type { RealtimeToken, RealtimeResult, SttSessionConfig, AudioFormat as SonioxAudioFormat } from '@soniox/node';

extendZodWithOpenApi(z);

export const sonioxTranslationOneWaySchema = z.object({
  type: z.literal('one_way'),
  targetLanguage: z.string().describe('Target language code for translation (e.g., "es")'),
}).openapi('SonioxTranslationOneWay');

export const sonioxTranslationTwoWaySchema = z.object({
  type: z.literal('two_way'),
  languageA: z.string().describe('First language code for bidirectional translation (e.g., "en")'),
  languageB: z.string().describe('Second language code for bidirectional translation (e.g., "es")'),
}).openapi('SonioxTranslationTwoWay');

export const sonioxTranslationSchema = z.discriminatedUnion('type', [
  sonioxTranslationOneWaySchema,
  sonioxTranslationTwoWaySchema,
]).openapi('SonioxTranslation');

export const sonioxContextKeySchema = z.object({
  key: z.string().describe('Context key or term'),
  value: z.string().describe('Context value or hint'),
}).openapi('SonioxContextKey');

export const sonioxTranslationTermSchema = z.object({
  source: z.string().describe('Source language term'),
  target: z.string().describe('Target language translation'),
}).openapi('SonioxTranslationTerm');

export const sonioxContextSchema = z.object({
  general: z.array(sonioxContextKeySchema).optional().describe('General context key-value pairs for improved recognition'),
  text: z.string().optional().describe('Custom context text to guide transcription'),
  terms: z.array(z.string()).optional().describe('Important terms or phrases to prioritize in recognition'),
  translationTerms: z.array(sonioxTranslationTermSchema).optional().describe('Translation-specific term pairs for improved translation accuracy'),
}).openapi('SonioxContext');

export const sonioxAsrProviderConfigSchema = z.strictObject({
  apiKey: z.string().describe('API key for authenticating with Soniox'),
  region: z.enum(['us', 'eu', 'jp']).default('us').describe('Soniox region: "us" (stt-rt.soniox.com), "eu" (stt-rt.eu.soniox.com), or "jp" (stt-rt.jp.soniox.com)'),
});

export type SonioxAsrProviderConfig = z.infer<typeof sonioxAsrProviderConfigSchema>;

export const sonioxAsrSettingsSchema = z.looseObject({
  model: z.string().default('stt-rt-v5').describe('Model ID for transcription (e.g., "stt-rt-v5"), defaults to stt-rt-v5'),
  audioFormat: z.enum(['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100']).default('pcm_16000').describe('Audio encoding format for speech-to-text, defaults to pcm_16000'),
  numChannels: z.number().int().min(1).max(8).optional().describe('Number of audio channels for multi-speaker diarization'),
  languageHints: z.array(z.string()).optional().describe('Array of language codes for transcription hints (e.g., ["en", "es"])'),
  languageHintsStrict: z.boolean().default(false).describe('When true, only transcribe in the specified language, defaults to false'),
  enableSpeakerDiarization: z.boolean().default(false).describe('Enable speaker identification to distinguish different speakers, defaults to false'),
  enableLanguageIdentification: z.boolean().default(false).describe('Enable automatic language detection when language is not specified, defaults to false'),
  translation: sonioxTranslationSchema.optional().describe('Translation settings for translating speech to another language'),
  context: sonioxContextSchema.optional().describe('Context settings to improve recognition accuracy for specific domains or terminology'),
}).openapi('SonioxAsrSettings').describe('Soniox speech-to-text settings');

export type SonioxAsrSettings = z.infer<typeof sonioxAsrSettingsSchema>;

export class SonioxAsrProvider extends AsrProviderBase<SonioxAsrProviderConfig> {
  private client: SonioxNodeClient | null = null;

  private session: ReturnType<SonioxNodeClient['realtime']['stt']> | null = null;

  private audioBuffer: Buffer[] = [];

  private currentChunkId: string;

  private isRecognizing = false;

  private audioFormat: AudioFormat = 'pcm_16000';

  private pendingFinalTexts: string[] = [];

  private lastEmittedInterimText: string = '';

  private settings: SonioxAsrSettings;

  private startResolve: (() => void) | null = null;

  private startReject: ((err: Error) => void) | null = null;

  constructor(config: SonioxAsrProviderConfig, settings: SonioxAsrSettings) {
    super(config);
    this.settings = settings;
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
  }

  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000', 'pcm_8000', 'pcm_22050', 'pcm_24000', 'pcm_44100'];
  }

  async init(): Promise<void> {
    await super.init();
    this.audioBuffer = [];
    this.isRecognizing = false;
    this.audioFormat = this.resolveAudioFormat(this.settings?.audioFormat);
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    this.pendingFinalTexts = [];
    this.lastEmittedInterimText = '';
    this.startResolve = null;
    this.startReject = null;
    logger.info(`[Soniox ASR] Initialized with audio format: ${this.audioFormat}, model: ${this.settings.model}`);
  }

  async start(): Promise<void> {
    if (!this.config.apiKey) {
      const errorMessage = 'Missing required Soniox API key';
      logger.error(`[Soniox ASR] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error(errorMessage);
    }

    this.audioBuffer = [];
    this.textChunks = [];
    this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    this.pendingFinalTexts = [];
    this.lastEmittedInterimText = '';
    this.startResolve = null;
    this.startReject = null;

    this.client = new SonioxNodeClient({
      api_key: this.config.apiKey,
      region: this.config.region,
    });

    const sessionConfig = this.buildSessionConfig();
    this.session = this.client.realtime.stt(sessionConfig);

    this.session.on('connected', () => {
      logger.info(`[Soniox ASR] Session connected, model: ${this.settings.model}, audioFormat: ${this.audioFormat}`);
      this.isRecognizing = true;
      this.flushAudioBuffer();
      if (this.startResolve) {
        this.startResolve();
      }
    });

    this.session.on('token', (token: RealtimeToken) => {
      this.accumulateFinalToken(token);
    });

    this.session.on('result', (result: RealtimeResult) => {
      this.handleResult(result);
    });

    this.session.on('error', async (error: Error) => {
      logger.error(`[Soniox ASR] Session error: ${error.message}`);
      await this.handleError(error);
      if (this.startReject) {
        this.startReject(error);
      }
    });

    this.session.on('finished', () => {
      logger.info(`[Soniox ASR] Session finished`);
      this.flushPendingFinalTexts();
    });

    this.session.on('disconnected', (reason) => {
      logger.info(`[Soniox ASR] Session disconnected: ${reason ?? 'no reason'}`);
      this.isRecognizing = false;
    });

    logger.info(`[Soniox ASR] Connecting session (region: ${this.config.region}, model: ${this.settings.model})`);

    return new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
      this.session!.connect().catch((err) => {
        logger.error(`[Soniox ASR] Connect failed: ${err.message}`);
        if (this.startReject) {
          this.startReject(err);
        }
      });
    });
  }

  async stop(): Promise<void> {
    logger.info(`[Soniox ASR] Stopping recognition`);

    if (!this.session) {
      logger.warn(`[Soniox ASR] No active session`);
      return;
    }

    try {
      await this.session.finish();
      logger.info(`[Soniox ASR] Session finished gracefully`);
    } catch (error) {
      logger.error(`[Soniox ASR] Error finishing session: ${error}`);
    }

    try {
      this.session.close();
      logger.info(`[Soniox ASR] Session closed`);
    } catch (error) {
      logger.error(`[Soniox ASR] Error closing session: ${error}`);
    }

    this.isRecognizing = false;
    this.flushPendingFinalTexts();
    this.handleRecognitionStopped();
  }

  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    if (format && format !== this.audioFormat) {
      logger.warn(`[Soniox ASR] Received audio format ${format} does not match configured format ${this.audioFormat}. Using ${this.audioFormat}.`);
    }

    if (this.isRecognizing && this.session) {
      this.session.sendAudio(audio);
      logger.debug(`[Soniox ASR] Sent audio chunk (${audio.length} bytes)`);
    } else {
      this.audioBuffer.push(audio);
      logger.debug(`[Soniox ASR] Buffered audio chunk (${audio.length} bytes)`);
    }
  }

  private accumulateFinalToken(token: RealtimeToken): void {
    const text = token.text;
    if (!text || text.trim() === '') {
      return;
    }

    if (token.is_final) {
      this.pendingFinalTexts.push(text);
    }
  }

  private handleResult(result: RealtimeResult): void {
    if (result.finished) {
      logger.info(`[Soniox ASR] Result finished signal received`);
      this.flushPendingFinalTexts();
      this.lastEmittedInterimText = '';
      return;
    }

    const interimText = this.buildTextFromResult(result);
    if (interimText && interimText !== this.lastEmittedInterimText) {
      this.lastEmittedInterimText = interimText;
      this.handleRecognizing(this.currentChunkId, interimText);
    }
  }

  private buildTextFromResult(result: RealtimeResult): string {
    const parts: string[] = [];
    for (const token of result.tokens) {
      const { text } = token;
      if (!text || text.trim() === '') continue;
      if (token.is_final && !this.pendingFinalTexts.includes(text)) {
        this.pendingFinalTexts.push(text);
      }
      if (!token.is_final && !parts.includes(text)) {
        parts.push(text);
      }
    }
    const finalBase = this.pendingFinalTexts.join('');
    if (parts.length === 0) return finalBase;
    const interim = parts.join('');
    if (!finalBase) return interim;
    if (interim.startsWith(' ')) return finalBase + interim;
    return finalBase + ' ' + interim;
  }

  private flushPendingFinalTexts(): void {
    if (this.pendingFinalTexts.length === 0) {
      return;
    }

    const finalText = this.pendingFinalTexts.join('').trim();
    if (finalText) {
      this.handleRecognized(this.currentChunkId, finalText);
      this.currentChunkId = generateId(ID_PREFIXES.CHUNK);
    }
    this.pendingFinalTexts = [];
  }

  private flushAudioBuffer(): void {
    if (this.audioBuffer.length === 0) {
      return;
    }

    logger.info(`[Soniox ASR] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const buffer of this.audioBuffer) {
      if (this.session) {
        this.session.sendAudio(buffer);
      }
    }
    this.audioBuffer = [];
  }

  private buildSessionConfig(): SttSessionConfig {
    const sampleRate = this.getSampleRateFromFormat(this.audioFormat);
    const audioFormat = this.mapToSonioxAudioFormat(this.audioFormat);

    const config: SttSessionConfig = {
      model: this.settings.model,
      audio_format: audioFormat,
      sample_rate: sampleRate,
      num_channels: this.settings.numChannels ?? 1,
    };

    if (this.settings.languageHints && this.settings.languageHints.length > 0) {
      config.language_hints = this.settings.languageHints;
    }

    if (this.settings.languageHintsStrict) {
      config.language_hints_strict = true;
    }

    if (this.settings.enableSpeakerDiarization) {
      config.enable_speaker_diarization = true;
    }

    if (this.settings.enableLanguageIdentification) {
      config.enable_language_identification = true;
    }

    if (this.settings.translation) {
      config.translation = this.mapTranslation(this.settings.translation);
    }

    const mappedContext = this.mapContext(this.settings.context);
    if (mappedContext) {
      config.context = mappedContext;
    }

    return config;
  }

  private mapTranslation(translation: SonioxAsrSettings['translation']): SttSessionConfig['translation'] {
    if (!translation) return undefined;

    if (translation.type === 'one_way') {
      return {
        type: 'one_way',
        target_language: translation.targetLanguage,
      };
    }

    return {
      type: 'two_way',
      language_a: translation.languageA,
      language_b: translation.languageB,
    };
  }

  private mapContext(context: SonioxAsrSettings['context']): SttSessionConfig['context'] {
    if (!context) return undefined;

    const mapped: SttSessionConfig['context'] = {};

    if (context.general && context.general.length > 0) {
      mapped.general = context.general;
    }

    if (context.text) {
      mapped.text = context.text;
    }

    if (context.terms && context.terms.length > 0) {
      mapped.terms = context.terms;
    }

    if (context.translationTerms && context.translationTerms.length > 0) {
      mapped.translation_terms = context.translationTerms.map(t => ({
        source: t.source,
        target: t.target,
      }));
    }

    return Object.keys(mapped).length > 0 ? mapped : undefined;
  }

  private mapToSonioxAudioFormat(format: AudioFormat): SonioxAudioFormat {
    if (format === 'mulaw') return 'mulaw';
    if (format === 'alaw') return 'alaw';
    return 'pcm_s16le';
  }

  private getSampleRateFromFormat(format: AudioFormat): number {
    const match = format.match(/(\d+)$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    return 16000;
  }

  private resolveAudioFormat(requestedFormat?: AudioFormat): AudioFormat {
    const supportedFormats = this.getSupportedInputFormats();
    if (!requestedFormat) {
      return supportedFormats[0];
    }

    if (supportedFormats.includes(requestedFormat)) {
      return requestedFormat;
    }

    logger.warn(`[Soniox ASR] Requested audio format ${requestedFormat} is not supported. Falling back to ${supportedFormats[0]}.`);
    return supportedFormats[0];
  }

  async cleanup(): Promise<void> {
    await super.cleanup();

    if (this.session) {
      try {
        this.session.close();
      } catch (error) {
        logger.error(`[Soniox ASR] Error during cleanup close: ${error}`);
      }
      this.session = null;
    }

    this.client = null;
    this.audioBuffer = [];
    this.isRecognizing = false;
    this.pendingFinalTexts = [];
    this.lastEmittedInterimText = '';
    this.startResolve = null;
    this.startReject = null;
    logger.info(`[Soniox ASR] Cleaned up resources`);
  }
}
