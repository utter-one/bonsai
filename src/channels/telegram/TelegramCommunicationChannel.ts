import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import { telegramChannelProviderConfigSchema } from '../../services/providers/channel/TelegramChannelProvider';

/**
 * ICommunicationChannel implementation for the Telegram channel via the Telegram Bot API.
 *
 * Text-based channel supporting user and AI text messaging through Telegram bots.
 * Supports a lightweight command interface via slash-prefixed messages (e.g. /reset, /stage <id>).
 * Voice, image, and other media message types are not supported in this channel.
 */
@singleton()
export class TelegramCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'telegram';
  }

  /** @inheritdoc */
  getName(): string {
    return 'Telegram (Bot API)';
  }

  /** @inheritdoc */
  getConfigSchema(): z.ZodObject<any> {
    return telegramChannelProviderConfigSchema;
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
