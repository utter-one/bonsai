import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { audioFormatSchema } from '../../types/audio';

extendZodWithOpenApi(z);

/**
 * Schema describing the capabilities of a communication channel.
 */
export const channelCapabilitiesSchema = z.object({
  supportsVoiceInput: z.boolean().describe('Whether the channel supports receiving audio from the user'),
  supportsTextInput: z.boolean().describe('Whether the channel supports receiving text messages from the user'),
  supportsVoiceOutput: z.boolean().describe('Whether the channel supports sending audio to the user'),
  supportsTextOutput: z.boolean().describe('Whether the channel supports sending text messages to the user'),
  supportsCommands: z.boolean().describe('Whether the channel supports client-sent commands (e.g. go-to-stage, set-var)'),
  supportsEvents: z.boolean().describe('Whether the channel supports server-sent event notifications'),
  supportedAudioFormats: z.array(audioFormatSchema).optional().describe('Audio formats accepted by this channel for voice input/output. Only present when voice is supported.'),
}).openapi('ChannelCapabilities');

export type ChannelCapabilitiesResponse = z.infer<typeof channelCapabilitiesSchema>;

/**
 * Schema for a single channel entry returned by the catalog.
 */
export const channelInfoSchema = z.object({
  type: z.string().describe('Unique channel type identifier, e.g. "websocket" or "webrtc"'),
  name: z.string().describe('Human-friendly channel name, e.g. "WebSocket" or "WebRTC"'),
  capabilities: channelCapabilitiesSchema.describe('Capabilities supported by this channel'),
}).openapi('ChannelInfo');

export type ChannelInfo = z.infer<typeof channelInfoSchema>;

/**
 * Schema for the full channel catalog list response.
 */
export const channelCatalogResponseSchema = z.object({
  channels: z.array(channelInfoSchema).describe('List of all channels supported by this backend instance'),
}).openapi('ChannelCatalogResponse');

export type ChannelCatalogResponse = z.infer<typeof channelCatalogResponseSchema>;

/**
 * Schema for the route parameter used by the single-channel lookup endpoint.
 */
export const channelTypeParamSchema = z.object({
  type: z.string().describe('Channel type identifier, e.g. "websocket" or "webrtc"'),
});

export type ChannelTypeParam = z.infer<typeof channelTypeParamSchema>;
