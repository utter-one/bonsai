import * as azureSDK from 'microsoft-cognitiveservices-speech-sdk';
import { CancellationReason, PhraseListGrammar } from 'microsoft-cognitiveservices-speech-sdk';
import { AsrProviderBase } from './AsrProviderBase';
import { logger } from '../../../utils/logger';

/**
 * Configuration for Azure Speech Recognition service
 */
export type AzureAsrProviderConfig = {
  /**
   * The Azure region to use for the speech recognition service.
   */
  region: string;

  /**
   * The subscription key to use for the speech recognition service.
   */
  subscriptionKey: string;

  /**
   * The language code for speech recognition (e.g., 'en-US')
   */
  language?: string;

  /**
   * The phrases to add to the speech recognition dictionary.
   */
  dictionaryPhrases?: string[];
};

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

  /**
   * Creates a new Azure ASR provider instance
   * @param config Azure Speech service configuration
   */
  constructor(config: AzureAsrProviderConfig) {
    super(config);
  }

  /**
   * Initializes the Azure speech recognition session
   * @param conversation The conversation data containing context and configuration
   */
  async init(): Promise<void> {
    await super.init();

    this.bufferArray = [];
    this.recognising = false;

    // Check if the required configuration is present
    if (!this.config.subscriptionKey || !this.config.region) {
      const errorMessage = 'Missing required Azure Speech configuration (subscription key or region)';
      logger.error(`[ASR] ${errorMessage}`);
      await this.handleServiceError(errorMessage);
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
    this.azureSpeechConfig.speechRecognitionLanguage = this.config.language || 'en-US';

    this.speechRecognizer = new azureSDK.SpeechRecognizer(this.azureSpeechConfig, this.audioConfig);
    logger.info(`[ASR] Created Azure speech recognition instance`);

    // Add phrases to the phrase list if they are provided
    if (this.config.dictionaryPhrases && this.config.dictionaryPhrases.length) {
      const phraseList = PhraseListGrammar.fromRecognizer(this.speechRecognizer);
      phraseList.addPhrases(this.config.dictionaryPhrases);
    }
  }

  /**
   * Starts the Azure speech recognition session
   */
  async start(): Promise<void> {
    if (!this.speechRecognizer) {
      throw new Error('Azure Speech recognizer not initialized. Call init() first.');
    }

    this.bufferArray = [];

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
        await this.handleServiceError(errorMessage);
      }
      if (this.speechRecognizer) {
        this.speechRecognizer.stopContinuousRecognitionAsync();
      }
      await this.handleError(new Error(err.errorDetails));
    };

    this.speechRecognizer.sessionStarted = () => {
      logger.info(`[ASR] Session started event`);
    };

    this.speechRecognizer.recognizing = (_, e) => {
      if (!e?.result?.text) return;
      this.handleRecognizing(e.result.resultId, e.result.text);
    };

    this.speechRecognizer.recognized = (_, e) => {
      if (!e?.result?.text) return;
      this.handleRecognized(e.result.resultId, e.result.text);
    };

    // Start continuous recognition
    await new Promise<void>((resolve, reject) => {
      this.speechRecognizer!.startContinuousRecognitionAsync(
        () => {
          logger.info(`[ASR] Started recognition`);
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
          await this.handleServiceError(errorMessage);
          await this.handleError(new Error(err));
          reject(new Error(errorMessage));
        }
      );
    });
  }

  /**
   * Stops the Azure speech recognition session
   */
  async stop(): Promise<void> {
    if (!this.speechRecognizer) {
      logger.warn(`[ASR] No Azure speech recognition instance to stop`);
      return;
    }

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
          await this.handleServiceError(errorMessage);
          await this.handleError(new Error(err));
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
  async sendAudio(audio: Buffer): Promise<void> {
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
}
