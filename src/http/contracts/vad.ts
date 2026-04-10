import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Configuration for server-side Voice Activity Detection (VAD).
 * When present in asrConfig, the server autonomously detects speech boundaries
 * and manages the ASR turn lifecycle. Clients send continuous audio and do not
 * need to call start_user_voice_input or end_user_voice_input.
 */
export const serverVadConfigSchema = z.object({
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
}).openapi('ServerVadConfig');

/** Server-side VAD configuration type */
export type ServerVadConfig = z.infer<typeof serverVadConfigSchema>;
