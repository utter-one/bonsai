import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import { whatsAppChannelProviderConfigSchema } from '../../services/providers/channel/WhatsAppChannelProvider';

/**
 * ICommunicationChannel implementation for the WhatsApp channel via the Meta WhatsApp Cloud API.
 *
 * Text-based channel supporting user and AI text messaging through WhatsApp.
 * Supports a lightweight command interface via slash-prefixed messages (e.g. /reset, /stage <id>).
 * Voice, image, and other media message types are not supported in this channel.
 */
@singleton()
export class WhatsAppCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'whatsapp';
  }

  /** @inheritdoc */
  getName(): string {
    return 'WhatsApp (Meta Cloud API)';
  }

  /** @inheritdoc */
  getConfigSchema(): z.ZodObject<any> {
    return whatsAppChannelProviderConfigSchema;
  }

  /** @inheritdoc */
  getCapabilities(): ChannelCapabilities {
    return {
      supportsVoiceInput: false,
      supportsTextInput: true,
      supportsVoiceOutput: false,
      supportsTextOutput: true,
      supportsCommands: true,
      supportsEvents: false,
      supportsIncomingConnections: true,
      supportsOutgoingConnections: true,
    };
  }
}
