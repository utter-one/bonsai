import * as azureSDK from 'microsoft-cognitiveservices-speech-sdk';
import { CancellationReason, PhraseListGrammar } from 'microsoft-cognitiveservices-speech-sdk';
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';
import type { AudioFormat } from '../../../types/audio';
import { audioFormatValues } from '../../../types/audio';
import { generateId, ID_PREFIXES } from '../../../utils/idGenerator';

extendZodWithOpenApi(z);

/**
 * Schema for Azure Speech Recognition service configuration
 */
export const azureAsrProviderConfigSchema = z.strictObject({
  region: z.string().describe('The Azure region to use for the speech recognition service'),
  subscriptionKey: z.string().describe('The subscription key to use for the speech recognition service'),
});

export type AzureAsrProviderConfig = z.infer<typeof azureAsrProviderConfigSchema>;

/**
 * Schema for Azure ASR settings
 */
export const azureAsrSettingsSchema = z.looseObject({
  language: z.string().optional().describe('The language code for speech recognition (e.g., \'en-US\')'),
  dictionaryPhrases: z.array(z.string()).optional().describe('The phrases to add to the speech recognition dictionary'),
  audioFormat: z.enum(audioFormatValues).optional().describe('Audio input format for speech recognition (e.g., "pcm_16000")'),
}).openapi('AzureAsrSettings').describe('Azure Speech Recognition settings');

export type AzureAsrSettings = z.infer<typeof azureAsrSettingsSchema>;

/**
 * Implementation of ASR provider using the Azure Speech SDK
 * Provides real-time speech recognition using Azure Cognitive Services
 */
export class AzureAsrProvider extends AsrProviderBase<AzureAsrProviderConfig> {
  private audioStream?: azureSDK.PushAudioInputStream;
  private bufferArray: Buffer[] = [];
  private audioConfig?: azureSDK.AudioConfig;
  private azureSpeechConfig?: azureSDK.SpeechConfig;
  private speechRecognizer?: azureSDK.SpeechRecognizer;
  private recognising = false;
  private audioFormat: AudioFormat = 'pcm_16000';
  private chunkId: string;

  /**
   * Creates a new Azure ASR provider instance
   * @param config Azure Speech service configuration
   */
  constructor(config: AzureAsrProviderConfig, private settings: AzureAsrSettings) {
    super(config);
  }

  /**
   * Gets the list of supported audio input formats for Azure ASR
   */
  getSupportedInputFormats(): AudioFormat[] {
    return ['pcm_16000'];
  }

  /**
   * Initializes the Azure speech recognition session
   * @param conversation The conversation data containing context and configuration
   */
  async init(): Promise<void> {
    await super.init();

    this.bufferArray = [];
    this.recognising = false;
    this.audioFormat = this.resolveAudioFormat(this.settings?.audioFormat);
    this.chunkId = generateId(ID_PREFIXES.CHUNK);

    // Check if the required configuration is present
    if (!this.config.subscriptionKey || !this.config.region) {
      const errorMessage = 'Missing required Azure Speech configuration (subscription key or region)';
      logger.error(`[ASR] ${errorMessage}`);
      await this.handleError(new Error(errorMessage));
      throw new Error('Missing required configuration');
    }

    // Create a push stream for audio input
    logger.info(`[ASR] Creating Azure speech recognition instance`);
    this.audioStream = azureSDK.AudioInputStream.createPushStream();
    this.audioConfig = azureSDK.AudioConfig.fromStreamInput(this.audioStream);

    this.azureSpeechConfig = azureSDK.SpeechConfig.fromSubscription(
      this.config.subscriptionKey,
      this.config.region
    );
    this.azureSpeechConfig.speechRecognitionLanguage = this.settings.language || 'en-US';

    this.speechRecognizer = new azureSDK.SpeechRecognizer(this.azureSpeechConfig, this.audioConfig);
    logger.info(`[ASR] Created Azure speech recognition instance`);

    // Add phrases to the phrase list if they are provided
    if (this.settings.dictionaryPhrases && this.settings.dictionaryPhrases.length) {
      const phraseList = PhraseListGrammar.fromRecognizer(this.speechRecognizer);
      phraseList.addPhrases(this.settings.dictionaryPhrases);
    }
  }

  /**
   * Starts the Azure speech recognition session.
   * If the push stream was closed by a previous stop() call (e.g. in multi-turn VAD mode),
   * a new push stream, audio config, and recognizer are created before starting.
   */
  async start(): Promise<void> {
    if (!this.azureSpeechConfig) {
      throw new Error('Azure Speech recognizer not initialized. Call init() first.');
    }

    // Recreate push stream and recognizer if the stream was closed by a previous stop().
    if (!this.audioStream) {
      logger.info(`[ASR] Recreating push stream and recognizer for new session`);
      const oldRecognizer = this.speechRecognizer;
      this.audioStream = azureSDK.AudioInputStream.createPushStream();
      this.audioConfig = azureSDK.AudioConfig.fromStreamInput(this.audioStream);
      this.speechRecognizer = new azureSDK.SpeechRecognizer(this.azureSpeechConfig, this.audioConfig);
      if (this.settings.dictionaryPhrases && this.settings.dictionaryPhrases.length) {
        const phraseList = PhraseListGrammar.fromRecognizer(this.speechRecognizer);
        phraseList.addPhrases(this.settings.dictionaryPhrases);
      }
      if (oldRecognizer) oldRecognizer.close();
    }

    this.bufferArray = [];
    this.textChunks = [];
    this.chunkId = generateId(ID_PREFIXES.CHUNK);

    // Set up event handlers
    this.speechRecognizer.sessionStopped = () => {
      this.recognising = false;
      logger.info(`[ASR] Session stopped event`);
      if (this.speechRecognizer) {
        this.speechRecognizer.stopContinuousRecognitionAsync();
      }
      this.handleRecognitionStopped();
    };

    this.speechRecognizer.canceled = async (_, err) => {
      this.recognising = false;
      logger.info(`[ASR] Canceled event`);
      if (err.reason === CancellationReason.Error) {
        logger.error(`[ASR] Error: event cancelled - ${err.errorDetails}`);
        const errorMessage = `Azure Speech recognition error: ${err.errorDetails}`;
        await this.handleError(new Error(errorMessage));
      }
      if (this.speechRecognizer) {
        this.speechRecognizer.stopContinuousRecognitionAsync();
      }
    };

    this.speechRecognizer.sessionStarted = () => {
      logger.info(`[ASR] Session started event`);
    };

    this.speechRecognizer.recognizing = (_, e) => {
      if (!e?.result?.text) return;
      this.handleRecognizing(this.chunkId, e.result.text);
    };

    this.speechRecognizer.recognized = (_, e) => {
      if (!e?.result?.text) return;
      this.handleRecognized(this.chunkId, e.result.text);
      this.chunkId = generateId(ID_PREFIXES.CHUNK);
    };

    // Start continuous recognition
    await new Promise<void>((resolve, reject) => {
      this.speechRecognizer!.startContinuousRecognitionAsync(
        () => {
          logger.info(`[ASR] Started recognition`);
          if (this.onRecognitionStartedCallback) {
            this.onRecognitionStartedCallback();
          }
          if (this.audioStream) {
            for (const buffer of this.bufferArray) {
              const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
              this.audioStream.write(arrayBuffer);
              logger.info(`[ASR] Pre-buffered audio chunk sent`);
            }
          }
          // Clear the buffer array
          this.bufferArray = [];
          this.recognising = true;
          resolve();
        },
        async (err: string) => {
          this.recognising = false;
          const errorMessage = `Failed to start Azure Speech recognition: ${err}`;
          logger.error(`[ASR] Error starting recognition - ${err}`);
          await this.handleError(new Error(errorMessage));
          reject(new Error(errorMessage));
        }
      );
    });
  }

  /**
   * Stops the Azure speech recognition session.
   * Closes the push stream to signal EOF and lets Azure finalize all pending recognition
   * naturally. Do NOT call stopContinuousRecognitionAsync here — it races with (and aborts)
   * Azure's processing of audio already queued in the push stream, producing no recognized
   * text. The sessionStopped handler already calls stopContinuousRecognitionAsync and
   * handleRecognitionStopped when Azure is truly done.
   */
  async stop(): Promise<void> {
    if (!this.speechRecognizer) {
      logger.warn(`[ASR] No Azure speech recognition instance to stop`);
      return;
    }

    if (this.audioStream) {
      // Closing the push stream sends an EOF: Azure processes all queued audio, fires
      // 'recognized' for the final phrase, then fires 'sessionStopped' which calls
      // handleRecognitionStopped(). Returning here lets that happen asynchronously.
      this.audioStream.close();
      this.audioStream = undefined;
      logger.info(`[ASR] Push stream closed, awaiting Azure recognition finalization`);
      return;
    }

    // Fallback when stream was already closed: stop the recognizer directly.
    await new Promise<void>((resolve, reject) => {
      this.speechRecognizer!.stopContinuousRecognitionAsync(
        () => {
          this.recognising = false;
          logger.info(`[ASR] Stopped recognition`);
          resolve();
        },
        async (err: string) => {
          this.recognising = false;
          const errorMessage = `Failed to stop Azure Speech recognition: ${err}`;
          logger.error(`[ASR] Error stopping recognition - ${err}`);
          await this.handleError(new Error(errorMessage));
          reject(new Error(errorMessage));
        }
      );
    });
  }

  /**
   * Sends audio data to the Azure speech recognition service
   * @param conversation The conversation context for the audio data
   * @param audio Binary audio data buffer to be processed
   */
  async sendAudio(audio: Buffer, format?: AudioFormat): Promise<void> {
    if (format && format !== this.audioFormat) {
      logger.warn(`[ASR] Received audio format ${format} does not match configured format ${this.audioFormat}. Using ${this.audioFormat}.`);
    }
    if (this.recognising) {
      // If the recognizer is started, write the buffer to the audio stream
      if (this.audioStream) {
        const arrayBuffer = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
        this.audioStream.write(arrayBuffer);
        logger.info(`[ASR] Sent audio chunk`);
      } else {
        logger.warn(`[ASR] No audio stream available`);
      }
    } else {
      // If the recognizer is not started, store the buffer in the array
      this.bufferArray.push(audio);
      logger.info(`[ASR] Buffered audio chunk`);
    }
  }

  /**
   * Cleans up Azure Speech resources
   */
  async cleanup(): Promise<void> {
    await super.cleanup();

    if (this.speechRecognizer) {
      this.speechRecognizer.close();
      this.speechRecognizer = undefined;
    }

    if (this.audioStream) {
      this.audioStream.close();
      this.audioStream = undefined;
    }

    this.audioConfig = undefined;
    this.azureSpeechConfig = undefined;
    this.bufferArray = [];
    this.recognising = false;
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

    logger.warn(`[ASR] Requested audio format ${requestedFormat} is not supported. Falling back to ${supportedFormats[0]}.`);
    return supportedFormats[0];
  }
}
