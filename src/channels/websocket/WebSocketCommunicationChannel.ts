import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import { audioFormatValues } from '../../types/audio';

/**
 * ICommunicationChannel implementation for the WebSocket transport.
 *
 * Supports full duplex text and voice over a persistent WebSocket connection.
 * Audio is transmitted as base64-encoded binary data inside JSON messages,
 * so all audio formats are accepted.
 */
@singleton()
export class WebSocketCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'websocket';
  }

  /** @inheritdoc */
  getName(): string {
    return 'WebSocket';
  }

  /** @inheritdoc */
  getConfigSchema(): z.ZodObject<any> {
    return z.object({});
  }

  /** @inheritdoc */
  getCapabilities(): ChannelCapabilities {
    return {
      supportsVoiceInput: true,
      supportsTextInput: true,
      supportsVoiceOutput: true,
      supportsTextOutput: true,
      supportsCommands: true,
      supportsEvents: true,
      supportedAudioFormats: [...audioFormatValues],
    };
  }
}
