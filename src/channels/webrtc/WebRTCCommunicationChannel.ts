import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import type { AudioFormat } from '../../types/audio';

/**
 * PCM audio formats supported by the WebRTC channel.
 *
 * The audio media track uses Opus on the wire; the RTCAudioSource/RTCAudioSink nonstandard
 * APIs operate on 16-bit signed LE PCM internally. Only PCM-family formats are valid here
 * because G.711 (mulaw/alaw) cannot be fed directly to RTCAudioSource.onData.
 */
const WEBRTC_SUPPORTED_AUDIO_FORMATS: AudioFormat[] = [
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
];

/**
 * ICommunicationChannel implementation for the WebRTC transport.
 *
 * Uses one named RTCDataChannel and one bidirectional native audio media track:
 * - `control` DataChannel (ordered, reliable): JSON messages (same wire protocol as WebSocket)
 * - Audio media track (RTP/SRTP + Opus): voice audio in both directions
 *
 * Only PCM-family audio formats are supported because the RTCAudioSource/RTCAudioSink
 * nonstandard APIs require 16-bit signed LE PCM samples.
 */
@singleton()
export class WebRTCCommunicationChannel implements ICommunicationChannel {
  /** @inheritdoc */
  getType(): ApiKeyChannel {
    return 'webrtc';
  }

  /** @inheritdoc */
  getName(): string {
    return 'WebRTC';
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
      supportsIncomingConnections: true,
      supportsOutgoingConnections: false,
      supportedAudioFormats: WEBRTC_SUPPORTED_AUDIO_FORMATS,
    };
  }
}
