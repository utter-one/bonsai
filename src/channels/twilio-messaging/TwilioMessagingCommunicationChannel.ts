import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';

/**
 * ICommunicationChannel implementation for the Twilio Messaging transport.
 *
 * Text-only channel using Twilio's Messaging API (SMS/WhatsApp).
 * Does not support voice input or output.
 */
@singleton()
export class TwilioMessagingCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'twilio_messaging';
  }

  /** @inheritdoc */
  getName(): string {
    return 'Twilio Messaging';
  }

  /** @inheritdoc */
  getConfigSchema(): z.ZodObject<any> {
    return z.object({});
  }

  /** @inheritdoc */
  getCapabilities(): ChannelCapabilities {
    return {
      supportsVoiceInput: false,
      supportsTextInput: true,
      supportsVoiceOutput: false,
      supportsTextOutput: true,
      supportsCommands: false,
      supportsEvents: false,
    };
  }
}
