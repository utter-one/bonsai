import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

/** Generic serialized database row inside a bundle. */
const bundleEntitySchema = z.record(z.string(), z.any());

/**
 * Granular selection of entities to migrate.
 * Any combination of ID arrays is accepted; all arrays are optional.
 * When a field is omitted (or empty) it means "all of this type" ONLY when all
 * other fields are also omitted — i.e. an entirely empty object means export
 * everything. As soon as at least one field is set, every unset field means
 * "none of this type" unless the entities are pulled in transitively as
 * dependencies of the selected ones.
 *
 * Transitive dependency resolution performed by the service:
 *   stages        → agents, classifiers, contextTransformers, globalActions, providers
 *   agents        → providers (tts)
 *   classifiers   → providers (llm)
 *   contextTransformers → providers (llm)
 *   tools         → providers (llm)
 *   globalActions → (self-contained, but belong to a project)
 *   knowledgeItems → knowledgeCategories → projects
 *   apiKeys       → projects
 *   projects      → providers (asr, storage)
 */
export const migrationSelectionSchema = z.object({
  projectIds: z.array(z.string()).optional().describe('Specific project IDs to include. Pulls all child entities (stages, agents, classifiers, etc.) for these projects.'),
  stageIds: z.array(z.string()).optional().describe('Specific stage IDs to include. Transitively pulls in the stage\'s agent, classifiers, context transformers, global actions, and all referenced providers.'),
  agentIds: z.array(z.string()).optional().describe('Specific agent IDs to include. Pulls in referenced TTS provider.'),
  classifierIds: z.array(z.string()).optional().describe('Specific classifier IDs to include. Pulls in referenced LLM provider.'),
  contextTransformerIds: z.array(z.string()).optional().describe('Specific context transformer IDs to include. Pulls in referenced LLM provider.'),
  toolIds: z.array(z.string()).optional().describe('Specific tool IDs to include. Pulls in referenced LLM provider.'),
  globalActionIds: z.array(z.string()).optional().describe('Specific global action IDs to include.'),
  knowledgeCategoryIds: z.array(z.string()).optional().describe('Specific knowledge category IDs to include. All child knowledge items are always included.'),
  providerIds: z.array(z.string()).optional().describe('Specific provider IDs to include (in addition to any transitively required ones).'),
  apiKeyIds: z.array(z.string()).optional().describe('Specific API key IDs to include.'),
}).openapi('MigrationSelection').describe('Granular entity selection for export/pull. Omit all fields (empty object {}) to export everything.');

export type MigrationSelection = z.infer<typeof migrationSelectionSchema>;

/**
 * Self-contained export bundle produced by GET /api/migration/export.
 * Entity arrays are ordered by foreign-key dependency so they can be
 * imported sequentially without FK violations:
 *   providers → projects → agents → classifiers → contextTransformers
 *   → tools → globalActions → knowledgeCategories → knowledgeItems
 *   → stages → apiKeys
 *
 * Provider records are exported WITHOUT their config field (API credentials are stripped).
 * The target instance must reconfigure provider credentials after import.
 * Excluded from migration: admins, users, conversations, conversationEvents,
 * conversationArtifacts, auditLogs, issues, environments.
 */
export const exportBundleSchema = z.object({
  exportedAt: z.string().datetime().describe('ISO timestamp when the bundle was generated'),
  restSchemaHash: z.string().describe('REST schema hash of the source instance at export time — used for compatibility checking on import'),
  sourceUrl: z.string().optional().describe('Base URL of the source instance (informational, not used for requests)'),
  selection: migrationSelectionSchema.describe('The selection criteria that produced this bundle'),
  providers: z.array(bundleEntitySchema).describe('Provider stub records — config (API credentials) is stripped on export; credentials must be reconfigured on the target after import'),
  projects: z.array(bundleEntitySchema).describe('Project records'),
  agents: z.array(bundleEntitySchema).describe('Agent records — depend on projects'),
  classifiers: z.array(bundleEntitySchema).describe('Classifier records — depend on projects'),
  contextTransformers: z.array(bundleEntitySchema).describe('Context transformer records — depend on projects'),
  tools: z.array(bundleEntitySchema).describe('Tool records — depend on projects'),
  globalActions: z.array(bundleEntitySchema).describe('Global action records — depend on projects'),
  knowledgeCategories: z.array(bundleEntitySchema).describe('Knowledge category records — depend on projects'),
  knowledgeItems: z.array(bundleEntitySchema).describe('Knowledge item records — depend on knowledgeCategories'),
  stages: z.array(bundleEntitySchema).describe('Stage records — depend on projects, agents, and classifiers'),
  apiKeys: z.array(bundleEntitySchema).describe('API key records — depend on projects'),
}).openapi('ExportBundle');

export type ExportBundle = z.infer<typeof exportBundleSchema>;

/** Query parameters for GET /api/migration/export. */
export const exportQuerySchema = z.object({
  projectIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific project IDs to export (comma-separated or repeated). Omit for all projects.'),
  stageIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific stage IDs to export.'),
  agentIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific agent IDs to export.'),
  classifierIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific classifier IDs to export.'),
  contextTransformerIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific context transformer IDs to export.'),
  toolIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific tool IDs to export.'),
  globalActionIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific global action IDs to export.'),
  knowledgeCategoryIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific knowledge category IDs to export. All child items are included.'),
  providerIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific provider IDs to export (added on top of transitively required ones).'),
  apiKeyIds: z.union([z.string(), z.array(z.string())]).optional().transform(v => v === undefined ? undefined : Array.isArray(v) ? v : [v]).describe('Specific API key IDs to export.'),
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;

/** Request body for POST /api/environments/:id/migration/pull. */
export const pullRequestSchema = z.object({
  selection: migrationSelectionSchema.optional().default({}).describe('Granular entity selection. Omit or pass {} to pull everything.'),
  force: z.boolean().optional().default(false).describe('If true, bypass schema hash mismatch check'),
  dryRun: z.boolean().optional().default(false).describe('If true, simulate the pull without writing to the database'),
});

export type PullRequest = z.infer<typeof pullRequestSchema>;

/** Per-entity upsert count inside a migration result. */
export const migrationEntityCountSchema = z.object({
  entity: z.string().describe('Entity type name (e.g. "providers", "stages")'),
  count: z.number().int().describe('Number of records upserted, or counted in a dry run'),
}).openapi('MigrationEntityCount');

/** Result returned after a completed import (real or dry run). */
export const migrationResultSchema = z.object({
  upserted: z.array(migrationEntityCountSchema).describe('Per-entity-type counts in FK-safe dependency order'),
  sourceRestSchemaHash: z.string().describe('REST schema hash embedded in the imported bundle'),
  localRestSchemaHash: z.string().describe('REST schema hash of this instance at import time'),
  schemaHashMatch: z.boolean().describe('Whether the source and local REST schema hashes matched'),
  dryRun: z.boolean().describe('True if no data was written to the database'),
  durationMs: z.number().int().describe('Total migration duration in milliseconds'),
}).openapi('MigrationResult');

export type MigrationResult = z.infer<typeof migrationResultSchema>;

/** Status values for async migration jobs. */
export const migrationJobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export type MigrationJobStatus = z.infer<typeof migrationJobStatusSchema>;

/**
 * State of an async migration pull job.
 * Jobs are stored in process memory — a server restart clears all history.
 */
export const migrationJobSchema = z.object({
  id: z.string().describe('Unique job identifier'),
  status: migrationJobStatusSchema.describe('Current job status'),
  environmentId: z.string().describe('Source environment ID'),
  selection: migrationSelectionSchema.describe('Entity selection used for this pull'),
  dryRun: z.boolean().describe('Whether this is a dry run'),
  startedAt: z.string().datetime().describe('ISO timestamp when the job was queued'),
  completedAt: z.string().datetime().optional().describe('ISO timestamp when the job finished (success or failure)'),
  result: migrationResultSchema.optional().describe('Migration result — available when status is "completed"'),
  error: z.string().optional().describe('Error description — available when status is "failed"'),
}).openapi('MigrationJob');

export type MigrationJob = z.infer<typeof migrationJobSchema>;

/** Route params for the environment migration job status endpoint. */
export const migrationJobRouteParamsSchema = z.object({
  id: z.string().describe('Environment ID'),
  jobId: z.string().describe('Migration job ID'),
});

/** Lightweight entity reference returned by the preview endpoint. */
export const entityStubSchema = z.object({
  id: z.string().describe('Entity ID'),
  name: z.string().describe('Entity name or display label'),
  projectId: z.string().optional().describe('ID of the owning project — present for all project-scoped entities'),
}).openapi('EntityStub');

export type EntityStub = z.infer<typeof entityStubSchema>;

/**
 * Lightweight preview of all entities that would be included in an export/pull.
 * Returned by GET /api/migration/preview with the same query params as /api/migration/export.
 * Use this to review what will be migrated before committing to an actual import.
 */
export const migrationPreviewSchema = z.object({
  totalCount: z.number().int().describe('Total number of entities across all types'),
  providers: z.array(entityStubSchema).describe('Provider stubs that would be included'),
  projects: z.array(entityStubSchema).describe('Project stubs that would be included'),
  agents: z.array(entityStubSchema).describe('Agent stubs that would be included'),
  classifiers: z.array(entityStubSchema).describe('Classifier stubs that would be included'),
  contextTransformers: z.array(entityStubSchema).describe('Context transformer stubs that would be included'),
  tools: z.array(entityStubSchema).describe('Tool stubs that would be included'),
  globalActions: z.array(entityStubSchema).describe('Global action stubs that would be included'),
  knowledgeCategories: z.array(entityStubSchema).describe('Knowledge category stubs that would be included'),
  knowledgeItems: z.array(entityStubSchema).describe('Knowledge item stubs that would be included — name is the question text'),
  stages: z.array(entityStubSchema).describe('Stage stubs that would be included'),
  apiKeys: z.array(entityStubSchema).describe('API key stubs that would be included'),
}).openapi('MigrationPreview');

export type MigrationPreview = z.infer<typeof migrationPreviewSchema>;
