import { singleton } from 'tsyringe';
import { z } from 'zod';
import type { ICommunicationChannel, ChannelCapabilities } from '../IChannelDescriptor';
import type { ApiKeyChannel } from '../../apiKeyFeatures';
import type { AudioFormat } from '../../types/audio';

/**
 * Audio formats supported by the WebRTC audio DataChannel.
 *
 * The audio DataChannel carries raw binary frames (container-agnostic),
 * so only uncontainerised PCM-family formats are appropriate.
 */
const WEBRTC_SUPPORTED_AUDIO_FORMATS: AudioFormat[] = [
  'pcm_8000',
  'pcm_16000',
  'pcm_22050',
  'pcm_24000',
  'pcm_44100',
  'pcm_48000',
  'mulaw',
  'alaw',
];

/**
 * ICommunicationChannel implementation for the WebRTC transport.
 *
 * Uses two named RTCDataChannels:
 * - `control` (ordered, reliable): JSON messages (same wire protocol as WebSocket)
 * - `audio` (unordered, maxRetransmits=0): binary audio frames for lower-latency voice
 *
 * Only raw PCM-family audio formats are supported because audio is transmitted
 * as raw binary without an audio container.
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
      supportedAudioFormats: WEBRTC_SUPPORTED_AUDIO_FORMATS,
    };
  }
}
