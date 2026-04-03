import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import type { AudioFormat } from '../../types/audio';

/**
 * Audio formats supported by the Twilio Media Streams transport.
 *
 * Twilio Media Streams delivers audio as 8 kHz µ-law (mulaw) encoded PCM.
 */
const TWILIO_VOICE_SUPPORTED_AUDIO_FORMATS: AudioFormat[] = ['mulaw'];

/**
 * ICommunicationChannel implementation for the Twilio Media Streaming transport.
 *
 * Voice-only channel using Twilio's Media Streams API.
 * Audio is streamed as 8 kHz µ-law (mulaw) encoded PCM over WebSocket.
 * Does not support text input or output.
 */
@singleton()
export class TwilioVoiceCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'twilio_voice';
  }

  /** @inheritdoc */
  getName(): string {
    return 'Twilio Media Streaming';
  }

  /** @inheritdoc */
  getConfigSchema(): z.ZodObject<any> {
    return z.object({});
  }

  /** @inheritdoc */
  getCapabilities(): ChannelCapabilities {
    return {
      supportsVoiceInput: true,
      supportsTextInput: false,
      supportsVoiceOutput: true,
      supportsTextOutput: false,
      supportsCommands: false,
      supportsEvents: false,
      supportedAudioFormats: TWILIO_VOICE_SUPPORTED_AUDIO_FORMATS,
    };
  }
}
