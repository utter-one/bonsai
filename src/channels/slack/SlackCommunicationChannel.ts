import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import { slackChannelProviderConfigSchema } from '../../services/providers/channel/SlackChannelProvider';

/**
 * ICommunicationChannel implementation for the Slack channel via the Slack Events API.
 *
 * Text-based, reply-only channel: inbound Slack messages are accepted from direct
 * messages and from channel/group mentions, and AI output is sent back as a Slack
 * reply via the Web API. Voice, image, events, and proactive (outbound-initiated)
 * messages are not supported in this integration.
 */
@singleton()
export class SlackCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'slack';
  }

  /** @inheritdoc */
  getName(): string {
    return 'Slack (Events API)';
  }

  /** @inheritdoc */
  getConfigSchema(): z.ZodObject<any> {
    return slackChannelProviderConfigSchema;
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
      supportsIncomingConnections: true,
      supportsOutgoingConnections: true,
    };
  }
}
