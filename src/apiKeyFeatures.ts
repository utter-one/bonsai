/**
 * API key channel and feature permission constants and types.
 *
 * Channels control which transport types are permitted.
 * Features control which capabilities are permitted.
 *
 * A null value for either array in {@link ApiKeySettings} means all values are allowed.
 */

/** Permitted transport channel types for an API key. */
export type ApiKeyChannel = 'websocket' | 'webrtc';

/** All supported API key channel values. */
export const ALL_API_KEY_CHANNELS: Array<ApiKeyChannel> = ['websocket', 'webrtc'];

/**
 * Permitted feature capabilities for an API key.
 * When an API key's settings have no `allowedFeatures` array, all features are permitted.
 */
export type ApiKeyFeature =
  | 'conversation_control'
  | 'voice_input'
  | 'text_input'
  | 'voice_output'
  | 'text_output'
  | 'vars_access'
  | 'stage_control'
  | 'run_action'
  | 'call_tool'
  | 'events';

/** All supported API key feature values. */
export const ALL_API_KEY_FEATURES: Array<ApiKeyFeature> = [
  'conversation_control',
  'voice_input',
  'text_input',
  'voice_output',
  'text_output',
  'vars_access',
  'stage_control',
  'run_action',
  'call_tool',
  'events',
];

/**
 * Settings for an API key that control which channels and features are permitted.
 * A null value for either array means all values in that dimension are allowed.
 */
export type ApiKeySettings = {
  /** Permitted transport channels. If absent, all channels are allowed. */
  allowedChannels?: ApiKeyChannel[];
  /** Permitted features. If absent, all features are allowed. */
  allowedFeatures?: ApiKeyFeature[];
};
