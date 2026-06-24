import { singleton, inject } from 'tsyringe';
import { sql, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { db } from '../db/index';
import {
  providers,
  projects,
  agents,
  classifiers,
  contextTransformers,
  tools,
  globalActions,
  knowledgeCategories,
  knowledgeItems,
  guardrails,
  copyDecorators,
  sampleCopies,
  savedSliceQueries,
  savedFunnelQueries,
  stages,
  apiKeys,
  environments,
  testers,
  scenarios,
} from '../db/schema';
import { BaseService } from './BaseService';
import { VersionService } from './VersionService';
import { AuditService } from './AuditService';
import { SecretsManagerRegistry } from './secrets/SecretsManagerRegistry';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId } from '../utils/idGenerator';
import { logger } from '../utils/logger';
import { InvalidOperationError, NotFoundError, RemoteConnectionError } from '../errors';
import { SecretRefUtils } from './secrets/SecretRefUtils';
import { deriveBundleKey, encryptSecret, decryptSecret } from '../utils/crypto';
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
 * Service for migrating config data between Bonsai Backend instances.
 *
 * Export entity order (FK-safe):
 *   providers → projects → agents → classifiers → contextTransformers
 *   → tools → globalActions → knowledgeCategories → knowledgeItems
 *   → copyDecorators → sampleCopies → guardrails → stages → apiKeys
 *
 * Excluded from migration (runtime / credential data):
 *   operators, users, conversations, conversationEvents, conversationArtifacts,
 *   auditLogs, issues, environments
 */
@singleton()
export class MigrationService extends BaseService {
  /**
   * In-memory pull job store.
   * Jobs survive for the lifetime of the process — a restart clears all history.
   */
  private readonly jobs = new Map<string, MigrationJob>();

  /** Tracked promises for active pull jobs so they aren't lost on process exit. */
  private readonly activePullPromises = new Map<string, Promise<void>>();

  constructor(
    @inject(VersionService) private readonly versionService: VersionService,
    @inject(AuditService) private readonly auditService: AuditService,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(SecretsManagerRegistry) private readonly secretsRegistry: SecretsManagerRegistry,
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
      agentIds: query.agentIds,
      classifierIds: query.classifierIds,
      contextTransformerIds: query.contextTransformerIds,
      toolIds: query.toolIds,
      globalActionIds: query.globalActionIds,
      knowledgeCategoryIds: query.knowledgeCategoryIds,
      providerIds: query.providerIds,
      apiKeyIds: query.apiKeyIds,
      testerIds: query.testerIds,
      scenarioIds: query.scenarioIds,
      guardrailIds: query.guardrailIds,
      copyDecoratorIds: query.copyDecoratorIds,
      sampleCopyIds: query.sampleCopyIds,
      savedSliceQueryIds: query.savedSliceQueryIds,
      savedFunnelQueryIds: query.savedFunnelQueryIds,
    };

    logger.info({ selection, operatorId: context.operatorId }, 'Exporting migration bundle');

    const rawBundle = await this.resolveBundle(selection, restSchemaHash, selection);
    const bundle = await this.packBundleSecrets(rawBundle, query.bundlePassword);

    logger.info({ projectCount: bundle.projects.length, stageCount: bundle.stages.length, providerCount: bundle.providers.length, hasSecrets: !!bundle.bundleSecrets, operatorId: context.operatorId }, 'Migration bundle exported successfully');

    return bundle;
  }

  /**
   * Imports an export bundle into this instance using a single DB transaction.
   * All entities are upserted (INSERT … ON CONFLICT DO UPDATE) in FK-safe order.
   * The providers.createdBy FK is nulled out since operator IDs differ between environments.
   * @param input - Bundle, force flag, and dryRun flag.
   * @param context - Request context for permission checking and audit logging.
   */
  async importBundle(input: { bundle: ExportBundle; force?: boolean; dryRun?: boolean; bundlePassword?: string }, context: RequestContext): Promise<MigrationResult> {
    this.requirePermission(context, PERMISSIONS.MIGRATION_IMPORT);

    const startedAt = Date.now();
    const { bundle: inputBundle, force = false, dryRun = false, bundlePassword } = input;

    // Decrypt and re-store provider secrets from the bundle before any DB writes.
    // In dry-run mode we still validate the password/ciphertext but skip DB writes.
    // The returned bundle has all entity array refs remapped to newly created local secrets.
    const bundle = await this.unpackBundleSecrets(inputBundle, bundlePassword, dryRun);

    const { restSchemaHash: localHash } = this.versionService.getVersion();
    const schemaHashMatch = bundle.restSchemaHash === localHash;

    if (!schemaHashMatch && !force) {
      throw new InvalidOperationError(`Schema hash mismatch: source=${bundle.restSchemaHash}, local=${localHash}. Use force=true to import anyway.`);
    }

    if (!schemaHashMatch) {
      logger.warn({ sourceHash: bundle.restSchemaHash, localHash }, 'Importing bundle with mismatched schema hash (force=true)');
    }

    logger.info({ dryRun, force, schemaHashMatch, operatorId: context.operatorId }, 'Starting bundle import');

    const upserted: MigrationResult['upserted'] = [];

    if (!dryRun) {
      await db.transaction(async (tx) => {
        upserted.push({ entity: 'providers', count: await this.upsertProviders(tx, bundle.providers, context.operatorId) });
        upserted.push({ entity: 'projects', count: await this.upsertProjects(tx, bundle.projects) });
        upserted.push({ entity: 'agents', count: await this.upsertAgents(tx, bundle.agents) });
        upserted.push({ entity: 'classifiers', count: await this.upsertClassifiers(tx, bundle.classifiers) });
        upserted.push({ entity: 'contextTransformers', count: await this.upsertContextTransformers(tx, bundle.contextTransformers) });
        upserted.push({ entity: 'tools', count: await this.upsertTools(tx, bundle.tools) });
        upserted.push({ entity: 'globalActions', count: await this.upsertGlobalActions(tx, bundle.globalActions) });
        upserted.push({ entity: 'knowledgeCategories', count: await this.upsertKnowledgeCategories(tx, bundle.knowledgeCategories) });
        upserted.push({ entity: 'knowledgeItems', count: await this.upsertKnowledgeItems(tx, bundle.knowledgeItems) });
        upserted.push({ entity: 'copyDecorators', count: await this.upsertCopyDecorators(tx, bundle.copyDecorators) });
        upserted.push({ entity: 'sampleCopies', count: await this.upsertSampleCopies(tx, bundle.sampleCopies) });
        upserted.push({ entity: 'savedSliceQueries', count: await this.upsertSavedSliceQueries(tx, bundle.savedSliceQueries) });
        upserted.push({ entity: 'savedFunnelQueries', count: await this.upsertSavedFunnelQueries(tx, bundle.savedFunnelQueries) });
        upserted.push({ entity: 'guardrails', count: await this.upsertGuardrails(tx, bundle.guardrails) });
        upserted.push({ entity: 'stages', count: await this.upsertStages(tx, bundle.stages) });
        upserted.push({ entity: 'apiKeys', count: await this.upsertApiKeys(tx, bundle.apiKeys) });
        upserted.push({ entity: 'testers', count: await this.upsertTesters(tx, bundle.testers) });
        upserted.push({ entity: 'scenarios', count: await this.upsertScenarios(tx, bundle.scenarios) });
      });

      // Log a 'migrate' audit entry per entity instance after the transaction commits
      await Promise.all([
        ...bundle.providers.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'provider', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.projects.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'project', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.agents.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'agent', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.classifiers.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'classifier', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.contextTransformers.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'contextTransformer', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.tools.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'tool', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.globalActions.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'globalAction', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.knowledgeCategories.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'knowledgeCategory', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.knowledgeItems.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'knowledgeItem', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.copyDecorators.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'copyDecorator', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.sampleCopies.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'sampleCopy', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.savedSliceQueries.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'savedSliceQuery', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.savedFunnelQueries.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'savedFunnelQuery', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.guardrails.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'guardrail', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.stages.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'stage', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.apiKeys.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'apiKey', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.testers.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'tester', entityId: row.id, userId: context.operatorId, newEntity: row })),
        ...bundle.scenarios.map(row => this.auditService.logChange({ action: 'MIGRATE', entityType: 'scenario', entityId: row.id, userId: context.operatorId, newEntity: row })),
      ]);
    } else {
      upserted.push(
        { entity: 'providers', count: bundle.providers.length },
        { entity: 'projects', count: bundle.projects.length },
        { entity: 'agents', count: bundle.agents.length },
        { entity: 'classifiers', count: bundle.classifiers.length },
        { entity: 'contextTransformers', count: bundle.contextTransformers.length },
        { entity: 'tools', count: bundle.tools.length },
        { entity: 'globalActions', count: bundle.globalActions.length },
        { entity: 'knowledgeCategories', count: bundle.knowledgeCategories.length },
        { entity: 'knowledgeItems', count: bundle.knowledgeItems.length },
        { entity: 'copyDecorators', count: bundle.copyDecorators.length },
        { entity: 'sampleCopies', count: bundle.sampleCopies.length },
        { entity: 'savedSliceQueries', count: bundle.savedSliceQueries.length },
        { entity: 'savedFunnelQueries', count: bundle.savedFunnelQueries.length },
        { entity: 'guardrails', count: bundle.guardrails.length },
        { entity: 'stages', count: bundle.stages.length },
        { entity: 'apiKeys', count: bundle.apiKeys.length },
        { entity: 'testers', count: bundle.testers.length },
        { entity: 'scenarios', count: bundle.scenarios.length },
      );
    }

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

    const resolvedEnv = await this.secretRefUtils.resolveObject(env as any) as typeof env;

    if (!env.url.startsWith('https://')) {
      throw new InvalidOperationError('Remote environment URL must use HTTPS to protect credentials during authentication');
    }

    const authRes = await this.safeFetch(`${env.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resolvedEnv.login, password: resolvedEnv.password }),
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

    logger.info({ environmentId, totalCount: preview.totalCount, operatorId: context.operatorId }, 'Remote migration preview fetched');

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

    const pullPromise = this.runPull(jobId, environmentId, input, context).finally(() => {
      this.activePullPromises.delete(jobId);
    });
    this.activePullPromises.set(jobId, pullPromise);

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
      agentIds: query.agentIds,
      classifierIds: query.classifierIds,
      contextTransformerIds: query.contextTransformerIds,
      toolIds: query.toolIds,
      globalActionIds: query.globalActionIds,
      knowledgeCategoryIds: query.knowledgeCategoryIds,
      providerIds: query.providerIds,
      apiKeyIds: query.apiKeyIds,
      testerIds: query.testerIds,
      scenarioIds: query.scenarioIds,
      guardrailIds: query.guardrailIds,
      copyDecoratorIds: query.copyDecoratorIds,
      sampleCopyIds: query.sampleCopyIds,
      savedSliceQueryIds: query.savedSliceQueryIds,
      savedFunnelQueryIds: query.savedFunnelQueryIds,
    };

    const { restSchemaHash } = this.versionService.getVersion();
    const bundle = await this.resolveBundle(selection, restSchemaHash, selection);

    const toStub = (r: Record<string, any>): EntityStub => ({ id: r.id as string, name: r.name as string });
    const toProjectStub = (r: Record<string, any>): EntityStub => ({ id: r.id as string, name: r.name as string, projectId: r.projectId as string });

    const result: MigrationPreview = {
      providers: bundle.providers.map(toStub),
      projects: bundle.projects.map(toStub),
      agents: bundle.agents.map(toProjectStub),
      classifiers: bundle.classifiers.map(toProjectStub),
      contextTransformers: bundle.contextTransformers.map(toProjectStub),
      tools: bundle.tools.map(toProjectStub),
      globalActions: bundle.globalActions.map(toProjectStub),
      knowledgeCategories: bundle.knowledgeCategories.map(toProjectStub),
      knowledgeItems: bundle.knowledgeItems.map(r => ({ id: r.id as string, name: (r.questions?.[0] ?? r.id) as string })),
      copyDecorators: bundle.copyDecorators.map(toProjectStub),
      sampleCopies: bundle.sampleCopies.map(toProjectStub),
      savedSliceQueries: bundle.savedSliceQueries.map(r => ({ id: r.id as string, name: r.name as string })),
      savedFunnelQueries: bundle.savedFunnelQueries.map(r => ({ id: r.id as string, name: r.name as string })),
      guardrails: bundle.guardrails.map(toProjectStub),
      stages: bundle.stages.map(toProjectStub),
      apiKeys: bundle.apiKeys.map(toProjectStub),
      testers: bundle.testers.map(toProjectStub),
      scenarios: bundle.scenarios.map(toProjectStub),
      totalCount: 0,
    };
    result.totalCount = [
      result.providers, result.projects, result.agents, result.classifiers,
      result.contextTransformers, result.tools, result.globalActions,
      result.knowledgeCategories, result.knowledgeItems,
      result.copyDecorators, result.sampleCopies, result.savedSliceQueries, result.savedFunnelQueries,
      result.guardrails, result.stages, result.apiKeys,
      result.testers, result.scenarios,
    ].reduce((sum, arr) => sum + arr.length, 0);

    logger.info({ totalCount: result.totalCount, selection, operatorId: context.operatorId }, 'Migration preview computed');
    return result;
  }

  // ---------------------------------------------------------------------------
  // Private: secret packaging / unpackaging for bundles
  // ---------------------------------------------------------------------------

  /**
   * Scans ALL entity arrays in the bundle for `@sec:*` references and, when a
   * `bundlePassword` is provided, resolves each plaintext value and re-encrypts
   * it with a key derived from the password.  The encrypted entries are stored
   * in `bundleSecrets` (keyed by the original reference string) and returned
   * as part of the bundle.  Entity records are left unchanged — the original
   * `@sec:*` references are preserved as lookup keys.
   *
   * Scanning all arrays means any entity type that gains secret fields in the
   * future is handled automatically without changes here.
   *
   * Throws `InvalidOperationError` when at least one entity contains secret
   * references but `bundlePassword` was not supplied.
   */
  private async packBundleSecrets(bundle: ExportBundle, bundlePassword?: string): Promise<ExportBundle> {
    const allRefs = new Set<string>();
    for (const value of Object.values(bundle)) {
      if (Array.isArray(value)) {
        for (const entity of value) {
          for (const ref of this.secretRefUtils.collectReferences(entity)) {
            allRefs.add(ref);
          }
        }
      }
    }

    if (allRefs.size === 0) return bundle;

    if (!bundlePassword) {
      throw new InvalidOperationError('bundlePassword is required when exporting providers that contain secret configuration (API keys, auth tokens, etc.). Provide a bundlePassword query parameter and use the same value when importing.');
    }

    const bundleKey = deriveBundleKey(bundlePassword);
    const bundleSecrets: ExportBundle['bundleSecrets'] = {};

    for (const ref of allRefs) {
      const plaintext = await this.secretsRegistry.resolveSecret(ref);
      bundleSecrets[ref] = encryptSecret(plaintext, bundleKey);
    }

    logger.info({ secretCount: allRefs.size }, 'Provider secrets packed into bundle');

    return { ...bundle, bundleSecrets };
  }

  /**
   * Decrypts entries from `bundle.bundleSecrets` using the supplied `bundlePassword`,
   * stores each plaintext value as a new secret under the local master encryption key,
   * and returns a copy of the bundle with `@sec:*` references remapped to the newly
   * created local secret IDs across ALL entity arrays.
   *
   * Remapping all arrays means any entity type that gains secret fields in the
   * future is handled automatically without changes here.
   *
   * In `dryRun` mode the secrets are decrypted to verify the password but are
   * NOT written to the database — the original bundle is returned unchanged.
   *
   * Throws `InvalidOperationError` when the bundle contains secrets but no password
   * is provided, or when decryption fails (wrong password / tampered bundle).
   */
  private async unpackBundleSecrets(bundle: ExportBundle, bundlePassword: string | undefined, dryRun: boolean): Promise<ExportBundle> {
    const { bundleSecrets } = bundle;

    if (!bundleSecrets || Object.keys(bundleSecrets).length === 0) {
      return bundle;
    }

    if (!bundlePassword) {
      throw new InvalidOperationError('bundlePassword is required to import this bundle because it contains encrypted provider secrets.');
    }

    const bundleKey = deriveBundleKey(bundlePassword);

    // Decrypt all entries first to validate the password before writing anything
    const decrypted = new Map<string, string>();
    try {
      for (const [ref, entry] of Object.entries(bundleSecrets)) {
        decrypted.set(ref, decryptSecret(entry.encryptedValue, entry.iv, entry.tag, bundleKey));
      }
    } catch {
      throw new InvalidOperationError('Invalid bundlePassword: failed to decrypt bundle secrets. Ensure the same password that was used during export is provided.');
    }

    if (dryRun) {
      logger.info({ secretCount: decrypted.size }, 'Bundle secrets validated (dry-run, not written to database)');
      return bundle;
    }

    // Store each decrypted secret under the local master key and build a ref remap
    const refRemap = new Map<string, string>();
    for (const [oldRef, plaintext] of decrypted) {
      const newRef = await this.secretsRegistry.storeSecret(this.secretsRegistry.defaultManagerName, plaintext);
      refRemap.set(oldRef, newRef);
    }

    logger.info({ secretCount: refRemap.size }, 'Bundle secrets re-encrypted and stored under local master key');

    // Remap refs in every entity array — covers any entity type that holds secrets
    const remappedBundle = { ...bundle };
    for (const [key, value] of Object.entries(bundle)) {
      if (Array.isArray(value)) {
        (remappedBundle as any)[key] = value.map(entity => this.replaceSecretRefs(entity, refRemap));
      }
    }

    return remappedBundle;
  }

  /**
   * Recursively walks a JSON-serializable value and replaces any string that
   * matches a key in `refMap` with the corresponding mapped value.
   */
  private replaceSecretRefs(value: unknown, refMap: Map<string, string>): unknown {
    if (typeof value === 'string') return refMap.has(value) ? refMap.get(value)! : value;
    if (Array.isArray(value)) return value.map(item => this.replaceSecretRefs(item, refMap));
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this.replaceSecretRefs(v, refMap);
      }
      return result;
    }
    return value;
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
   *  3. Pull up parent entities required by children (agents from stages, etc.).
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

    const [explicitAgentRows, explicitClassifierRows, explicitCtRows, explicitToolRows, explicitGaRows, explicitKcRows, explicitGrRows, explicitCdRows, explicitScRows, explicitSSQRows, explicitSFQRows, explicitStageRows, explicitApiKeyRows, explicitTesterRows, explicitScenarioRows] = await Promise.all([
      this.fetchOrAll(selectAll || !!selection.agentIds?.length, agents, selection.agentIds, agents.id),
      this.fetchOrAll(selectAll || !!selection.classifierIds?.length, classifiers, selection.classifierIds, classifiers.id),
      this.fetchOrAll(selectAll || !!selection.contextTransformerIds?.length, contextTransformers, selection.contextTransformerIds, contextTransformers.id),
      this.fetchOrAll(selectAll || !!selection.toolIds?.length, tools, selection.toolIds, tools.id),
      this.fetchOrAll(selectAll || !!selection.globalActionIds?.length, globalActions, selection.globalActionIds, globalActions.id),
      this.fetchOrAll(selectAll || !!selection.knowledgeCategoryIds?.length, knowledgeCategories, selection.knowledgeCategoryIds, knowledgeCategories.id),
      this.fetchOrAll(selectAll || !!selection.guardrailIds?.length, guardrails, selection.guardrailIds, guardrails.id),
      this.fetchOrAll(selectAll || !!selection.copyDecoratorIds?.length, copyDecorators, selection.copyDecoratorIds, copyDecorators.id),
      this.fetchOrAll(selectAll || !!selection.sampleCopyIds?.length, sampleCopies, selection.sampleCopyIds, sampleCopies.id),
      this.fetchOrAll(selectAll || !!selection.savedSliceQueryIds?.length, savedSliceQueries, selection.savedSliceQueryIds, savedSliceQueries.id),
      this.fetchOrAll(selectAll || !!selection.savedFunnelQueryIds?.length, savedFunnelQueries, selection.savedFunnelQueryIds, savedFunnelQueries.id),
      this.fetchOrAll(selectAll || !!selection.stageIds?.length, stages, selection.stageIds, stages.id),
      this.fetchOrAll(selectAll || !!selection.apiKeyIds?.length, apiKeys, selection.apiKeyIds, apiKeys.id),
      this.fetchOrAll(selectAll || !!selection.testerIds?.length, testers, selection.testerIds, testers.id),
      this.fetchOrAll(selectAll || !!selection.scenarioIds?.length, scenarios, selection.scenarioIds, scenarios.id),
    ]);

    // ── 3. Expand project selections: fetch all children for selected projects ─

    const expandedProjectIds = new Set(projectRows.map(p => p.id));

    const childrenOfProjects = expandedProjectIds.size > 0 && !selectAll
      ? await Promise.all([
        db.select().from(agents).where(inArray(agents.projectId, [...expandedProjectIds])),
        db.select().from(classifiers).where(inArray(classifiers.projectId, [...expandedProjectIds])),
        db.select().from(contextTransformers).where(inArray(contextTransformers.projectId, [...expandedProjectIds])),
        db.select().from(tools).where(inArray(tools.projectId, [...expandedProjectIds])),
        db.select().from(globalActions).where(inArray(globalActions.projectId, [...expandedProjectIds])),
        db.select().from(knowledgeCategories).where(inArray(knowledgeCategories.projectId, [...expandedProjectIds])),
        db.select().from(guardrails).where(inArray(guardrails.projectId, [...expandedProjectIds])),
        db.select().from(copyDecorators).where(inArray(copyDecorators.projectId, [...expandedProjectIds])),
        db.select().from(sampleCopies).where(inArray(sampleCopies.projectId, [...expandedProjectIds])),
        db.select().from(savedSliceQueries).where(inArray(savedSliceQueries.projectId, [...expandedProjectIds])),
        db.select().from(savedFunnelQueries).where(inArray(savedFunnelQueries.projectId, [...expandedProjectIds])),
        db.select().from(stages).where(inArray(stages.projectId, [...expandedProjectIds])),
        db.select().from(apiKeys).where(inArray(apiKeys.projectId, [...expandedProjectIds])),
        db.select().from(testers).where(inArray(testers.projectId, [...expandedProjectIds])),
        db.select().from(scenarios).where(inArray(scenarios.projectId, [...expandedProjectIds])),
      ])
      : [[], [], [], [], [], [], [], [], [], [], [], [], [], [], []];

    // Merge explicit + project-child rows (deduplicated by ID)
    const agentRows = this.dedup([...explicitAgentRows, ...childrenOfProjects[0] as any[]], 'id');
    const classifierRows = this.dedup([...explicitClassifierRows, ...childrenOfProjects[1] as any[]], 'id');
    const ctRows = this.dedup([...explicitCtRows, ...childrenOfProjects[2] as any[]], 'id');
    const toolRows = this.dedup([...explicitToolRows, ...childrenOfProjects[3] as any[]], 'id');
    const gaRows = this.dedup([...explicitGaRows, ...childrenOfProjects[4] as any[]], 'id');
    const kcRows = this.dedup([...explicitKcRows, ...childrenOfProjects[5] as any[]], 'id');
    const grRows = this.dedup([...explicitGrRows, ...childrenOfProjects[6] as any[]], 'id');
    const cdRows = this.dedup([...explicitCdRows, ...childrenOfProjects[7] as any[]], 'id');
    const scRows = this.dedup([...explicitScRows, ...childrenOfProjects[8] as any[]], 'id');
    const ssqRows = this.dedup([...explicitSSQRows, ...childrenOfProjects[9] as any[]], 'id');
    const sfqRows = this.dedup([...explicitSFQRows, ...childrenOfProjects[10] as any[]], 'id');
    const stageRows = this.dedup([...explicitStageRows, ...childrenOfProjects[11] as any[]], 'id');
    const apiKeyRows = this.dedup([...explicitApiKeyRows, ...childrenOfProjects[12] as any[]], 'id');
    const testerRows = this.dedup([...explicitTesterRows, ...childrenOfProjects[13] as any[]], 'id');
    const scenarioRows = this.dedup([...explicitScenarioRows, ...childrenOfProjects[14] as any[]], 'id');

    // ── 4. Knowledge items — fetch all items for every included category ─────

    const allKcRows = this.dedup([...kcRows], 'id');

    // All knowledge items for all categories we're including
    const allKcIds = allKcRows.map(kc => kc.id);
    const kiRows = allKcIds.length > 0
      ? await db.select().from(knowledgeItems).where(inArray(knowledgeItems.categoryId, allKcIds))
      : [];

    // ── 5. Collect parent projects missing from explicit project selection ─────

    const allEntityProjectIds = new Set<string>([
      ...agentRows.map(r => r.projectId),
      ...classifierRows.map(r => r.projectId),
      ...ctRows.map(r => r.projectId),
      ...toolRows.map(r => r.projectId),
      ...gaRows.map(r => r.projectId),
      ...allKcRows.map(r => r.projectId),
      ...grRows.map(r => r.projectId),
      ...ssqRows.map(r => r.projectId),
      ...sfqRows.map(r => r.projectId),
      ...stageRows.map(r => r.projectId),
      ...apiKeyRows.map(r => r.projectId),
      ...testerRows.map(r => r.projectId),
      ...scenarioRows.map(r => r.projectId),
    ]);

    const missingProjectIds = [...allEntityProjectIds].filter(id => !expandedProjectIds.has(id));
    const additionalProjectRows = missingProjectIds.length > 0
      ? await db.select().from(projects).where(inArray(projects.id, missingProjectIds))
      : [];
    const allProjectRows = this.dedup([...projectRows, ...additionalProjectRows], 'id');

    // ── 6. Collect parent agents for stages that reference agents not yet in bundle ─

    const stageAgentIds = stageRows.map(s => s.agentId).filter(Boolean) as string[];
    const missingAgentIds = stageAgentIds.filter(id => !agentRows.find(p => p.id === id));
    const additionalAgentRows = missingAgentIds.length > 0
      ? await db.select().from(agents).where(inArray(agents.id, missingAgentIds))
      : [];
    const allAgentRows = this.dedup([...agentRows, ...additionalAgentRows], 'id');

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

    // ── 8. Collect parent copyDecorators for sampleCopies that reference decorators not yet in bundle ─

    const sampleCopyDecoratorIds = scRows.map(s => s.decoratorId).filter(Boolean) as string[];
    const missingDecoratorIds = sampleCopyDecoratorIds.filter(id => !cdRows.find(d => d.id === id));
    const additionalCdRows = missingDecoratorIds.length > 0
      ? await db.select().from(copyDecorators).where(inArray(copyDecorators.id, missingDecoratorIds))
      : [];
    const allCdRows = this.dedup([...cdRows, ...additionalCdRows], 'id');

    // ── 9. Collect parent classifiers for sampleCopies that reference classifiers not yet in bundle ─

    const sampleCopyClassifierIds = scRows.map(s => s.classifierOverrideId).filter(Boolean) as string[];
    const missingSampleClassifierIds = sampleCopyClassifierIds.filter(id => !allClassifierRows.find(c => c.id === id));
    const additionalSampleClassifierRows = missingSampleClassifierIds.length > 0
      ? await db.select().from(classifiers).where(inArray(classifiers.id, missingSampleClassifierIds))
      : [];
    const finalClassifierRows = this.dedup([...allClassifierRows, ...additionalSampleClassifierRows], 'id');

    // ── 10. Collect all referenced providers ──────────────────────────────────

    const referencedProviderIds = new Set<string>(selection.providerIds ?? []);

    for (const p of allAgentRows) {
      if (p.ttsProviderId) referencedProviderIds.add(p.ttsProviderId);
      const fillerLlmId = (p.fillerSettings as any)?.llmProviderId;
      if (fillerLlmId) referencedProviderIds.add(fillerLlmId);
    }
    for (const row of [...finalClassifierRows, ...allCtRows, ...toolRows, ...stageRows]) {
      if (row.llmProviderId) referencedProviderIds.add(row.llmProviderId);
    }
    for (const row of testerRows) {
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
      agents: allAgentRows,
      classifiers: finalClassifierRows,
      contextTransformers: allCtRows,
      tools: toolRows,
      globalActions: gaRows,
      knowledgeCategories: allKcRows,
      knowledgeItems: kiRows,
      copyDecorators: allCdRows,
      sampleCopies: scRows,
      savedSliceQueries: ssqRows,
      savedFunnelQueries: sfqRows,
      guardrails: grRows,
      stages: stageRows,
      apiKeys: apiKeyRows,
      testers: testerRows,
      scenarios: scenarioRows,
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

      // Resolve any encrypted secret references in credentials
      const resolvedEnv = await this.secretRefUtils.resolveObject(env as any) as typeof env;

      if (!env.url.startsWith('https://')) {
        throw new InvalidOperationError('Remote environment URL must use HTTPS to protect credentials during authentication');
      }

      // 2. Authenticate against source instance
      const authRes = await this.safeFetch(`${env.url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: resolvedEnv.login, password: resolvedEnv.password }),
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
      // Generate a single-use random bundle password so secrets travel encrypted over the wire
      const bundlePassword = randomBytes(32).toString('hex');
      exportUrl.searchParams.set('bundlePassword', bundlePassword);

      const exportRes = await this.safeFetch(exportUrl.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!exportRes.ok) throw new RemoteConnectionError(`Export fetch from source failed: HTTP ${exportRes.status}`);

      const bundle = await exportRes.json() as ExportBundle;

      // 5. Import into local DB
      const result = await this.importBundle({ bundle, force: input.force ?? false, dryRun: input.dryRun ?? false, bundlePassword }, context);

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
  // On conflict, version is incremented (not replaced) to preserve local history.
  // providers.createdBy is set to the importing operator ID since it differs between environments.
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

  private async upsertProviders(tx: DbTx, rows: any[], operatorId: string): Promise<number> {
    if (!rows.length) return 0;
    // Replace source createdBy with the importing operator's ID since operator IDs differ between environments
    await tx.insert(providers).values(rows.map(r => ({ ...this.parseTimestamps(r), createdBy: operatorId }))).onConflictDoUpdate({
      target: providers.id,
      set: {
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        providerType: sql`excluded.provider_type`,
        apiType: sql`excluded.api_type`,
        config: sql`excluded.config`,
        createdBy: operatorId,
        tags: sql`excluded.tags`,
        version: sql`${providers.version} + 1`,
        updatedAt: sql`now()`,
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
        moderationConfig: sql`excluded.moderation_config`,
        constants: sql`excluded.constants`,
        metadata: sql`excluded.metadata`,
        startingStageId: sql`excluded.starting_stage_id`,
        version: sql`${projects.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertAgents(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(agents).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [agents.projectId, agents.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        ttsProviderId: sql`excluded.tts_provider_id`,
        ttsSettings: sql`excluded.tts_settings`,
        fillerSettings: sql`excluded.filler_settings`,
        metadata: sql`excluded.metadata`,
        version: sql`${agents.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertClassifiers(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(classifiers).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [classifiers.projectId, classifiers.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        metadata: sql`excluded.metadata`,
        version: sql`${classifiers.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertContextTransformers(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(contextTransformers).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [contextTransformers.projectId, contextTransformers.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        contextFields: sql`excluded.context_fields`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        metadata: sql`excluded.metadata`,
        version: sql`${contextTransformers.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertTools(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(tools).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [tools.projectId, tools.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        type: sql`excluded.type`,
        // smart_function fields
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        inputType: sql`excluded.input_type`,
        outputType: sql`excluded.output_type`,
        // webhook fields
        url: sql`excluded.url`,
        webhookMethod: sql`excluded.webhook_method`,
        webhookHeaders: sql`excluded.webhook_headers`,
        webhookBody: sql`excluded.webhook_body`,
        // script fields
        code: sql`excluded.code`,
        // shared fields
        parameters: sql`excluded.parameters`,
        metadata: sql`excluded.metadata`,
        version: sql`${tools.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertGlobalActions(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(globalActions).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [globalActions.projectId, globalActions.id],
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
        version: sql`${globalActions.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertKnowledgeCategories(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(knowledgeCategories).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [knowledgeCategories.projectId, knowledgeCategories.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        promptTrigger: sql`excluded.prompt_trigger`,
        tags: sql`excluded.tags`,
        order: sql`excluded.order`,
        version: sql`${knowledgeCategories.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertKnowledgeItems(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(knowledgeItems).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [knowledgeItems.projectId, knowledgeItems.id],
      set: {
        categoryId: sql`excluded.category_id`,
        questions: sql`excluded.questions`,
        answer: sql`excluded.answer`,
        order: sql`excluded.order`,
        version: sql`${knowledgeItems.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertGuardrails(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(guardrails).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [guardrails.projectId, guardrails.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        condition: sql`excluded.condition`,
        classificationTrigger: sql`excluded.classification_trigger`,
        effects: sql`excluded.effects`,
        examples: sql`excluded.examples`,
        tags: sql`excluded.tags`,
        metadata: sql`excluded.metadata`,
        version: sql`${guardrails.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertCopyDecorators(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(copyDecorators).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [copyDecorators.projectId, copyDecorators.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        template: sql`excluded.template`,
        version: sql`${copyDecorators.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertSampleCopies(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(sampleCopies).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [sampleCopies.projectId, sampleCopies.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        stages: sql`excluded.stages`,
        agents: sql`excluded.agents`,
        promptTrigger: sql`excluded.prompt_trigger`,
        classifierOverrideId: sql`excluded.classifier_override_id`,
        content: sql`excluded.content`,
        amount: sql`excluded.amount`,
        samplingMethod: sql`excluded.sampling_method`,
        mode: sql`excluded.mode`,
        decoratorId: sql`excluded.decorator_id`,
        version: sql`${sampleCopies.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertSavedSliceQueries(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(savedSliceQueries).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: savedSliceQueries.id,
      set: {
        name: sql`excluded.name`,
        projectId: sql`excluded.project_id`,
        operatorId: sql`null`,
        query: sql`excluded.query`,
        isShared: sql`excluded.is_shared`,
        metadata: sql`excluded.metadata`,
        version: sql`${savedSliceQueries.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertSavedFunnelQueries(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(savedFunnelQueries).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: savedFunnelQueries.id,
      set: {
        name: sql`excluded.name`,
        projectId: sql`excluded.project_id`,
        operatorId: sql`null`,
        query: sql`excluded.query`,
        isShared: sql`excluded.is_shared`,
        version: sql`${savedFunnelQueries.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertStages(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(stages).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [stages.projectId, stages.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        agentId: sql`excluded.agent_id`,
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
        version: sql`${stages.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertApiKeys(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(apiKeys).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [apiKeys.projectId, apiKeys.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        key: sql`excluded.key`,
        lastUsedAt: sql`excluded.last_used_at`,
        isActive: sql`excluded.is_active`,
        metadata: sql`excluded.metadata`,
        version: sql`${apiKeys.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertTesters(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(testers).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [testers.projectId, testers.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        prompt: sql`excluded.prompt`,
        llmProviderId: sql`excluded.llm_provider_id`,
        llmSettings: sql`excluded.llm_settings`,
        userProfile: sql`excluded.user_profile`,
        tags: sql`excluded.tags`,
        metadata: sql`excluded.metadata`,
        version: sql`${testers.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }

  private async upsertScenarios(tx: DbTx, rows: any[]): Promise<number> {
    if (!rows.length) return 0;
    await tx.insert(scenarios).values(rows.map(r => this.parseTimestamps(r))).onConflictDoUpdate({
      target: [scenarios.projectId, scenarios.id],
      set: {
        projectId: sql`excluded.project_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        language: sql`excluded.language`,
        startingStageId: sql`excluded.starting_stage_id`,
        maxTurns: sql`excluded.max_turns`,
        endingStageIds: sql`excluded.ending_stage_ids`,
        personaCanHangUp: sql`excluded.persona_can_hang_up`,
        dataExtraction: sql`excluded.data_extraction`,
        contextTransformerId: sql`excluded.context_transformer_id`,
        dataPostProcessingExpected: sql`excluded.data_post_processing_expected`,
        tags: sql`excluded.tags`,
        metadata: sql`excluded.metadata`,
        version: sql`${scenarios.version} + 1`,
        updatedAt: sql`now()`,
      },
    });
    return rows.length;
  }
}
