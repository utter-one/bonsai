import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/**
 * Response schema for the GET /version endpoint.
 * Hashes are SHA-256 truncated to 12 hex characters (48 bits), content-addressed
 * from the generated schema files — not from git history.
 */
export const versionResponseSchema = z.object({
  restSchemaHash: z.string().describe('First 12 hex chars of the SHA-256 hash of the REST OpenAPI schema. Changes only when a REST API contract changes.'),
  wsSchemaHash: z.string().describe('First 12 hex chars of the SHA-256 hash of the WebSocket contracts schema. Changes only when a WebSocket contract changes.'),
  gitCommit: z.string().nullable().describe('Short git commit SHA of the running build, injected via the GIT_COMMIT environment variable. Null when not set.'),
}).openapi('VersionResponse');

export type VersionResponse = z.infer<typeof versionResponseSchema>;
