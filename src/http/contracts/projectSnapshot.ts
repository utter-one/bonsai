import { z } from 'zod';

// ── Request schemas ──────────────────────────────────────────────────

/**
 * Schema for creating a new project snapshot
 */
export const createSnapshotSchema = z.object({
  name: z.string().max(256).nullable().optional().describe('Optional human-readable name for this snapshot'),
}).openapi('CreateSnapshotRequest').describe('Request body for creating a project snapshot');

/**
 * Schema for updating a snapshot name
 */
export const updateSnapshotNameSchema = z.object({
  name: z.string().max(256).nullable().optional().describe('New human-readable name for this snapshot, or null to clear'),
}).openapi('UpdateSnapshotNameRequest').describe('Request body for updating a snapshot name');

// ── Route params schemas ─────────────────────────────────────────────

export const snapshotRouteParamsSchema = z.object({
  id: z.string().min(1).describe('Project ID'),
  snapshotId: z.string().min(1).describe('Snapshot ID'),
});

export const snapshotVersionRouteParamsSchema = z.object({
  id: z.string().min(1).describe('Project ID'),
  version: z.coerce.number().int().positive().describe('Snapshot version number'),
});

// ── Query schemas ────────────────────────────────────────────────────

export const listSnapshotsQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0).describe('Starting index for pagination (default: 0)'),
  limit: z.coerce.number().int().min(1).max(200).default(50).describe('Maximum number of items to return (default: 50, max: 200)'),
  textSearch: z.string().nullable().optional().describe('Search snapshot names'),
}).openapi('ListSnapshotsQuery').describe('Query parameters for listing snapshots');

export const compareSnapshotsQuerySchema = z.object({
  fromVersion: z.coerce.number().int().positive().describe('Baseline snapshot version number'),
  toVersion: z.coerce.number().int().positive().describe('Target snapshot version number to compare against'),
}).openapi('CompareSnapshotsQuery').describe('Query parameters for comparing two snapshots');

// ── Response schemas ─────────────────────────────────────────────────

/**
 * Entity counts summary for a snapshot
 */
export const entityCountsSchema = z.object({
  agents: z.number().int().nonnegative().describe('Number of agents'),
  stages: z.number().int().nonnegative().describe('Number of stages'),
  classifiers: z.number().int().nonnegative().describe('Number of classifiers'),
  contextTransformers: z.number().int().nonnegative().describe('Number of context transformers'),
  tools: z.number().int().nonnegative().describe('Number of tools'),
  globalActions: z.number().int().nonnegative().describe('Number of global actions'),
  guardrails: z.number().int().nonnegative().describe('Number of guardrails'),
  knowledgeCategories: z.number().int().nonnegative().describe('Number of knowledge categories'),
  knowledgeItems: z.number().int().nonnegative().describe('Number of knowledge items'),
  sampleCopies: z.number().int().nonnegative().describe('Number of sample copies'),
  copyDecorators: z.number().int().nonnegative().describe('Number of copy decorators'),
  testers: z.number().int().nonnegative().describe('Number of testers'),
  scenarios: z.number().int().nonnegative().describe('Number of scenarios'),
  quickPrompts: z.number().int().nonnegative().describe('Number of quick prompts'),
  savedSliceQueries: z.number().int().nonnegative().describe('Number of saved slice queries'),
  savedFunnelQueries: z.number().int().nonnegative().describe('Number of saved funnel queries'),
}).openapi('EntityCounts').describe('Entity counts summary for a snapshot');

/**
 * Schema status for a snapshot (schema compatibility)
 */
export const schemaStatusSchema = z.enum(['compatible', 'incompatible', 'unknown']).describe('Schema compatibility status: compatible (hash matches current), incompatible (hash differs), unknown (predates schema hash tracking)');

/**
 * Snapshot metadata response (without entityData)
 */
export const snapshotResponseSchema = z.object({
  id: z.string().describe('Snapshot ID'),
  projectId: z.string().describe('Project ID'),
  version: z.number().int().positive().describe('Sequential version number'),
  name: z.string().nullable().optional().describe('Human-readable name'),
  createdBy: z.string().nullable().optional().describe('Operator ID who created this snapshot'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  schemaHash: z.string().nullable().optional().describe('REST schema hash at capture time'),
  schemaStatus: schemaStatusSchema.optional().describe('Schema compatibility status'),
  schemaStatusMessage: z.string().nullable().optional().describe('Human-readable schema status message'),
  entityCounts: entityCountsSchema.describe('Entity counts summary'),
}).openapi('SnapshotResponse').describe('Snapshot metadata response');

/**
 * Full snapshot response with entityData
 */
export const snapshotFullResponseSchema = z.object({
  id: z.string().describe('Snapshot ID'),
  projectId: z.string().describe('Project ID'),
  version: z.number().int().positive().describe('Sequential version number'),
  name: z.string().nullable().optional().describe('Human-readable name'),
  createdBy: z.string().nullable().optional().describe('Operator ID who created this snapshot'),
  createdAt: z.string().describe('Creation timestamp (ISO 8601)'),
  schemaHash: z.string().nullable().optional().describe('REST schema hash at capture time'),
  schemaStatus: schemaStatusSchema.optional().describe('Schema compatibility status'),
  schemaStatusMessage: z.string().nullable().optional().describe('Human-readable schema status message'),
  entityData: z.object({}).passthrough().describe('Full entity data captured in this snapshot'),
}).openapi('SnapshotFullResponse').describe('Full snapshot response with entity data');

/**
 * Paginated snapshot list response
 */
export const snapshotListResponseSchema = z.object({
  items: z.array(snapshotResponseSchema).describe('Array of snapshot metadata'),
  total: z.number().int().nonnegative().describe('Total number of snapshots'),
  offset: z.number().int().nonnegative().describe('Current offset'),
  limit: z.number().int().positive().describe('Current limit'),
}).openapi('SnapshotListResponse').describe('Paginated list of snapshots');

// ── Comparison response schemas ──────────────────────────────────────

/**
 * A single field-level change in a comparison
 */
export const fieldChangeSchema = z.object({
  field: z.string().describe('Dot-notation field path (e.g., "llmSettings.model")'),
  from: z.unknown().describe('Value in the baseline snapshot'),
  to: z.unknown().describe('Value in the target snapshot'),
}).openapi('FieldChange').describe('A single field-level change');

/**
 * Entity-level diff in a comparison
 */
export const entityDiffSchema = z.object({
  entityType: z.string().describe('Entity type (e.g., "stage", "agent")'),
  entityId: z.string().describe('Entity ID'),
  entityName: z.string().describe('Entity name'),
  changes: z.array(fieldChangeSchema).describe('List of field-level changes'),
}).openapi('EntityDiff').describe('Entity-level diff');

/**
 * Added or removed entity in a comparison
 */
export const addedRemovedEntitySchema = z.object({
  entityType: z.string().describe('Entity type'),
  entity: z.object({}).passthrough().describe('Full entity data'),
}).openapi('AddedRemovedEntity').describe('Added or removed entity');

/**
 * Comparison summary
 */
export const comparisonSummarySchema = z.object({
  entitiesAdded: z.array(z.string()).describe('IDs of entities added in the target'),
  entitiesRemoved: z.array(z.string()).describe('IDs of entities removed in the target'),
  entitiesModified: z.array(z.string()).describe('IDs of entities modified between snapshots'),
  entitiesUnchanged: z.number().int().nonnegative().describe('Number of entities unchanged between snapshots'),
}).openapi('ComparisonSummary').describe('Comparison summary');

/**
 * Snapshot comparison response
 */
export const snapshotComparisonResponseSchema = z.object({
  fromVersion: z.number().int().positive().describe('Baseline version number'),
  toVersion: z.number().int().positive().describe('Target version number'),
  summary: comparisonSummarySchema.describe('Comparison summary'),
  diffs: z.array(entityDiffSchema).describe('Detailed diffs for modified entities'),
  added: z.array(addedRemovedEntitySchema).describe('Entities added in the target'),
  removed: z.array(addedRemovedEntitySchema).describe('Entities removed in the target'),
}).openapi('SnapshotComparisonResponse').describe('Snapshot comparison result');

// ── Restore response schemas ─────────────────────────────────────────

/**
 * A restore warning entry
 */
export const restoreWarningSchema = z.object({
  type: z.string().describe('Warning type (e.g., "stale_provider_reference", "schema_migration_applied")'),
  entityType: z.string().nullable().optional().describe('Entity type affected'),
  entityId: z.string().nullable().optional().describe('Entity ID affected'),
  entityName: z.string().nullable().optional().describe('Entity name affected'),
  field: z.string().nullable().optional().describe('Field affected'),
  message: z.string().describe('Human-readable warning message'),
}).openapi('RestoreWarning').describe('Restore warning entry');

/**
 * Restore result response
 */
export const snapshotRestoreResponseSchema = z.object({
  restored: z.boolean().describe('Whether the restore was successful'),
  snapshotVersion: z.number().int().positive().describe('Version of the snapshot that was restored'),
  schemaMigrated: z.boolean().optional().describe('Whether schema migration was applied before restore'),
  schemaMigrationSteps: z.number().int().nonnegative().optional().describe('Number of transform steps applied during schema migration'),
  entityCounts: entityCountsSchema.describe('Entity counts after restore'),
  warnings: z.array(restoreWarningSchema).optional().describe('Warnings generated during restore'),
}).openapi('SnapshotRestoreResponse').describe('Snapshot restore result');

// ── Delete response schema ───────────────────────────────────────────

export const snapshotDeleteResponseSchema = z.object({
  deleted: z.boolean().describe('Whether the snapshot was deleted'),
  snapshotId: z.string().describe('ID of the deleted snapshot'),
}).openapi('SnapshotDeleteResponse').describe('Snapshot deletion result');

// ── Type exports ─────────────────────────────────────────────────────

export type CreateSnapshotRequest = z.infer<typeof createSnapshotSchema>;
export type UpdateSnapshotNameRequest = z.infer<typeof updateSnapshotNameSchema>;
export type ListSnapshotsQuery = z.infer<typeof listSnapshotsQuerySchema>;
export type CompareSnapshotsQuery = z.infer<typeof compareSnapshotsQuerySchema>;
export type EntityCounts = z.infer<typeof entityCountsSchema>;
export type SnapshotResponse = z.infer<typeof snapshotResponseSchema>;
export type SnapshotFullResponse = z.infer<typeof snapshotFullResponseSchema>;
export type SnapshotListResponse = z.infer<typeof snapshotListResponseSchema>;
export type FieldChange = z.infer<typeof fieldChangeSchema>;
export type EntityDiff = z.infer<typeof entityDiffSchema>;
export type AddedRemovedEntity = z.infer<typeof addedRemovedEntitySchema>;
export type ComparisonSummary = z.infer<typeof comparisonSummarySchema>;
export type SnapshotComparisonResponse = z.infer<typeof snapshotComparisonResponseSchema>;
export type RestoreWarning = z.infer<typeof restoreWarningSchema>;
export type SnapshotRestoreResponse = z.infer<typeof snapshotRestoreResponseSchema>;
export type SnapshotDeleteResponse = z.infer<typeof snapshotDeleteResponseSchema>;
