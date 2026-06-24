import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Smart Turn configuration for post-VAD endpoint detection. Uses an ONNX model
 * to determine whether the speaker has actually finished their turn or is pausing
 * mid-sentence. Runs after VAD detects silence to reduce false turn endings.
 */
export const smartTurnConfigSchema = z.object({
  enabled: z.boolean().default(false).describe(
    'Enable Smart Turn endpoint detection. When enabled, runs ONNX inference on the full utterance audio after VAD detects silence to determine if the speaker has finished their turn. Default: false.'
  ),
  threshold: z.number().min(0).max(1).default(0.5).describe(
    'Probability threshold for Smart Turn endpoint classification. Values above this threshold are considered turn endings. Default: 0.5.'
  ),
}).openapi('SmartTurnConfig');

/** Smart Turn configuration type */
export type SmartTurnConfig = z.infer<typeof smartTurnConfigSchema>;

/**
 * Legacy VAD configuration using millisecond-based parameters with mode-based
 * threshold selection. This variant is kept for backward compatibility.
 */
export const legacyVadConfigSchema = z.object({
  algorithm: z.literal('legacy').describe(
    'Legacy VAD algorithm using millisecond-based parameters with mode-based threshold selection'
  ),
  mode: z.number().int().min(0).max(3).optional().describe(
    'VAD aggressiveness level (0–3). Higher values are more aggressive at filtering non-speech. Default: 2.'
  ),
  frameDurationMs: z.union([z.literal(10), z.literal(20), z.literal(30)]).optional().describe(
    'Duration of each VAD processing frame in milliseconds. Must be 10, 20, or 30. Default: 20.'
  ),
  silencePaddingMs: z.number().int().min(0).max(1000).optional().describe(
    'Amount of silence (in ms) to prepend before the detected speech start as a pre-roll buffer. Default: 300.'
  ),
  autoEndSilenceDurationMs: z.number().int().min(100).max(5000).optional().describe(
    'Duration of silence (in ms) after speech that triggers end-of-utterance detection. Default: 800.'
  ),
  gracePeriodMs: z.number().int().min(0).max(5000).optional().describe(
    'Duration (in ms) after VAD initialization during which speech_start is suppressed. Prevents false positives from phone connection noise. Default: 1000.'
  ),
}).openapi('LegacyVadConfig');

/** Legacy VAD configuration type */
export type LegacyVadConfig = z.infer<typeof legacyVadConfigSchema>;

/**
 * Silero VAD configuration that exposes the underlying Silero VAD processor
 * settings directly using frame-based parameters. This provides fine-grained
 * control over all VAD behavior.
 */
export const sileroVadConfigSchema = z.object({
  algorithm: z.literal('silero').describe(
    'Silero VAD algorithm with direct frame-based configuration'
  ),
  model: z.enum(['v5', 'legacy']).optional().describe(
    'Silero VAD model version. "v5" is the latest; "legacy" is the older model. Default: v5.'
  ),
  positiveSpeechThreshold: z.number().min(0).max(1).optional().describe(
    'Probability threshold above which a frame is considered speech. Default: 0.5.'
  ),
  negativeSpeechThreshold: z.number().min(0).max(1).optional().describe(
    'Probability threshold below which a frame is considered silence. Default: 0.35.'
  ),
  frameSamples: z.number().int().min(1).optional().describe(
    'Number of audio samples per VAD frame. Silero was trained on 512, 1024, 1536 samples at 16kHz. Default: 1536.'
  ),
  redemptionFrames: z.number().int().min(1).optional().describe(
    'Number of silent frames after speech before end-of-utterance is triggered. If speech resumes during this window, the utterance is not ended. Default: 8.'
  ),
  preSpeechPadFrames: z.number().int().min(0).optional().describe(
    'Number of frames of pre-roll silence prepended to the audio segment on speech start. Default: 1.'
  ),
  minSpeechFrames: z.number().int().min(1).optional().describe(
    'Minimum frames required to consider a segment as speech. Shorter segments trigger onVADMisfire instead. Default: 3.'
  ),
  submitUserSpeechOnPause: z.boolean().optional().describe(
    'Whether to submit partial speech when VAD is paused. Default: library default.'
  ),
  gracePeriodMs: z.number().int().min(0).max(5000).optional().describe(
    'Duration (in ms) after VAD initialization during which speech_start is suppressed. Prevents false positives from phone connection noise. Default: 1000.'
  ),
}).openapi('SileroVadConfig');

/** Silero VAD configuration type */
export type SileroVadConfig = z.infer<typeof sileroVadConfigSchema>;

/**
 * FireRedVAD configuration using FireRedTeam's streaming VAD model (NCNN runtime).
 * Provides SOTA multilingual VAD performance with frame-based postprocessing.
 */
export const fireredVadConfigSchema = z.object({
  algorithm: z.literal('firered').describe(
    'FireRedVAD algorithm using NCNN runtime with packed-cache streaming inference'
  ),
  speechThreshold: z.number().min(0).max(1).optional().describe(
    'Probability threshold above which a smoothed frame is classified as speech. Default: 0.5.'
  ),
  smoothWindowSize: z.number().int().min(1).optional().describe(
    'Size of the moving-average smoothing window applied to raw frame probabilities. Default: 5.'
  ),
  minSpeechFrame: z.number().int().min(1).optional().describe(
    'Minimum consecutive speech frames required before speech_start is emitted. Default: 8.'
  ),
  maxSpeechFrame: z.number().int().min(1).optional().describe(
    'Maximum consecutive speech frames before a forced speech_end (long-utterance cutoff). Default: 6000.'
  ),
  minSilenceFrame: z.number().int().min(1).optional().describe(
    'Minimum consecutive silence frames after speech before speech_end is emitted. Default: 80.'
  ),
  padStartFrame: z.number().int().min(0).optional().describe(
    'Number of frames of pre-roll audio prepended to the detected speech start. Default: 5.'
  ),
  gracePeriodMs: z.number().int().min(0).max(5000).optional().describe(
    'Duration (in ms) after VAD initialization during which speech_start is suppressed. Prevents false positives from phone connection noise. Default: 1000.'
  ),
}).openapi('FireRedVadConfig');

/** FireRedVAD configuration type */
export type FireRedVadConfig = z.infer<typeof fireredVadConfigSchema>;

/**
 * Coerce legacy configs (without algorithm field) to include algorithm: 'legacy'
 * so the discriminated union can parse them.
 */
function coerceVadConfig(input: unknown): unknown {
  if (input && typeof input === 'object' && !('algorithm' in input)) {
    return { algorithm: 'legacy', ...input };
  }
  return input;
}

/**
 * Discriminated union of VAD configurations. Supports legacy (ms-based, mode-based
 * thresholds) and silero (direct frame-based settings) algorithms.
 *
 * When `serverVad` is present in `asrConfig`, the server autonomously detects speech
 * boundaries and manages the ASR turn lifecycle. Clients send continuous audio and do
 * not need to call `start_user_voice_input` or `end_user_voice_input`.
 */
export const serverVadConfigSchema = z.preprocess(
  coerceVadConfig,
  z.discriminatedUnion('algorithm', [
    legacyVadConfigSchema,
    sileroVadConfigSchema,
    fireredVadConfigSchema,
  ])
).and(z.object({
  smartTurn: smartTurnConfigSchema.optional().describe(
    'Optional Smart Turn endpoint detection configuration. Runs after VAD silence detection to verify turn completion.'
  ),
  bargeInSilenceTimeout: z.number().int().min(500).max(10000).default(3000).describe(
    'Duration in milliseconds to wait for the user to continue speaking after a barge-in interrupt. If silence is detected for this duration, ASR is stopped. Default: 3000.'
  ),
  bargeInSilencePlaceholder: z.string().optional().describe(
    'Optional placeholder text fed to the AI as user input when the user barge-ins but then stops speaking before the bargeInSilenceTimeout. The AI generates a response based on this prompt (e.g. "[you misheard something the user said]"). Default: [repeat after interruption].'
  ),
})).openapi('ServerVadConfig');

/** Server-side VAD configuration type (discriminated union) */
export type ServerVadConfig = z.infer<typeof serverVadConfigSchema>;
