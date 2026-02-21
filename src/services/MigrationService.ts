import { singleton, inject } from 'tsyringe';
import { sql, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index';
import {
  providers,
  projects,
  personas,
  classifiers,
  contextTransformers,
  tools,
  globalActions,
  knowledgeCategories,
  knowledgeItems,
  stages,
  apiKeys,
  environments,
} from '../db/schema';
import { BaseService } from './BaseService';
import { VersionService } from './VersionService';
import { AuditService } from './AuditService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId } from '../utils/idGenerator';
import { logger } from '../utils/logger';
import { InvalidOperationError, NotFoundError, RemoteConnectionError } from '../errors';
import type { ExportBundle, ExportQuery, PullRequest, MigrationResult, MigrationJob, MigrationSelection, MigrationPreview, EntityStub } from '../http/contracts/migration';

/** Drizzle transaction type, inferred to avoid driver-specific imports. */
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Returns true when the selection object is entirely empty (no IDs specified),
 * which means "export/pull everything".
 */
function isSelectAll(sel: MigrationSelection): boolean {
  return Object.values(sel).every(v => v === undefined || (Array.isArray(v) && v.length === 0));
}

/**
 * Service for migrating config data between Nexus Backend instances.
 *
 * Export entity order (FK-safe):
 *   providers → projects → personas → classifiers → contextTransformers
 *   → tools → globalActions → knowledgeCategories → knowledgeItems
 *   → stages → apiKeys
 *
 * Excluded from migration (runtime / credential data):
 *   admins, users, conversations, conversationEvents, conversationArtifacts,
 *   auditLogs, issues, environments
 */
@singleton()
export class MigrationService extends BaseService {
  /**
   * In-memory pull job store.
   * Jobs survive for the lifetime of the process — a restart clears all history.
   */
  private readonly jobs = new Map<string, MigrationJob>();

  constructor(
    @inject(VersionService) private readonly versionService: VersionService,
    @inject(AuditService) private readonly auditService: AuditService,
  ) {
    super();
  }

  /**
   * Produces a self-contained export bundle based on a granular entity selection.
   * All transitive FK dependencies are automatically resolved so the bundle is
   * always self-consistent and can be imported without FK violations.
   *
   * An empty selection object `{}` means "export everything".
   *
   * @param query - Granular ID-based selection (parsed from query string).
   * @param context - Request context for permission checking.
   */
  async exportBundle(query: ExportQuery, context: RequestContext): Promise<ExportBundle> {
    this.requirePermission(context, PERMISSIONS.MIGRATION_EXPORT);

    const { restSchemaHash } = this.versionService.getVersion();

    // Build a normalised MigrationSelection from the flat query params
    const selection: MigrationSelection = {
      projectIds: query.projectIds,
      stageIds: query.stageIds,
      personaIds: query.personaIds,
      classifierIds: query.classifierIds,
      contextTransformerIds: query.contextTransformerIds,
      toolIds: query.toolIds,
      globalActionIds: query.globalActionIds,
      knowledgeCategoryIds: query.knowledgeCategoryIds,
      knowledgeItemIds: query.knowledgeItemIds,
      providerIds: query.providerIds,
      apiKeyIds: query.apiKeyIds,
    };

    logger.info({ selection, adminId: context.adminId }, 'Exporting migration bundle');

    const bundle = await this.resolveBundle(selection, restSchemaHash, selection);

    logger.info({ projectCount: bundle.projects.length, stageCount: bundle.stages.length, providerCount: bundle.providers.length, adminId: context.adminId }, 'Migration bundle exported successfully');

    return bundle;
  }

  /**
   * Imports an export bundle into this instance using a single DB transaction.
   * All entities are upserted (INSERT … ON CONFLICT DO UPDATE) in FK-safe order.
   * The providers.createdBy FK is nulled out since admin IDs differ between environments.
   * @param input - Bundle, force flag, and dryRun flag.
   * @param context - Request context for permission checking and audit logging.
   */
  async importBundle(input: { bundle: ExportBundle; force?: boolean; dryRun?: boolean }, context: RequestContext): Promise<MigrationResult> {
    this.requirePermission(context, PERMISSIONS.MIGRATION_IMPORT);

    const startedAt = Date.now();
    const { bundle, force = false, dryRun = false } = input;

    const { restSchemaHash: localHash } = this.versionService.getVersion();
    const schemaHashMatch = bundle.restSchemaHash === localHash;

    if (!schemaHashMatch && !force) {
      throw new InvalidOperationError(`Schema hash mismatch: source=${bundle.restSchemaHash}, local=${localHash}. Use force=true to import anyway.`);
    }

    if (!schemaHashMatch) {
      logger.warn({ sourceHash: bundle.restSchemaHash, localHash }, 'Importing bundle with mismatched schema hash (force=true)');
    }

    logger.info({ dryRun, force, schemaHashMatch, adminId: context.adminId }, 'Starting bundle import');

    const upserted: MigrationResult['upserted'] = [];

    if (!dryRun) {
      await db.transaction(async (tx) => {
        upserted.push({ entity: 'providers', count: await this.upsertProviders(tx, bundle.providers, context.adminId) });
        upserted.push({ entity: 'projects', count: await this.upsertProjects(tx, bundle.projects) });
        upserted.push({ entity: 'personas', count: await this.upsertPersonas(tx, bundle.personas) });
        upserted.push({ entity: 'classifiers', count: await this.upsertClassifiers(tx, bundle.classifiers) });
        upserted.push({ entity: 'contextTransformers', count: await this.upsertContextTransformers(tx, bundle.contextTransformers) });
        upserted.push({ entity: 'tools', count: await this.upsertTools(tx, bundle.tools) });
        upserted.push({ entity: 'globalActions', count: await this.upsertGlobalActions(tx, bundle.globalActions) });
        upserted.push({ entity: 'knowledgeCategories', count: await this.upsertKnowledgeCategories(tx, bundle.knowledgeCategories) });
        upserted.push({ entity: 'knowledgeItems', count: await this.upsertKnowledgeItems(tx, bundle.knowledgeItems) });
        upserted.push({ entity: 'stages', count: await this.upsertStages(tx, bundle.stages) });
        upserted.push({ entity: 'apiKeys', count: await this.upsertApiKeys(tx, bundle.apiKeys) });
      });
    } else {
      upserted.push(
        { entity: 'providers', count: bundle.providers.length },
        { entity: 'projects', count: bundle.projects.length },
        { entity: 'personas', count: bundle.personas.length },
        { entity: 'classifiers', count: bundle.classifiers.length },
        { entity: 'contextTransformers', count: bundle.contextTransformers.length },
        { entity: 'tools', count: bundle.tools.length },
        { entity: 'globalActions', count: bundle.globalActions.length },
        { entity: 'knowledgeCategories', count: bundle.knowledgeCategories.length },
        { entity: 'knowledgeItems', count: bundle.knowledgeItems.length },
        { entity: 'stages', count: bundle.stages.length },
        { entity: 'apiKeys', count: bundle.apiKeys.length },
      );
    }

    await this.auditService.logChange({ action: dryRun ? 'migration:dry-run' : 'migration:import', entityId: 'bundle', entityType: 'migration', userId: context.adminId, newEntity: { sourceRestSchemaHash: bundle.restSchemaHash, dryRun, force, upserted } });

    const result: MigrationResult = {
      upserted,
      sourceRestSchemaHash: bundle.restSchemaHash,
      localRestSchemaHash: localHash,
      schemaHashMatch,
      dryRun,
      durationMs: Date.now() - startedAt,
    };

    logger.info({ durationMs: result.durationMs, dryRun, totalEntities: upserted.reduce((s, e) => s + e.count, 0) }, 'Bundle import completed');

    return result;
  }

  /**
   * Returns lightweight entity stubs from a remote environment, showing what
   * would be pulled if startPull were called with the same selection.
   * Authenticates against the stored environment and calls its
   * GET /api/migration/preview endpoint with the forwarded selection params.
   *
   * @param environmentId - ID of the stored environment to preview.
   * @param query - Same query params accepted by previewExport.
   * @param context - Request context for permission checking.
   */
  async previewRemote(environmentId: string, query: ExportQuery, context: RequestContext): Promise<MigrationPreview> {
    this.requirePermission(context, PERMISSIONS.MIGRATION_IMPORT);

    const env = await db.query.environments.findFirst({ where: eq(environments.id, environmentId) });
    if (!env) throw new NotFoundError(`Environment with id ${environmentId} not found`);

    const authRes = await this.safeFetch(`${env.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: env.login, password: env.password }),
    });
    if (!authRes.ok) throw new RemoteConnectionError(`Authentication against source failed: HTTP ${authRes.status}`);

    const { accessToken } = await authRes.json() as { accessToken: string };

    const previewUrl = new URL(`${env.url}/api/migration/preview`);
    for (const [key, values] of Object.entries(query)) {
      if (Array.isArray(values)) {
        for (const v of values) previewUrl.searchParams.append(key, v);
      }
    }

    const previewRes = await this.safeFetch(previewUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!previewRes.ok) throw new RemoteConnectionError(`Preview fetch from source failed: HTTP ${previewRes.status}`);

    const preview = await previewRes.json() as MigrationPreview;

    logger.info({ environmentId, totalCount: preview.totalCount, adminId: context.adminId }, 'Remote migration preview fetched');

    return preview;
  }

  /**
   * Starts an async pull job from a stored remote environment.
   * Authenticates against the remote, checks schema compatibility, fetches the
   * export bundle via the granular selection query params, and imports it locally.
   * @param input - Environment ID, granular selection, force, and dryRun options.
   * @param context - Request context forwarded to importBundle.
   * @returns The job object (status: "pending") to poll with GET /api/migration/jobs/:id.
   */
  async startPull(environmentId: string, input: PullRequest, context: RequestContext): Promise<string> {
    this.requirePermission(context, PERMISSIONS.MIGRATION_IMPORT);

    const jobId = generateId('mjob');
    const selection = input.selection ?? {};
    const job: MigrationJob = {
      id: jobId,
      status: 'pending',
      environmentId,
      selection,
      dryRun: input.dryRun ?? false,
      startedAt: new Date().toISOString(),
    };

    this.jobs.set(jobId, job);

    this.runPull(jobId, environmentId, input, context).catch(err => {
      logger.error({ jobId, error: err.message }, 'Unexpected error in migration pull background task');
    });

    logger.info({ jobId, environmentId, selection, dryRun: input.dryRun }, 'Migration pull job queued');

    return jobId;
  }

  /**
   * Returns the current state of a migration pull job.
   * @param jobId - The ID returned by startPull.
   */
  getJob(jobId: string): MigrationJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Returns lightweight stubs (id + name) for every entity that would be included
   * in an export with the given selection, without producing the full bundle.
   * Useful for reviewing the scope of a migration before committing to it.
   *
   * @param query - Same query params accepted by exportBundle.
   * @param context - Request context for permission checking.
   */
  async previewExport(query: ExportQuery, context: RequestContext): Promise<MigrationPreview> {
    this.requirePermission(context, PERMISSIONS.MIGRATION_EXPORT);

    const selection: MigrationSelection = {
      projectIds: query.projectIds,
      stageIds: query.stageIds,
      personaIds: query.personaIds,
      classifierIds: query.classifierIds,
      contextTransformerIds: query.contextTransformerIds,
      toolIds: query.toolIds,
      globalActionIds: query.globalActionIds,
      knowledgeCategoryIds: query.knowledgeCategoryIds,
      knowledgeItemIds: query.knowledgeItemIds,
      providerIds: query.providerIds,
      apiKeyIds: query.apiKeyIds,
    };

    const bundle = await this.resolveBundle(selection, '', selection);

    const toStub = (r: Record<string, any>): EntityStub => ({ id: r.id as string, name: r.name as string });

    const result: MigrationPreview = {
      providers: bundle.providers.map(toStub),
      projects: bundle.projects.map(toStub),
      personas: bundle.personas.map(toStub),
      classifiers: bundle.classifiers.map(toStub),
      contextTransformers: bundle.contextTransformers.map(toStub),
      tools: bundle.tools.map(toStub),
      globalActions: bundle.globalActions.map(toStub),
      knowledgeCategories: bundle.knowledgeCategories.map(toStub),
      knowledgeItems: bundle.knowledgeItems.map(r => ({ id: r.id as string, name: (r.question ?? r.id) as string })),
      stages: bundle.stages.map(toStub),
      apiKeys: bundle.apiKeys.map(toStub),
      totalCount: 0,
    };
    result.totalCount = [
      result.providers, result.projects, result.personas, result.classifiers,
      result.contextTransformers, result.tools, result.globalActions,
      result.knowledgeCategories, result.knowledgeItems, result.stages, result.apiKeys,
    ].reduce((sum, arr) => sum + arr.length, 0);

    logger.info({ totalCount: result.totalCount, selection, adminId: context.adminId }, 'Migration preview computed');
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private: bundle resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolves the full entity graph for the given selection with transitive
   * dependency pull-up.  Always produces a bundle that can be imported without
   * FK violations.
   *
   * Resolution order (each step may expand what earlier steps fetch):
   *  1. Fetch entities explicitly requested by the caller (or everything if empty).
   *  2. For project-level selections, fetch all direct children.
   *  3. Pull up parent entities required by children (personas from stages, etc.).
   *  4. Collect all referenced provider IDs and fetch them last.
   */
  private async resolveBundle(selection: MigrationSelection, restSchemaHash: string, originalSelection: MigrationSelection): Promise<ExportBundle> {
    const selectAll = isSelectAll(selection);

    // ── 1. Explicitly requested / all project-level entities ──────────────────

    const projectRows = selectAll || selection.projectIds?.length
      ? await db.select().from(projects).where(selection.projectIds?.length ? inArray(projects.id, selection.projectIds) : undefined)
      : [];

    // Accumulate all project IDs we care about (explicit + owned by other selected entities)
    // We do a first pass of children so we know which parent projects to include.

    // ── 2. Fetch explicitly selected leaf entities ────────────────────────────

    const [explicitPersonaRows, explicitClassifierRows, explicitCtRows, explicitToolRows, explicitGaRows, explicitKcRows, explicitKiRows, explicitStageRows, explicitApiKeyRows] = await Promise.all([
      this.fetchOrAll(selectAll || !!selection.personaIds?.length, personas, selection.personaIds, personas.id),
      this.fetchOrAll(selectAll || !!selection.classifierIds?.length, classifiers, selection.classifierIds, classifiers.id),
      this.fetchOrAll(selectAll || !!selection.contextTransformerIds?.length, contextTransformers, selection.contextTransformerIds, contextTransformers.id),
      this.fetchOrAll(selectAll || !!selection.toolIds?.length, tools, selection.toolIds, tools.id),
      this.fetchOrAll(selectAll || !!selection.globalActionIds?.length, globalActions, selection.globalActionIds, globalActions.id),
      this.fetchOrAll(selectAll || !!selection.knowledgeCategoryIds?.length, knowledgeCategories, selection.knowledgeCategoryIds, knowledgeCategories.id),
      this.fetchOrAll(selectAll || !!selection.knowledgeItemIds?.length, knowledgeItems, selection.knowledgeItemIds, knowledgeItems.id),
      this.fetchOrAll(selectAll || !!selection.stageIds?.length, stages, selection.stageIds, stages.id),
      this.fetchOrAll(selectAll || !!selection.apiKeyIds?.length, apiKeys, selection.apiKeyIds, apiKeys.id),
    ]);

    // ── 3. Expand project selections: fetch all children for selected projects ─

    const expandedProjectIds = new Set(projectRows.map(p => p.id));

    const childrenOfProjects = expandedProjectIds.size > 0 && !selectAll
      ? await Promise.all([
          db.select().from(personas).where(inArray(personas.projectId, [...expandedProjectIds])),
          db.select().from(classifiers).where(inArray(classifiers.projectId, [...expandedProjectIds])),
          db.select().from(contextTransformers).where(inArray(contextTransformers.projectId, [...expandedProjectIds])),
          db.select().from(tools).where(inArray(tools.projectId, [...expandedProjectIds])),
          db.select().from(globalActions).where(inArray(globalActions.projectId, [...expandedProjectIds])),
          db.select().from(knowledgeCategories).where(inArray(knowledgeCategories.projectId, [...expandedProjectIds])),
          db.select().from(stages).where(inArray(stages.projectId, [...expandedProjectIds])),
          db.select().from(apiKeys).where(inArray(apiKeys.projectId, [...expandedProjectIds])),
        ])
      : [[], [], [], [], [], [], [], []];

    // Merge explicit + project-child rows (deduplicated by ID)
    const personaRows = this.dedup([...explicitPersonaRows, ...childrenOfProjects[0] as any[]], 'id');
    const classifierRows = this.dedup([...explicitClassifierRows, ...childrenOfProjects[1] as any[]], 'id');
    const ctRows = this.dedup([...explicitCtRows, ...childrenOfProjects[2] as any[]], 'id');
    const toolRows = this.dedup([...explicitToolRows, ...childrenOfProjects[3] as any[]], 'id');
    const gaRows = this.dedup([...explicitGaRows, ...childrenOfProjects[4] as any[]], 'id');
    const kcRows = this.dedup([...explicitKcRows, ...childrenOfProjects[5] as any[]], 'id');
    const stageRows = this.dedup([...explicitStageRows, ...childrenOfProjects[6] as any[]], 'id');
    const apiKeyRows = this.dedup([...explicitApiKeyRows, ...childrenOfProjects[7] as any[]], 'id');

    // ── 4. Knowledge items — pull parent categories for explicit items, then all items for merged categories ─

    const explicitKiWithParentCategories: any[] = [];
    const additionalKcIds = new Set<string>();
    for (const ki of explicitKiRows) {
      if (!kcRows.find(kc => kc.id === ki.categoryId)) {
        additionalKcIds.add(ki.categoryId);
      }
    }
    const additionalKcRows = additionalKcIds.size > 0
      ? await db.select().from(knowledgeCategories).where(inArray(knowledgeCategories.id, [...additionalKcIds]))
      : [];
    const allKcRows = this.dedup([...kcRows, ...additionalKcRows], 'id');

    // All knowledge items for all categories we're including
    const allKcIds = allKcRows.map(kc => kc.id);
    const kiRows = allKcIds.length > 0
      ? this.dedup([...explicitKiRows, ...explicitKiWithParentCategories, ...(await db.select().from(knowledgeItems).where(inArray(knowledgeItems.categoryId, allKcIds)))], 'id')
      : explicitKiRows;

    // ── 5. Collect parent projects missing from explicit project selection ─────

    const allEntityProjectIds = new Set<string>([
      ...personaRows.map(r => r.projectId),
      ...classifierRows.map(r => r.projectId),
      ...ctRows.map(r => r.projectId),
      ...toolRows.map(r => r.projectId),
      ...gaRows.map(r => r.projectId),
      ...allKcRows.map(r => r.projectId),
      ...stageRows.map(r => r.projectId),
      ...apiKeyRows.map(r => r.projectId),
    ]);

    const missingProjectIds = [...allEntityProjectIds].filter(id => !expandedProjectIds.has(id));
    const additionalProjectRows = missingProjectIds.length > 0
      ? await db.select().from(projects).where(inArray(projects.id, missingProjectIds))
      : [];
    const allProjectRows = this.dedup([...projectRows, ...additionalProjectRows], 'id');

    // ── 6. Collect parent personas for stages that reference personas not yet in bundle ─

    const stagePersonaIds = stageRows.map(s => s.personaId).filter(Boolean) as string[];
    const missingPersonaIds = stagePersonaIds.filter(id => !personaRows.find(p => p.id === id));
    const additionalPersonaRows = missingPersonaIds.length > 0
      ? await db.select().from(personas).where(inArray(personas.id, missingPersonaIds))
      : [];
    const allPersonaRows = this.dedup([...personaRows, ...additionalPersonaRows], 'id');

    // ── 7. Collect parent classifiers for stages that reference classifiers not yet in bundle ─

    const stageClassifierIds = stageRows.map(s => s.defaultClassifierId).filter(Boolean) as string[];
    const stageTransformerIds = stageRows.flatMap(s => (s.transformerIds ?? []) as string[]);
    const missingClassifierIds = stageClassifierIds.filter(id => !classifierRows.find(c => c.id === id));
    const additionalClassifierRows = missingClassifierIds.length > 0
      ? await db.select().from(classifiers).where(inArray(classifiers.id, missingClassifierIds))
      : [];
    const allClassifierRows = this.dedup([...classifierRows, ...additionalClassifierRows], 'id');

    const missingCtIds = stageTransformerIds.filter(id => !ctRows.find(c => c.id === id));
    const additionalCtRows = missingCtIds.length > 0
      ? await db.select().from(contextTransformers).where(inArray(contextTransformers.id, missingCtIds))
      : [];
    const allCtRows = this.dedup([...ctRows, ...additionalCtRows], 'id');

    // ── 8. Collect all referenced providers ──────────────────────────────────

    const referencedProviderIds = new Set<string>(selection.providerIds ?? []);

    for (const p of allPersonaRows) {
      if (p.ttsProviderId) referencedProviderIds.add(p.ttsProviderId);
    }
    for (const row of [...allClassifierRows, ...allCtRows, ...toolRows, ...stageRows]) {
      if (row.llmProviderId) referencedProviderIds.add(row.llmProviderId);
    }
    for (const p of allProjectRows) {
      const asrId = (p.asrConfig as any)?.asrProviderId;
      const storageId = (p.storageConfig as any)?.storageProviderId;
      if (asrId) referencedProviderIds.add(asrId);
      if (storageId) referencedProviderIds.add(storageId);
    }

    const providerRows = selectAll
      ? await db.select().from(providers)
      : referencedProviderIds.size > 0
        ? await db.select().from(providers).where(inArray(providers.id, [...referencedProviderIds]))
        : [];

    return {
      exportedAt: new Date().toISOString(),
      restSchemaHash,
      selection: originalSelection,
      providers: providerRows,
      projects: allProjectRows,
      personas: allPersonaRows,
      classifiers: allClassifierRows,
      contextTransformers: allCtRows,
      tools: toolRows,
      globalActions: gaRows,
      knowledgeCategories: allKcRows,
      knowledgeItems: kiRows,
      stages: stageRows,
      apiKeys: apiKeyRows,
    };
  }

  /**
   * Fetches rows by a list of IDs, or all rows when `includeAll` is true and `ids` is empty.
   * Returns an empty array when `includeAll` is false and no IDs are provided.
   */
  private async fetchOrAll<T extends Record<string, any>>(
    includeAll: boolean,
    table: T,
    ids: string[] | undefined,
    idColumn: any,
  ): Promise<any[]> {
    if (includeAll && (!ids || ids.length === 0)) {
      return db.select().from(table as any);
    }
    if (ids && ids.length > 0) {
      return db.select().from(table as any).where(inArray(idColumn, ids));
    }
    return [];
  }

  /** Deduplicates an array of objects by a given key. Later entries win. */
  private dedup<T extends Record<string, any>>(rows: T[], key: keyof T): T[] {
    const map = new Map<any, T>();
    for (const row of rows) map.set(row[key], row);
    return [...map.values()];
  }

  // ---------------------------------------------------------------------------
  // Private: pull orchestration
  // ---------------------------------------------------------------------------

  private async runPull(jobId: string, environmentId: string, input: PullRequest, context: RequestContext): Promise<void> {
    this.updateJob(jobId, { status: 'running' });

    try {
      // 1. Read credentials directly from DB
      const env = await db.query.environments.findFirst({ where: eq(environments.id, environmentId) });
      if (!env) throw new NotFoundError(`Environment with id ${environmentId} not found`);

      // 2. Authenticate against source instance
      const authRes = await this.safeFetch(`${env.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: env.login, password: env.password }),
      });
      if (!authRes.ok) throw new RemoteConnectionError(`Authentication against source failed: HTTP ${authRes.status}`);

      const { accessToken } = await authRes.json() as { accessToken: string };

      // 3. Schema version check — non-fatal if /version is unreachable
      try {
        const versionRes = await this.safeFetch(`${env.url}/version`);
        if (versionRes.ok) {
          const { restSchemaHash: sourceHash } = await versionRes.json() as { restSchemaHash: string };
          const { restSchemaHash: localHash } = this.versionService.getVersion();
          if (sourceHash !== localHash && !input.force) {
            throw new InvalidOperationError(`Schema hash mismatch: source=${sourceHash}, local=${localHash}. Use force=true to pull anyway.`);
          }
          if (sourceHash !== localHash) {
            logger.warn({ sourceHash, localHash, jobId }, 'Schema hash mismatch on pull (force=true)');
          }
        } else {
          logger.warn({ jobId, status: versionRes.status }, 'Source /version endpoint unreachable — skipping schema hash check');
        }
      } catch (err) {
        if (err instanceof InvalidOperationError && err.message.includes('Schema hash mismatch')) throw err;
        logger.warn({ jobId, error: err instanceof Error ? err.message : String(err) }, 'Source /version endpoint unreachable — skipping schema hash check');
      }

      // 4. Build export URL with all selection params forwarded as query strings
      const exportUrl = new URL(`${env.url}/api/migration/export`);
      const sel = input.selection ?? {};
      for (const [key, values] of Object.entries(sel)) {
        if (Array.isArray(values)) {
          for (const v of values) exportUrl.searchParams.append(key, v);
        }
      }

      const exportRes = await this.safeFetch(exportUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!exportRes.ok) throw new RemoteConnectionError(`Export fetch from source failed: HTTP ${exportRes.status}`);

      const bundle = await exportRes.json() as ExportBundle;

      // 5. Import into local DB
      const result = await this.importBundle({ bundle, force: input.force ?? false, dryRun: input.dryRun ?? false }, context);

      this.updateJob(jobId, { status: 'completed', completedAt: new Date().toISOString(), result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ jobId, error: message }, 'Migration pull job failed');
      this.updateJob(jobId, { status: 'failed', completedAt: new Date().toISOString(), error: message });
    }
  }

  private updateJob(jobId: string, patch: Partial<MigrationJob>): void {
    const job = this.jobs.get(jobId);
    if (job) this.jobs.set(jobId, { ...job, ...patch });
  }

  /**
   * Wraps `fetch` and converts low-level network errors (ECONNREFUSED, DNS failures, etc.)
   * into `InvalidOperationError` with a human-readable message that includes the root cause.
   * Without this, undici throws `TypeError: fetch failed` with the real cause buried in `error.cause`.
   */
  private async safeFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err) {
      const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
      throw new RemoteConnectionError(`Network request to ${url} failed: ${cause}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: per-entity upsert helpers
  // All helpers batch-insert rows and update every column on id conflict.
  // providers.createdBy is explicitly nulled — admin IDs differ between environments.
  // ---------------------------------------------------------------------------

  /**
   * Converts ISO string timestamp fields to Date objects in a row object.
   * Drizzle's timestamp() column mapper requires Date instances, but JSON-parsed
   * bundle data delivers timestamps as strings.
   */
  private parseTimestamps(row: any): any {
    const result = { ...row };
    for (const field of ['createdAt', 'updatedAt', 'lastUsedAt']) {
      if (typeof result[field] === 'string') {
        result[field] = new Date(result[field]);
      }
    }
    return result;
  }

  private async upsertProviders(tx: DbTx, rows: any[], adminId: string): Promise<number> {
    if (!rows.length) return 0;
    // Replace source createdBy with the importing admin's ID since admin IDs differ between environments
    await tx.insert(providers).values(rows.map(r => ({ ...this.parseTimestamps(r), createdBy: adminId }))).onConflictDoUpdate({
      target: providers.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        providerType: sql`excluded.provider_type`,
        apiType: sql`excluded.api_type`,
        config: sql`excluded.config`,
        createdBy: adminId,
        tags: sql`excluded.tags`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertProjects(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(projects).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: projects.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        asrConfig: sql`excluded.asr_config`,
        acceptVoice: sql`excluded.accept_voice`,
        generateVoice: sql`excluded.generate_voice`,
        storageConfig: sql`excluded.storage_config`,
        constants: sql`excluded.constants`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertPersonas(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(personas).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: personas.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        ttsProviderId: sql`excluded.tts_provider_id`,
        ttsSettings: sql`excluded.tts_settings`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertClassifiers(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(classifiers).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: classifiers.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertContextTransformers(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(contextTransformers).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: contextTransformers.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        contextFields: sql`excluded.context_fields`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertTools(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(tools).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: tools.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        inputType: sql`excluded.input_type`,
        outputType: sql`excluded.output_type`,
        parameters: sql`excluded.parameters`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertGlobalActions(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(globalActions).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: globalActions.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        condition: sql`excluded.condition`,
        triggerOnUserInput: sql`excluded.trigger_on_user_input`,
        triggerOnClientCommand: sql`excluded.trigger_on_client_command`,
        classificationTrigger: sql`excluded.classification_trigger`,
        overrideClassifierId: sql`excluded.override_classifier_id`,
        parameters: sql`excluded.parameters`,
        effects: sql`excluded.effects`,
        examples: sql`excluded.examples`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertKnowledgeCategories(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(knowledgeCategories).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: knowledgeCategories.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        promptTrigger: sql`excluded.prompt_trigger`,
        tags: sql`excluded.tags`,
        order: sql`excluded.order`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertKnowledgeItems(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(knowledgeItems).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: knowledgeItems.id,
      set: {
        categoryId: sql`excluded.category_id`,
        question: sql`excluded.question`,
        answer: sql`excluded.answer`,
        order: sql`excluded.order`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertStages(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(stages).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: stages.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        personaId: sql`excluded.persona_id`,
        enterBehavior: sql`excluded.enter_behavior`,
        useKnowledge: sql`excluded.use_knowledge`,
        knowledgeTags: sql`excluded.knowledge_tags`,
        useGlobalActions: sql`excluded.use_global_actions`,
        globalActions: sql`excluded.global_actions`,
        variableDescriptors: sql`excluded.variable_descriptors`,
        actions: sql`excluded.actions`,
        defaultClassifierId: sql`excluded.default_classifier_id`,
        transformerIds: sql`excluded.transformer_ids`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }

  private async upsertApiKeys(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(apiKeys).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: apiKeys.id,
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        key: sql`excluded.key`,
        lastUsedAt: sql`excluded.last_used_at`,
        isActive: sql`excluded.is_active`,
        metadata: sql`excluded.metadata`,
        version: sql`excluded.version`,
        createdAt: sql`excluded.created_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
    return rows.length;
  }
}
