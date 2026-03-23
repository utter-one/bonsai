import { z } from 'zod';

/**
 * Catalog of available channel types and their configuration schemas.
 */
export class ChannelCatalog {
  /**
   * Returns the list of supported channel typesby the backend.
   */
  getSupportedChannelTypes(): string[] {
    return ['websocket', 'webrtc'];
  }

  /**
   * Returns the Zod schema for validating the configuration of a given channel type.
   * @param channelType - The type of channel to get the config schema for.
   * @returns A Zod object schema for the channel configuration.
   * @throws Error if the channel type is not supported.
   */
  getChannelConfigSchema(channelType: string): z.ZodObject<any> {
    switch (channelType) {
      case 'websocket':
        return z.object({}); // No specific config for WebSocket channel host at this time
      case 'webrtc':
        return z.object({});
      default:
        throw new Error(`Unsupported channel type: ${channelType}`);
    }
  }

}