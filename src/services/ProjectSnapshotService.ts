import { inject, injectable } from 'tsyringe';
import { and, desc, eq, ilike, inArray, max, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
  projects, agents, stages, classifiers, contextTransformers,
  tools, globalActions, guardrails,
  knowledgeCategories, knowledgeItems,
  sampleCopies, copyDecorators, testers, scenarios, quickPrompts,
  savedSliceQueries, savedFunnelQueries,
  projectSnapshots, providers,
} from '../db/schema';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';
import { logger } from '../utils/logger';
import { NotFoundError, ConflictError, ValidationError } from '../errors';
import { AuditService } from './AuditService';
import { SnapshotSchemaMigrator, type EntityData, type MigratedEntityData } from './snapshot/SnapshotSchemaMigrator';
import { VersionService } from './VersionService';
import type {
  EntityCounts,
  SnapshotResponse,
  SnapshotFullResponse,
  SnapshotListResponse,
  SnapshotComparisonResponse,
  SnapshotRestoreResponse,
  SnapshotDeleteResponse,
} from '../http/contracts/projectSnapshot';

// Max snapshots per project (configurable via env)
const MAX_SNAPSHOTS_PER_PROJECT = parseInt(process.env.SNAPSHOT_MAX_PER_PROJECT || '100', 10);

/**
 * Service for managing project snapshots — immutable point-in-time records
 * of complete project configuration.
 */
@injectable()
export class ProjectSnapshotService extends BaseService {
  constructor(
    @inject(SnapshotSchemaMigrator) private readonly migrator: SnapshotSchemaMigrator,
    @inject(VersionService) private readonly versionService: VersionService,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {
    super();
  }

  /**
   * Create a new snapshot of the project at the current point in time.
   */
  async createSnapshot(projectId: string, input: { name?: string | null }, context: RequestContext): Promise<SnapshotResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    await this.requireProjectNotArchived(projectId);

    // Verify project exists
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundError(`Project ${projectId} not found`);
    }

    // Check snapshot limit
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(projectSnapshots).where(eq(projectSnapshots.projectId, projectId));
    if (parseInt(count as unknown as string, 10) >= MAX_SNAPSHOTS_PER_PROJECT) {
      throw new ConflictError(`Maximum of ${MAX_SNAPSHOTS_PER_PROJECT} snapshots per project reached`);
    }

    // Determine next version number
    const [{ maxVersion }] = await db.select({ maxVersion: max(projectSnapshots.version) }).from(projectSnapshots).where(eq(projectSnapshots.projectId, projectId));
    const nextVersion = (maxVersion ?? 0) + 1;

    // Capture entity data
    const entityData = await this.captureEntityData(projectId);

    // Create snapshot
    const snapshotId = generateId(ID_PREFIXES.PROJECT_SNAPSHOT);
    const [snapshot] = await db.insert(projectSnapshots).values({
      id: snapshotId,
      projectId,
      version: nextVersion,
      name: input.name ?? null,
      entityData,
      createdBy: context.operatorId ?? null,
    }).returning();

    // Audit log
    await this.auditService.logChange({
      userId: context.operatorId,
      action: 'SNAPSHOT_CREATE',
      entityType: 'project_snapshot',
      entityId: snapshotId,
      projectId,
      newEntity: { id: snapshotId, version: nextVersion, name: input.name },
    });

    logger.info({ projectId, snapshotId, version: nextVersion, operatorId: context.operatorId }, 'Project snapshot created');

    return this.formatSnapshotResponse(snapshot);
  }

  /**
   * List all snapshots for a project, ordered by version descending.
   */
  async listSnapshots(projectId: string, params: { offset?: number; limit?: number; textSearch?: string }, context: RequestContext): Promise<SnapshotListResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);

    // Verify project exists
    const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) {
      throw new NotFoundError(`Project ${projectId} not found`);
    }

    const offset = params.offset ?? 0;
    const limit = Math.min(params.limit ?? 50, 200);

    const whereConditions = [eq(projectSnapshots.projectId, projectId)];
    if (params.textSearch) {
      whereConditions.push(ilike(projectSnapshots.name, `%${params.textSearch}%`));
    }

    const where = and(...whereConditions);

    // Total count
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(projectSnapshots).where(where);

    // Fetch snapshots
    const snapshots = await db.select().from(projectSnapshots).where(where).orderBy(desc(projectSnapshots.version)).limit(limit).offset(offset);

    return {
      items: snapshots.map(s => this.formatSnapshotResponse(s)),
      total: parseInt(count as unknown as string, 10),
      offset,
      limit,
    };
  }

  /**
   * Get a single snapshot by ID with full entity data.
   */
  async getSnapshot(projectId: string, snapshotId: string, context: RequestContext): Promise<SnapshotFullResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);

    const [snapshot] = await db.select().from(projectSnapshots).where(
      and(eq(projectSnapshots.id, snapshotId), eq(projectSnapshots.projectId, projectId)),
    ).limit(1);

    if (!snapshot) {
      throw new NotFoundError(`Snapshot ${snapshotId} not found`);
    }

    return this.formatSnapshotFullResponse(snapshot);
  }

  /**
   * Get a snapshot by its sequential version number.
   */
  async getSnapshotByVersion(projectId: string, version: number, context: RequestContext): Promise<SnapshotFullResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);

    const [snapshot] = await db.select().from(projectSnapshots).where(
      and(eq(projectSnapshots.projectId, projectId), eq(projectSnapshots.version, version)),
    ).limit(1);

    if (!snapshot) {
      throw new NotFoundError(`Snapshot version ${version} not found for project ${projectId}`);
    }

    return this.formatSnapshotFullResponse(snapshot);
  }

  /**
   * Update the human-readable name of an existing snapshot.
   */
  async updateSnapshotName(projectId: string, snapshotId: string, input: { name?: string | null }, context: RequestContext): Promise<SnapshotResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);

    const [snapshot] = await db.select().from(projectSnapshots).where(
      and(eq(projectSnapshots.id, snapshotId), eq(projectSnapshots.projectId, projectId)),
    ).limit(1);

    if (!snapshot) {
      throw new NotFoundError(`Snapshot ${snapshotId} not found`);
    }

    const [updated] = await db.update(projectSnapshots).set({
      name: input.name ?? null,
    }).where(eq(projectSnapshots.id, snapshotId)).returning();

    // Audit log
    await this.auditService.logChange({
      userId: context.operatorId,
      action: 'SNAPSHOT_UPDATE',
      entityType: 'project_snapshot',
      entityId: snapshotId,
      projectId,
      oldEntity: { id: snapshotId, name: snapshot.name },
      newEntity: { id: snapshotId, name: updated.name },
    });

    logger.info({ snapshotId, operatorId: context.operatorId }, 'Snapshot name updated');

    return this.formatSnapshotResponse(updated);
  }

  /**
   * Delete a snapshot.
   */
  async deleteSnapshot(projectId: string, snapshotId: string, context: RequestContext): Promise<SnapshotDeleteResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);

    const [snapshot] = await db.select().from(projectSnapshots).where(
      and(eq(projectSnapshots.id, snapshotId), eq(projectSnapshots.projectId, projectId)),
    ).limit(1);

    if (!snapshot) {
      throw new NotFoundError(`Snapshot ${snapshotId} not found`);
    }

    await db.delete(projectSnapshots).where(eq(projectSnapshots.id, snapshotId));

    // Audit log
    await this.auditService.logChange({
      userId: context.operatorId,
      action: 'SNAPSHOT_DELETE',
      entityType: 'project_snapshot',
      entityId: snapshotId,
      projectId,
      oldEntity: { id: snapshotId, version: snapshot.version, name: snapshot.name },
    });

    logger.info({ snapshotId, operatorId: context.operatorId }, 'Snapshot deleted');

    return { deleted: true, snapshotId };
  }

  /**
   * Compare two snapshots and return a structured diff.
   */
  async compareSnapshots(projectId: string, fromVersion: number, toVersion: number, context: RequestContext): Promise<SnapshotComparisonResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_READ);

    if (fromVersion === toVersion) {
      throw new ValidationError('Invalid comparison parameters', [
        { code: 'custom', path: ['fromVersion'], message: 'fromVersion and toVersion must be different' },
      ]);
    }

    const [fromSnapshot, toSnapshot] = await Promise.all([
      db.select().from(projectSnapshots).where(
        and(eq(projectSnapshots.projectId, projectId), eq(projectSnapshots.version, fromVersion)),
      ).limit(1),
      db.select().from(projectSnapshots).where(
        and(eq(projectSnapshots.projectId, projectId), eq(projectSnapshots.version, toVersion)),
      ).limit(1),
    ]);

    if (!fromSnapshot.length) {
      throw new NotFoundError(`Snapshot version ${fromVersion} not found`);
    }
    if (!toSnapshot.length) {
      throw new NotFoundError(`Snapshot version ${toVersion} not found`);
    }

    const currentHash = this.versionService.getVersion().restSchemaHash;

    // Schema migration for both snapshots
    let fromData: EntityData = fromSnapshot[0].entityData as EntityData;
    let toData: EntityData = toSnapshot[0].entityData as EntityData;

    if (!this.migrator.isCompatible(fromData.restSchemaHash)) {
      const migrated = this.migrator.migrateToCurrent(fromData, fromData.restSchemaHash, currentHash);
      fromData = migrated.data;
    }
    if (!this.migrator.isCompatible(toData.restSchemaHash)) {
      const migrated = this.migrator.migrateToCurrent(toData, toData.restSchemaHash, currentHash);
      toData = migrated.data;
    }

    const entityTypes: (keyof Omit<EntityData, 'formatVersion' | 'restSchemaHash' | 'project'>)[] = [
      'agents', 'stages', 'classifiers', 'contextTransformers', 'tools',
      'globalActions', 'guardrails', 'knowledgeCategories', 'knowledgeItems',
      'sampleCopies', 'copyDecorators', 'testers', 'scenarios', 'quickPrompts',
      'savedSliceQueries', 'savedFunnelQueries',
    ];

    const diffs: Array<{ entityType: string; entityId: string; entityName: string; changes: Array<{ field: string; from: unknown; to: unknown }> }> = [];
    const added: Array<{ entityType: string; entity: Record<string, unknown> }> = [];
    const removed: Array<{ entityType: string; entity: Record<string, unknown> }> = [];
    let entitiesUnchanged = 0;

    for (const entityType of entityTypes) {
      const fromArray = (fromData[entityType] as unknown[]) || [];
      const toArray = (toData[entityType] as unknown[]) || [];

      const fromMap = new Map<string, unknown>();
      const toMap = new Map<string, unknown>();

      for (const entity of fromArray) {
        fromMap.set((entity as { id: string }).id, entity);
      }
      for (const entity of toArray) {
        toMap.set((entity as { id: string }).id, entity);
      }

      // Find added entities
      for (const [id, entity] of toMap) {
        if (!fromMap.has(id)) {
          added.push({ entityType: entityTypeToSingular(entityType), entity: entity as Record<string, unknown> });
        }
      }

      // Find removed entities
      for (const [id, entity] of fromMap) {
        if (!toMap.has(id)) {
          removed.push({ entityType: entityTypeToSingular(entityType), entity: entity as Record<string, unknown> });
        }
      }

      // Compare common entities
      for (const [id] of toMap) {
        if (fromMap.has(id)) {
          const fromEntity = fromMap.get(id);
          const toEntity = toMap.get(id);
          const changes = deepDiff(fromEntity, toEntity);
          if (changes.length > 0) {
            const entityName = (toEntity as { name?: string })?.name ?? id;
            diffs.push({
              entityType: entityTypeToSingular(entityType),
              entityId: id,
              entityName,
              changes,
            });
          } else {
            entitiesUnchanged++;
          }
        }
      }
    }

    // Also compare project config
    const projectChanges = deepDiff(fromData.project, toData.project);
    if (projectChanges.length > 0) {
      diffs.push({
        entityType: 'project',
        entityId: projectId,
        entityName: fromData.project.name as string,
        changes: projectChanges,
      });
    } else {
      entitiesUnchanged++;
    }

    return {
      fromVersion,
      toVersion,
      summary: {
        entitiesAdded: added.map(a => (a.entity as { id: string }).id),
        entitiesRemoved: removed.map(r => (r.entity as { id: string }).id),
        entitiesModified: diffs.map(d => d.entityId),
        entitiesUnchanged,
      },
      diffs,
      added,
      removed,
    };
  }

  /**
   * Restore a project's configuration from a snapshot.
   */
  async restoreSnapshot(projectId: string, snapshotId: string, context: RequestContext): Promise<SnapshotRestoreResponse> {
    this.requirePermission(context, PERMISSIONS.PROJECT_WRITE);
    await this.requireProjectNotArchived(projectId);

    const [snapshot] = await db.select().from(projectSnapshots).where(
      and(eq(projectSnapshots.id, snapshotId), eq(projectSnapshots.projectId, projectId)),
    ).limit(1);

    if (!snapshot) {
      throw new NotFoundError(`Snapshot ${snapshotId} not found`);
    }

    let entityData: EntityData = snapshot.entityData as EntityData;
    let schemaMigrated = false;
    let schemaMigrationSteps = 0;
    const warnings: Array<{ type: string; entityType?: string; entityId?: string; entityName?: string; field?: string; message: string }> = [];

    // Schema migration check
    const currentHash = this.versionService.getVersion().restSchemaHash;
    if (!this.migrator.isCompatible(entityData.restSchemaHash)) {
      const migrated: MigratedEntityData = this.migrator.migrateToCurrent(entityData, entityData.restSchemaHash, currentHash);
      entityData = migrated.data;
      schemaMigrated = migrated.migrated;
      schemaMigrationSteps = migrated.steps;
      if (schemaMigrated) {
        warnings.push({
          type: 'schema_migration_applied',
          message: `Snapshot v${snapshot.version} was created before schema changes. Data was auto-migrated before restore. ${schemaMigrationSteps} transform step${schemaMigrationSteps !== 1 ? 's' : ''} applied.`,
        });
      }
    }

    // Pre-restore backup snapshot
    const backupEntityData = await this.captureEntityData(projectId);
    const backupSnapshotId = generateId(ID_PREFIXES.PROJECT_SNAPSHOT);
    const [{ maxVersion }] = await db.select({ maxVersion: max(projectSnapshots.version) }).from(projectSnapshots).where(eq(projectSnapshots.projectId, projectId));
    const nextBackupVersion = Math.max((maxVersion ?? 0) + 1, snapshot.version + 1);

    await db.insert(projectSnapshots).values({
      id: backupSnapshotId,
      projectId,
      version: nextBackupVersion,
      name: `Pre-restore backup of v${snapshot.version}`,
      entityData: backupEntityData,
      createdBy: context.operatorId ?? null,
    });

    // Validate provider UUIDs
    await this.validateProviderReferences(entityData, warnings);

    // Perform the restore in a transaction
    await db.transaction(async (tx) => {
      // Delete existing entities in FK-safe reverse order
      // Tables that depend on others must be deleted first
      await tx.delete(scenarios).where(eq(scenarios.projectId, projectId));
      await tx.delete(quickPrompts).where(eq(quickPrompts.projectId, projectId));
      await tx.delete(savedSliceQueries).where(eq(savedSliceQueries.projectId, projectId));
      await tx.delete(savedFunnelQueries).where(eq(savedFunnelQueries.projectId, projectId));
      await tx.delete(sampleCopies).where(eq(sampleCopies.projectId, projectId));
      await tx.delete(stages).where(eq(stages.projectId, projectId));
      await tx.delete(knowledgeItems).where(eq(knowledgeItems.projectId, projectId));
      await tx.delete(testers).where(eq(testers.projectId, projectId));
      await tx.delete(guardrails).where(eq(guardrails.projectId, projectId));
      await tx.delete(globalActions).where(eq(globalActions.projectId, projectId));
      await tx.delete(tools).where(eq(tools.projectId, projectId));
      await tx.delete(knowledgeCategories).where(eq(knowledgeCategories.projectId, projectId));
      await tx.delete(contextTransformers).where(eq(contextTransformers.projectId, projectId));
      await tx.delete(classifiers).where(eq(classifiers.projectId, projectId));
      await tx.delete(agents).where(eq(agents.projectId, projectId));
      await tx.delete(copyDecorators).where(eq(copyDecorators.projectId, projectId));

      // Insert entities from snapshot in FK-safe order
      await this.applyEntityData(tx, entityData, projectId);
    });

    // Audit log
    await this.auditService.logChange({
      userId: context.operatorId,
      action: 'SNAPSHOT_RESTORE',
      entityType: 'project',
      entityId: projectId,
      projectId,
      newEntity: { restoredFromSnapshot: snapshotId, snapshotVersion: snapshot.version },
    });

    logger.info({ projectId, snapshotId, snapshotVersion: snapshot.version, operatorId: context.operatorId }, 'Project restored from snapshot');

    const entityCounts = this.computeEntityCounts(entityData);

    const result: SnapshotRestoreResponse = {
      restored: true,
      snapshotVersion: snapshot.version,
      entityCounts,
      warnings,
    };
    if (schemaMigrated) {
      result.schemaMigrated = true;
      result.schemaMigrationSteps = schemaMigrationSteps;
    }

    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Capture all entity data for a project at the current point in time.
   */
  private async captureEntityData(projectId: string): Promise<EntityData> {
    const currentHash = this.versionService.getVersion().restSchemaHash;

    // Fetch all entities in parallel
    const [
      projectRows,
      agentRows,
      stageRows,
      classifierRows,
      transformerRows,
      toolRows,
      globalActionRows,
      guardrailRows,
      knowledgeCategoryRows,
      knowledgeItemRows,
      sampleCopyRows,
      copyDecoratorRows,
      testerRows,
      scenarioRows,
      quickPromptRows,
      savedSliceQueryRows,
      savedFunnelQueryRows,
    ] = await Promise.all([
      db.select().from(projects).where(eq(projects.id, projectId)).limit(1),
      db.select().from(agents).where(eq(agents.projectId, projectId)),
      db.select().from(stages).where(eq(stages.projectId, projectId)),
      db.select().from(classifiers).where(eq(classifiers.projectId, projectId)),
      db.select().from(contextTransformers).where(eq(contextTransformers.projectId, projectId)),
      db.select().from(tools).where(eq(tools.projectId, projectId)),
      db.select().from(globalActions).where(eq(globalActions.projectId, projectId)),
      db.select().from(guardrails).where(eq(guardrails.projectId, projectId)),
      db.select().from(knowledgeCategories).where(eq(knowledgeCategories.projectId, projectId)),
      db.select().from(knowledgeItems).where(eq(knowledgeItems.projectId, projectId)),
      db.select().from(sampleCopies).where(eq(sampleCopies.projectId, projectId)),
      db.select().from(copyDecorators).where(eq(copyDecorators.projectId, projectId)),
      db.select().from(testers).where(eq(testers.projectId, projectId)),
      db.select().from(scenarios).where(eq(scenarios.projectId, projectId)),
      db.select().from(quickPrompts).where(and(eq(quickPrompts.projectId, projectId))),
      db.select().from(savedSliceQueries).where(eq(savedSliceQueries.projectId, projectId)),
      db.select().from(savedFunnelQueries).where(eq(savedFunnelQueries.projectId, projectId)),
    ]);

    const project = projectRows[0];
    if (!project) {
      throw new NotFoundError(`Project ${projectId} not found`);
    }

    // Exclude archived fields from project capture
    const { archivedAt, archivedBy, ...projectData } = project;

    const entityData: EntityData = {
      formatVersion: 1,
      restSchemaHash: currentHash,
      project: projectData as Record<string, unknown>,
      agents: agentRows as unknown[],
      stages: stageRows as unknown[],
      classifiers: classifierRows as unknown[],
      contextTransformers: transformerRows as unknown[],
      tools: toolRows as unknown[],
      globalActions: globalActionRows as unknown[],
      guardrails: guardrailRows as unknown[],
      knowledgeCategories: knowledgeCategoryRows as unknown[],
      knowledgeItems: knowledgeItemRows as unknown[],
      sampleCopies: sampleCopyRows as unknown[],
      copyDecorators: copyDecoratorRows as unknown[],
      testers: testerRows as unknown[],
      scenarios: scenarioRows as unknown[],
      quickPrompts: quickPromptRows as unknown[],
      savedSliceQueries: savedSliceQueryRows as unknown[],
      savedFunnelQueries: savedFunnelQueryRows as unknown[],
    };

    return entityData;
  }

  /**
   * Convert ISO timestamp strings back to Date objects for Drizzle insertion.
   * JSONB storage serializes Date to ISO string; Drizzle expects Date for timestamp columns.
   */
  private restoreTimestamps(row: Record<string, unknown>): void {
    for (const key of ['createdAt', 'updatedAt']) {
      if (row[key] && typeof row[key] === 'string') {
        row[key] = new Date(row[key] as string);
      }
    }
  }

  /**
   * Apply entity data from a snapshot to the database.
   */
  private async applyEntityData(tx: any, entityData: EntityData, projectId: string): Promise<void> {
    // 1. Project row update
    const projectData = entityData.project;
    const { id, version, createdAt, updatedAt, ...updateFields } = projectData;
    if (Object.keys(updateFields).length > 0) {
      await tx.update(projects).set(updateFields as any).where(eq(projects.id, projectId));
    }

    // 2. Agents
    for (const a of entityData.agents) {
      const agentRow = a as Record<string, unknown>;
      this.restoreTimestamps(agentRow);
      await tx.insert(agents).values({ ...agentRow, projectId });
    }

    // 3. Classifiers
    for (const c of entityData.classifiers) {
      const row = c as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(classifiers).values({ ...row, projectId });
    }

    // 4. Context transformers
    for (const t of entityData.contextTransformers) {
      const row = t as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(contextTransformers).values({ ...row, projectId });
    }

    // 5. Tools
    for (const t of entityData.tools) {
      const row = t as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(tools).values({ ...row, projectId });
    }

    // 6. Global actions
    for (const g of entityData.globalActions) {
      const row = g as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(globalActions).values({ ...row, projectId });
    }

    // 7. Guardrails
    for (const g of entityData.guardrails) {
      const row = g as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(guardrails).values({ ...row, projectId });
    }

    // 8. Knowledge categories
    for (const k of entityData.knowledgeCategories) {
      const row = k as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(knowledgeCategories).values({ ...row, projectId });
    }

    // 9. Knowledge items
    for (const k of entityData.knowledgeItems) {
      const row = k as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(knowledgeItems).values({ ...row, projectId });
    }

    // 10. Copy decorators
    for (const c of entityData.copyDecorators) {
      const row = c as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(copyDecorators).values({ ...row, projectId });
    }

    // 11. Sample copies
    for (const s of entityData.sampleCopies) {
      const row = s as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(sampleCopies).values({ ...row, projectId });
    }

    // 12. Testers
    for (const t of entityData.testers) {
      const row = t as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(testers).values({ ...row, projectId });
    }

    // 13. Scenarios
    for (const s of entityData.scenarios) {
      const row = s as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(scenarios).values({ ...row, projectId });
    }

    // 14. Quick prompts
    for (const q of entityData.quickPrompts) {
      const row = q as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(quickPrompts).values({ ...row, projectId });
    }

    // 15. Saved slice queries
    for (const sq of entityData.savedSliceQueries) {
      const row = sq as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(savedSliceQueries).values({ ...row, projectId });
    }

    // 16. Saved funnel queries
    for (const fq of entityData.savedFunnelQueries) {
      const row = fq as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(savedFunnelQueries).values({ ...row, projectId });
    }

    // 17. Stages (last — depend on agents and classifiers)
    for (const s of entityData.stages) {
      const row = s as Record<string, unknown>;
      this.restoreTimestamps(row);
      await tx.insert(stages).values({ ...row, projectId });
    }
  }

  /**
   * Validate that all provider UUIDs referenced in the snapshot still exist.
   * Sets stale references to null and reports warnings.
   */
  private async validateProviderReferences(entityData: EntityData, warnings: Array<{ type: string; entityType?: string; entityId?: string; entityName?: string; field?: string; message: string }>): Promise<void> {
    const providerIds = new Set<string>();

    // Collect all provider IDs from agents
    for (const a of entityData.agents) {
      const agent = a as { ttsProviderId?: string; fillerSettings?: { llmProviderId?: string } };
      if (agent.ttsProviderId) providerIds.add(agent.ttsProviderId);
      if (agent.fillerSettings?.llmProviderId) providerIds.add(agent.fillerSettings.llmProviderId);
    }

    // Collect from stages, classifiers, transformers, tools
    for (const e of [...entityData.stages, ...entityData.classifiers, ...entityData.contextTransformers, ...entityData.tools]) {
      const entity = e as { llmProviderId?: string };
      if (entity.llmProviderId) providerIds.add(entity.llmProviderId);
    }

    // Collect from project-level configs
    const project = entityData.project;
    if ((project as any).asrConfig?.asrProviderId) providerIds.add((project as any).asrConfig.asrProviderId);
    if ((project as any).storageConfig?.storageProviderId) providerIds.add((project as any).storageConfig.storageProviderId);
    if ((project as any).moderationConfig?.llmProviderId) providerIds.add((project as any).moderationConfig.llmProviderId);

    // Collect from testers
    for (const t of entityData.testers) {
      const tester = t as { llmProviderId?: string };
      if (tester.llmProviderId) providerIds.add(tester.llmProviderId);
    }

    if (providerIds.size === 0) return;

    // Check which providers exist
    const existingProviders = await db.select({ id: providers.id }).from(providers).where(
      inArray(providers.id, [...providerIds]),
    );
    const existingIds = new Set(existingProviders.map(p => p.id));

    // Check agents for stale TTS provider refs
    for (const a of entityData.agents) {
      const agent = a as { id: string; name: string; ttsProviderId?: string; fillerSettings?: { llmProviderId?: string } };
      if (agent.ttsProviderId && !existingIds.has(agent.ttsProviderId)) {
        warnings.push({
          type: 'stale_provider_reference',
          entityType: 'agent',
          entityId: agent.id,
          entityName: agent.name,
          field: 'ttsProviderId',
          message: `TTS provider ${agent.ttsProviderId} no longer exists; field set to null`,
        });
        agent.ttsProviderId = null;
      }
      if (agent.fillerSettings?.llmProviderId && !existingIds.has(agent.fillerSettings.llmProviderId)) {
        warnings.push({
          type: 'stale_provider_reference',
          entityType: 'agent',
          entityId: agent.id,
          entityName: agent.name,
          field: 'fillerSettings.llmProviderId',
          message: `Filler LLM provider ${agent.fillerSettings.llmProviderId} no longer exists; field set to null`,
        });
        agent.fillerSettings.llmProviderId = null;
      }
    }

    // Check stages, classifiers, transformers, tools for stale LLM provider refs
    for (const e of [...entityData.stages, ...entityData.classifiers, ...entityData.contextTransformers, ...entityData.tools]) {
      const entity = e as { id: string; name: string; llmProviderId?: string };
      if (entity.llmProviderId && !existingIds.has(entity.llmProviderId)) {
        const entityType = entityData.stages.includes(e) ? 'stage' :
          entityData.classifiers.includes(e) ? 'classifier' :
            entityData.contextTransformers.includes(e) ? 'contextTransformer' : 'tool';
        warnings.push({
          type: 'stale_provider_reference',
          entityType,
          entityId: entity.id,
          entityName: entity.name,
          field: 'llmProviderId',
          message: `LLM provider ${entity.llmProviderId} no longer exists; field set to null`,
        });
        entity.llmProviderId = null;
      }
    }

    // Check project-level configs
    const p = entityData.project as any;
    if (p.asrConfig?.asrProviderId && !existingIds.has(p.asrConfig.asrProviderId)) {
      warnings.push({
        type: 'stale_provider_reference',
        entityType: 'project',
        entityId: p.id,
        entityName: p.name,
        field: 'asrConfig.asrProviderId',
        message: `ASR provider ${p.asrConfig.asrProviderId} no longer exists; field set to null`,
      });
      p.asrConfig.asrProviderId = undefined;
    }
    if (p.storageConfig?.storageProviderId && !existingIds.has(p.storageConfig.storageProviderId)) {
      warnings.push({
        type: 'stale_provider_reference',
        entityType: 'project',
        entityId: p.id,
        entityName: p.name,
        field: 'storageConfig.storageProviderId',
        message: `Storage provider ${p.storageConfig.storageProviderId} no longer exists; field set to null`,
      });
      p.storageConfig.storageProviderId = undefined;
    }
    if (p.moderationConfig?.llmProviderId && !existingIds.has(p.moderationConfig.llmProviderId)) {
      warnings.push({
        type: 'stale_provider_reference',
        entityType: 'project',
        entityId: p.id,
        entityName: p.name,
        field: 'moderationConfig.llmProviderId',
        message: `Moderation LLM provider ${p.moderationConfig.llmProviderId} no longer exists; field set to null`,
      });
      p.moderationConfig.llmProviderId = null;
    }
  }

  /**
   * Compute entity counts from entity data.
   */
  private computeEntityCounts(entityData: EntityData): EntityCounts {
    return {
      agents: entityData.agents.length,
      stages: entityData.stages.length,
      classifiers: entityData.classifiers.length,
      contextTransformers: entityData.contextTransformers.length,
      tools: entityData.tools.length,
      globalActions: entityData.globalActions.length,
      guardrails: entityData.guardrails.length,
      knowledgeCategories: entityData.knowledgeCategories.length,
      knowledgeItems: entityData.knowledgeItems.length,
      sampleCopies: entityData.sampleCopies.length,
      copyDecorators: entityData.copyDecorators.length,
      testers: entityData.testers.length,
      scenarios: entityData.scenarios.length,
      quickPrompts: entityData.quickPrompts.length,
      savedSliceQueries: entityData.savedSliceQueries.length,
      savedFunnelQueries: entityData.savedFunnelQueries.length,
    };
  }

  /**
   * Format a snapshot row into a metadata response (without entityData).
   */
  private formatSnapshotResponse(snapshot: typeof projectSnapshots.$inferSelect): SnapshotResponse {
    const entityData = snapshot.entityData as EntityData;
    const schemaInfo = this.migrator.getSchemaStatus(entityData.restSchemaHash);
    const entityCounts = this.computeEntityCounts(entityData);

    return {
      id: snapshot.id,
      projectId: snapshot.projectId,
      version: snapshot.version,
      name: snapshot.name ?? undefined,
      createdBy: snapshot.createdBy ?? undefined,
      createdAt: snapshot.createdAt.toISOString(),
      schemaHash: entityData.restSchemaHash ?? undefined,
      schemaStatus: schemaInfo.status,
      schemaStatusMessage: schemaInfo.message,
      entityCounts,
    };
  }

  /**
   * Format a snapshot row into a full response with entityData.
   */
  private formatSnapshotFullResponse(snapshot: typeof projectSnapshots.$inferSelect): SnapshotFullResponse {
    const entityData = snapshot.entityData as EntityData;
    const schemaInfo = this.migrator.getSchemaStatus(entityData.restSchemaHash);

    return {
      id: snapshot.id,
      projectId: snapshot.projectId,
      version: snapshot.version,
      name: snapshot.name ?? undefined,
      createdBy: snapshot.createdBy ?? undefined,
      createdAt: snapshot.createdAt.toISOString(),
      schemaHash: entityData.restSchemaHash ?? undefined,
      schemaStatus: schemaInfo.status,
      schemaStatusMessage: schemaInfo.message,
      entityData: snapshot.entityData as Record<string, unknown>,
    };
  }
}

/** Convert plural entity type key to singular form */
function entityTypeToSingular(type: string): string {
  const map: Record<string, string> = {
    agents: 'agent',
    stages: 'stage',
    classifiers: 'classifier',
    contextTransformers: 'contextTransformer',
    tools: 'tool',
    globalActions: 'globalAction',
    guardrails: 'guardrail',
    knowledgeCategories: 'knowledgeCategory',
    knowledgeItems: 'knowledgeItem',
    sampleCopies: 'sampleCopy',
    copyDecorators: 'copyDecorator',
    testers: 'tester',
    scenarios: 'scenario',
    quickPrompts: 'quickPrompt',
    savedSliceQueries: 'savedSliceQuery',
    savedFunnelQueries: 'savedFunnelQuery',
  };
  return map[type] ?? type;
}

/**
 * Deep diff two objects and return field-level changes.
 * Skips runtime metadata fields (version, createdAt, updatedAt).
 */
function deepDiff(from: unknown, to: unknown, path = ''): Array<{ field: string; from: unknown; to: unknown }> {
  if (from === to) return [];

  const currentPath = path || 'root';

  // Skip runtime metadata fields
  if (['version', 'createdAt', 'updatedAt'].includes(currentPath)) return [];

  // Both are plain objects — recurse
  if (isObject(from) && isObject(to)) {
    const fromObj = from as Record<string, unknown>;
    const toObj = to as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(fromObj || {}), ...Object.keys(toObj || {})]);
    const changes: Array<{ field: string; from: unknown; to: unknown }> = [];
    for (const key of allKeys) {
      const fieldPath = path ? `${path}.${key}` : key;
      changes.push(...deepDiff(
        fromObj[key],
        toObj[key],
        fieldPath,
      ));
    }
    return changes;
  }

  // Both are arrays — compare as whole values
  if (Array.isArray(from) && Array.isArray(to)) {
    if (!deepEqual(from, to)) {
      return [{ field: path, from, to }];
    }
    return [];
  }

  // Scalar or type mismatch
  return [{ field: path, from, to }];
}

function isObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k => deepEqual(a[k], b[k]));
  }

  return false;
}
