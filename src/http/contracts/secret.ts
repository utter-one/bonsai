import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Response schema for a single secret entry (opaque — value is never returned).
 */
export const secretResponseSchema = z
  .object({
    id: z.string().describe('Unique secret identifier (e.g. sec_xxxx)'),
    ref: z.string().describe('Full secret reference string in @sec:name:id format'),
    createdAt: z.string().describe('ISO 8601 creation timestamp'),
    updatedAt: z.string().describe('ISO 8601 last-updated timestamp'),
  })
  .openapi('SecretResponse');

/**
 * Response schema for listing secrets.
 */
export const secretListResponseSchema = z
  .object({
    items: z.array(secretResponseSchema).describe('List of secret entries'),
    orphans: z.array(z.string()).describe('Secret refs that exist in the store but are not referenced by any provider config or environment'),
  })
  .openapi('SecretListResponse');

/**
 * Response schema for the reveal endpoint — returns the decrypted plaintext value.
 */
export const secretValueResponseSchema = z
  .object({
    id: z.string().describe('Secret identifier'),
    value: z.string().describe('Decrypted plaintext secret value'),
  })
  .openapi('SecretValueResponse');

/**
 * Route params schema for operations targeting a specific secret by ref ID.
 */
export const secretRouteParamsSchema = z.object({
  id: z.string().describe('Secret ID (the id segment of @sec:name:id)'),
});

export type SecretResponse = z.infer<typeof secretResponseSchema>;
export type SecretListResponse = z.infer<typeof secretListResponseSchema>;
export type SecretValueResponse = z.infer<typeof secretValueResponseSchema>;
