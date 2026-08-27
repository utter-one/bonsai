import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { providerConfigSchema, providerTypeSchema, providerNameSchema } from './provider';
import { connectionTestProtocolSchema, connectionTestPhaseSchema } from '../../services/providers/connectionTest/types';
import { THIRD_PARTY_ERROR_CODES } from '../../utils/errorClassification';

extendZodWithOpenApi(z);

/** Third-party error code (null on success) — mirrors the shared classifier's vocabulary. */
export const connectionTestErrorCodeSchema = z.enum(THIRD_PARTY_ERROR_CODES).nullable().openapi('ConnectionTestErrorCode').describe('Third-party error code (null when the test succeeded)');

/**
 * Mode A — test a saved provider row by id. `.strict()` so a payload that also
 * carries draft fields is rejected (saved XOR draft, exactly one mode).
 */
export const savedConnectionTestBodySchema = z
  .object({
    providerId: z.string().min(1).describe('Id of the saved provider to test'),
    model: z.string().optional().describe('LLM only: the model to test (defaults to the first model from the provider catalog when omitted)'),
    voice: z.string().optional().describe('TTS only: the voice to test'),
    write: z.boolean().optional().describe('Storage only: run a full upload/download/delete round trip on a throwaway key'),
    bucket: z.string().optional().describe('Storage (s3/azure-blob/gcs) only: the bucket/container to verify'),
  })
  .strict()
  .openapi('SavedConnectionTestBody');

/**
 * Mode B — test an unsaved (draft) config before the provider row exists. The
 * `config` is validated by the same per-apiType union the create endpoint uses.
 */
export const draftConnectionTestBodySchema = z
  .object({
    providerType: providerTypeSchema.describe('Provider category (llm, asr, tts, or storage — the types with a connection test)'),
    apiType: providerNameSchema.describe('Specific provider implementation (e.g. openai, azure, s3, local)'),
    config: providerConfigSchema.describe('Provider-specific configuration object (validated by the create-endpoint schema)'),
    model: z.string().optional().describe('LLM only: the model to test (required for a draft LLM — there is no saved row to enumerate a default from)'),
    voice: z.string().optional().describe('TTS only: the voice to test'),
    write: z.boolean().optional().describe('Storage only: run a full upload/download/delete round trip on a throwaway key'),
    bucket: z.string().optional().describe('Storage (s3/azure-blob/gcs) only: the bucket/container to verify'),
  })
  .strict()
  .openapi('DraftConnectionTestBody');

/**
 * Request body: saved XOR draft. A payload carrying both a `providerId` and
 * draft fields fails both strict schemas → 400 (exactly one mode must be given).
 */
export const connectionTestRequestSchema = z
  .union([savedConnectionTestBodySchema, draftConnectionTestBodySchema])
  .openapi('ConnectionTestRequest');

/** Structured result of a connection test — always HTTP 200 (vendor failure is data, not an HTTP error). */
export const connectionTestResultSchema = z
  .object({
    ok: z.boolean().describe('Whether the connection test succeeded'),
    providerType: z.string().describe('Provider category (llm, asr, tts, storage)'),
    apiType: z.string().describe('Specific provider implementation'),
    protocol: connectionTestProtocolSchema.describe('Transport the test exercised (the same protocol as the provider main functionality)'),
    phase: connectionTestPhaseSchema.describe('How far the test got (furthest stage reached)'),
    latencyMs: z.number().int().min(0).describe('Total elapsed time in milliseconds'),
    errorCode: connectionTestErrorCodeSchema.describe('Third-party error code (null on success)'),
    errorText: z.string().optional().describe('Sanitized error message (present on failure; tokens/keys redacted, truncated to 500 chars)'),
    detail: z.record(z.string(), z.unknown()).optional().describe('Type-specific detail (model, bytes, objects, path, ...)'),
  })
  .openapi('ConnectionTestResult');

export type SavedConnectionTestBody = z.infer<typeof savedConnectionTestBodySchema>;
export type DraftConnectionTestBody = z.infer<typeof draftConnectionTestBodySchema>;
export type ConnectionTestRequestBody = z.infer<typeof connectionTestRequestSchema>;
export type ConnectionTestResponseBody = z.infer<typeof connectionTestResultSchema>;
