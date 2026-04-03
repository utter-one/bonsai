import { inject, singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel } from './IChannelDescriptor';
import { WebSocketCommunicationChannel } from './websocket/WebSocketCommunicationChannel';
import { WebRTCCommunicationChannel } from './webrtc/WebRTCCommunicationChannel';
import { TwilioMessagingCommunicationChannel } from './twilio-messaging/TwilioMessagingCommunicationChannel';
import { TwilioVoiceCommunicationChannel } from './twilio-voice/TwilioVoiceCommunicationChannel';

/**
 * Catalog of available ICommunicationChannel implementations.
 *
 * Provides a central registry for all channel types supported by the backend,
 * delegating capability and schema queries to the individual channel instances.
 */
@singleton()
export class ChannelCatalog {
  private readonly channels: Map<string, ICommunicationChannel>;

  constructor(
    @inject(WebSocketCommunicationChannel) websocket: WebSocketCommunicationChannel,
    @inject(WebRTCCommunicationChannel) webrtc: WebRTCCommunicationChannel,
    @inject(TwilioMessagingCommunicationChannel) twilioMessaging: TwilioMessagingCommunicationChannel,
    @inject(TwilioVoiceCommunicationChannel) twilioVoice: TwilioVoiceCommunicationChannel,
  ) {
    const entries: ICommunicationChannel[] = [websocket, webrtc, twilioMessaging, twilioVoice];
    this.channels = new Map(entries.map((c) => [c.getType(), c]));
  }

  /**
   * Returns all registered channel instances.
   */
  getChannels(): ICommunicationChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Returns the channel instance for the given channel type.
   * @param channelType - The channel type identifier, e.g. `'websocket'`.
   * @returns The matching ICommunicationChannel instance.
   * @throws Error if the channel type is not registered.
   */
  getChannel(channelType: string): ICommunicationChannel {
    const channel = this.channels.get(channelType);
    if (!channel) {
      throw new Error(`Unsupported channel type: ${channelType}`);
    }
    return channel;
  }

  /**
   * Returns the list of supported channel types registered in the catalog.
   */
  getSupportedChannelTypes(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Returns the Zod schema for validating the configuration of a given channel type.
   * @param channelType - The type of channel to get the config schema for.
   * @returns A Zod object schema for the channel configuration.
   * @throws Error if the channel type is not supported.
   */
  getChannelConfigSchema(channelType: string): z.ZodObject<any> {
    return this.getChannel(channelType).getConfigSchema();
  }
}