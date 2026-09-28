import { injectable, inject } from 'tsyringe';
import { eq, and, desc, sql, SQL, inArray as drizzleInArray } from 'drizzle-orm';
import { buildTextSearchCondition } from '../../utils/textSearch';
import { db } from '../../db/index';
import { providers, projects } from '../../db/schema';
import type { CreateProviderRequest, UpdateProviderRequest, ProviderResponse, ProviderListResponse } from '../../http/contracts/provider';
import type { ConnectionTestRequestBody, ConnectionTestResponseBody } from '../../http/contracts/providerConnectionTest';
import { connectionTestResultSchema } from '../../http/contracts/providerConnectionTest';
import type { ListParams } from '../../http/contracts/common';
import { providerResponseSchema, providerListResponseSchema } from '../../http/contracts/provider';
import { ProviderConnectionTester } from './connectionTest/ProviderConnectionTester';
import type { ConnectionTestInput } from './connectionTest/types';
import { AuditService } from '../AuditService';
import { OptimisticLockError, NotFoundError, InvalidOperationError, ValidationError } from '../../errors';
import { buildFilterCondition, buildOrderBy } from '../../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../../utils/pagination';
import { logger } from '../../utils/logger';
import { BaseService } from '../BaseService';
import { DeferredProcessingService } from '../DeferredProcessingService';
import { ImapInboundService } from '../ImapInboundService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import { LlmProviderFactory } from './llm/LlmProviderFactory';
import type { LlmModelInfo } from './ProviderCatalogService';
import { SecretRefUtils, SENSITIVE_PROVIDER_CONFIG_FIELDS } from '../secrets/SecretRefUtils';
import { FallbackResolver } from './FallbackResolver';
import { SlackChannelHost } from '../../channels/slack/SlackChannelHost';
import { slackChannelProviderConfigSchema } from './channel/SlackChannelProvider';
import { validateFallbacks, type FallbackGraphNodes } from './fallbackValidation';
import type { ProviderFallback } from '../../db/schema';

/**
 * Service for managing provider configurations with full CRUD operations and audit logging
 */
@injectable()
export class ProviderService extends BaseService {
  constructor(
    @inject(AuditService) private readonly auditService: AuditService,
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
    @inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
    @inject(SecretRefUtils) private readonly secretRefUtils: SecretRefUtils,
    @inject(ImapInboundService) private readonly imapInboundService: ImapInboundService,
    @inject(FallbackResolver) private readonly fallbackResolver: FallbackResolver,
    @inject(ProviderConnectionTester) private readonly connectionTester: ProviderConnectionTester,
    @inject(SlackChannelHost) private readonly slackChannelHost: SlackChannelHost,
  ) {
    super();
  }

  /**
   * Creates a new provider and logs the creation in the audit trail
   * @param input - Provider creation data including id, displayName, type, providerName, config, and optional fields
   * @param context - Request context for auditing and authorization
   * @returns The created provider
   */
  async createProvider(input: CreateProviderRequest, context: RequestContext): Promise<ProviderResponse> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_WRITE);
    const providerId = input.id ?? generateId(ID_PREFIXES.PROVIDER);
    logger.info({ providerId, name: input.name, providerType: input.providerType, apiType: input.apiType, operatorId: context?.operatorId }, 'Creating provider');

    // Normalize settings: the contract allows null, the column stores undefined.
    const fallbacks = input.fallbacks.map((f) => ({ providerId: f.providerId, settings: f.settings ?? undefined }));
    if (fallbacks.length > 0) {
      await this.validateFallbacks(providerId, input.providerType, fallbacks);
    }

    await this.assertValidSlackConfig(input.apiType, input.config as Record<string, unknown>);

    const secretizedConfig = await this.secretRefUtils.secretizeObject(input.config as Record<string, unknown>, SENSITIVE_PROVIDER_CONFIG_FIELDS);
    const provider = await db.insert(providers).values({ id: providerId, name: input.name, description: input.description, providerType: input.providerType, apiType: input.apiType, config: secretizedConfig as typeof input.config, fallbacks, createdBy: context?.operatorId, tags: input.tags, version: 1 }).returning();

    const createdProvider = provider[0];
    this.fallbackResolver.invalidate(createdProvider.id);

    if (createdProvider.apiType === 'slack') {
      this.slackChannelHost.onProviderChanged(createdProvider.id);
    }

    const { config: _config, ...safeCreatedProvider } = createdProvider;
    await this.auditService.logCreate('provider', createdProvider.id, safeCreatedProvider, context?.operatorId);

    logger.info({ providerId: createdProvider.id }, 'Provider created successfully');

    return providerResponseSchema.parse(createdProvider);
  }

  /**
   * Retrieves a provider by its unique identifier
   * @param id - The unique identifier of the provider
   * @param context - Request context for authorization
   * @returns The provider if found
   * @throws {NotFoundError} When provider is not found
   */
  async getProviderById(id: string, context: RequestContext): Promise<ProviderResponse> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    logger.debug({ providerId: id }, 'Fetching provider by ID');

    const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

    if (!provider) {
      throw new NotFoundError(`Provider with id ${id} not found`);
    }

    return providerResponseSchema.parse(provider);
  }

  /**
   * Lists providers with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @param context - Request context for authorization
   * @returns Paginated array of providers matching the criteria
   */
  async listProviders(context: RequestContext, params?: ListParams): Promise<ProviderListResponse> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    logger.debug({ params }, 'Listing providers');

    const conditions: SQL[] = [];
    const offset = params?.offset ?? 0;
    const limit = normalizeListLimit(params?.limit);

    // Column map for filter and order by operations
    const columnMap = {
      id: providers.id,
      name: providers.name,
      providerType: providers.providerType,
      apiType: providers.apiType,
      createdBy: providers.createdBy,
      version: providers.version,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
    };

    // Apply filters
    if (params?.filters) {
      for (const [field, filter] of Object.entries(params.filters)) {
        if (field === 'tags') {
          const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
          conditions.push(sql`${providers.tags} @> ${sql.param(JSON.stringify(tagsArray))}::jsonb`);
          continue;
        }
        const condition = buildFilterCondition(field, filter, columnMap, logger);
        if (condition) {
          conditions.push(condition);
        }
      }
    }

    // Apply text search (searches name, id, providerType, apiType — or tag JSONB containment for "tag:" prefix)
    if (params?.textSearch) {
      const searchCondition = buildTextSearchCondition(params.textSearch, [providers.name, providers.id, providers.providerType, providers.apiType], providers.tags);
      if (searchCondition) conditions.push(searchCondition);
    }

    // Build order by clause
    const orderByClause = buildOrderBy(params?.orderBy, columnMap);
    const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

    const total = await countRows(providers, whereCondition);

    // Get paginated results
    const providerList = await db.query.providers.findMany({
      where: whereCondition,
      orderBy: orderByClause.length > 0 ? orderByClause : [desc(providers.createdAt)],
      limit,
      offset,
    });

    return providerListResponseSchema.parse({
      items: providerList,
      total,
      offset,
      limit,
    });
  }

  /**
   * Updates a provider using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the provider to update
   * @param input - Provider update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated provider
   * @throws {NotFoundError} When provider is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateProvider(id: string, input: UpdateProviderRequest, context: RequestContext): Promise<ProviderResponse> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ providerId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating provider');

    const existingProvider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

    if (!existingProvider) {
      throw new NotFoundError(`Provider with id ${id} not found`);
    }

    if (existingProvider.version !== expectedVersion) {
      throw new OptimisticLockError(`Provider version mismatch. Expected ${expectedVersion}, got ${existingProvider.version}`);
    }

    // Normalize settings: the contract allows null, the column stores undefined.
    const fallbacks = updateData.fallbacks?.map((f) => ({ providerId: f.providerId, settings: f.settings ?? undefined }));
    if (fallbacks) {
      const effectiveType = updateData.providerType ?? existingProvider.providerType;
      await this.validateFallbacks(id, effectiveType, fallbacks);
    }

    // Only re-validate the Slack config when this update actually changes it, so an
    // unrelated edit (e.g. a rename) is not blocked by a pre-existing invalid config
    // or a bound project that was archived after the provider was created.
    if (updateData.config !== undefined || updateData.apiType !== undefined) {
      await this.assertValidSlackConfig(updateData.apiType ?? existingProvider.apiType, (updateData.config ?? existingProvider.config) as Record<string, unknown>);
    }

    const updatePayload: any = {
      name: updateData.name,
      description: updateData.description,
      providerType: updateData.providerType,
      apiType: updateData.apiType,
      fallbacks,
      config: updateData.config ? await this.secretRefUtils.secretizeObject(
        { ...(updateData.config as Record<string, unknown>), oauth2: (updateData.config as Record<string, unknown>).oauth2 ?? (existingProvider.config as Record<string, unknown>).oauth2 },
        SENSITIVE_PROVIDER_CONFIG_FIELDS,
      ) : updateData.config,
      tags: updateData.tags,
      version: existingProvider.version + 1,
      updatedAt: new Date(),
    };

    const updatedProvider = await db.update(providers).set(updatePayload).where(and(eq(providers.id, id), eq(providers.version, expectedVersion))).returning();

    if (updatedProvider.length === 0) {
      throw new OptimisticLockError(`Failed to update provider due to version conflict`);
    }

    const provider = updatedProvider[0];

    const { config: _oldConfig, ...safeExistingProvider } = existingProvider;
    const { config: _newConfig, ...safeProvider } = provider;
    await this.auditService.logUpdate('provider', provider.id, safeExistingProvider, safeProvider, context?.operatorId);

    logger.info({ providerId: provider.id, newVersion: provider.version }, 'Provider updated successfully');

    if (provider.apiType === 'smtp_imap') {
      this.imapInboundService.reload(provider.id);
    }
    // Reconcile the socket connection if the provider is slack now or was slack
    // before (covers toggling the apiType as well as config changes).
    if (existingProvider.apiType === 'slack' || provider.apiType === 'slack') {
      this.slackChannelHost.onProviderChanged(provider.id);
    }

    this.fallbackResolver.invalidate(provider.id);

    return providerResponseSchema.parse(provider);
  }

  /**
   * Deletes a provider using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the provider to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When provider is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteProvider(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_DELETE);
    logger.info({ providerId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting provider');

    const existingProvider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

    if (!existingProvider) {
      throw new NotFoundError(`Provider with id ${id} not found`);
    }

    if (existingProvider.version !== expectedVersion) {
      throw new OptimisticLockError(`Provider version mismatch. Expected ${expectedVersion}, got ${existingProvider.version}`);
    }

    const deleted = await db.delete(providers).where(and(eq(providers.id, id), eq(providers.version, expectedVersion))).returning();

    if (deleted.length === 0) {
      throw new OptimisticLockError(`Failed to delete provider due to version conflict`);
    }

    const { config: _config, ...safeExistingProvider } = existingProvider;
    await this.auditService.logDelete('provider', id, safeExistingProvider, context?.operatorId);

    logger.info({ providerId: id }, 'Provider deleted successfully');

    // Drop this provider's cached chain plus the chains of every provider
    // that references it as a fallback target.
    this.fallbackResolver.invalidate(id);
    await this.fallbackResolver.invalidateReferences(id);

    if (existingProvider.apiType === 'smtp_imap') {
      this.imapInboundService.stopSession(id);
    }
    // Close the socket connection if this was a slack provider.
    if (existingProvider.apiType === 'slack') {
      this.slackChannelHost.onProviderChanged(id);
    }

    // Cancel any pending deferred messages for this provider
    try {
      await this.deferredProcessingService.cancelByProviderId(id);
    } catch (error) {
      logger.error({ error, providerId: id }, 'Failed to cancel deferred messages after provider deletion');
    }
  }

  /**
   * Enumerates available models for a configured LLM provider by calling its API.
   * Falls back to static model lists when the provider API is unavailable.
   * @param id - The unique identifier of the provider
   * @param context - Request context for authorization
   * @returns Array of available LLM models
   * @throws {NotFoundError} When provider is not found
   * @throws {InvalidOperationError} When provider is not an LLM provider
   */
  async enumerateModels(id: string, context: RequestContext): Promise<LlmModelInfo[]> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    logger.debug({ providerId: id }, 'Enumerating models for provider');

    const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

    if (!provider) {
      throw new NotFoundError(`Provider with id ${id} not found`);
    }

    if (provider.providerType !== 'llm') {
      throw new InvalidOperationError(`Provider ${id} is not an LLM provider (type: ${provider.providerType})`);
    }

    const instance = await this.llmProviderFactory.createProviderForEnumeration(provider);
    await instance.init();
    try {
      return await instance.enumerateModels();
    } finally {
      await instance.cleanup();
    }
  }

  /**
   * Runs an on-demand provider connection test (saved or draft mode, TPC-06).
   * Vendor failures return a structured 200 result; only guard errors (400/404/
   * 429) surface as HTTP errors. Read-equivalent: it may write+delete one temp
   * storage object (server-side cleanup), which `provider:read` scopes.
   * Audit is logged for saved mode only (drafts are never persisted).
   * @param input - Saved (providerId) or draft (providerType/apiType/config) request
   * @param context - Request context for authorization and auditing
   * @returns The structured connection test result
   */
  async testConnection(input: ConnectionTestRequestBody, context: RequestContext): Promise<ConnectionTestResponseBody> {
    this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    const saved = 'providerId' in input;
    logger.info({ mode: saved ? 'saved' : 'draft', providerId: saved ? input.providerId : undefined, providerType: saved ? undefined : input.providerType, operatorId: context?.operatorId }, 'Running provider connection test');
    const result = await this.connectionTester.testConnection(input as ConnectionTestInput, context);
    if (saved) {
      await this.auditService.logEvent('provider', input.providerId, 'CONNECTION_TEST', result, context?.operatorId);
    }
    return connectionTestResultSchema.parse(result);
  }

  /**
   * Retrieves all audit log entries for a specific provider
   * @param providerId - The unique identifier of the provider
   * @param context - Request context for authorization
   * @returns Array of audit log entries for the provider
   */
  async getProviderAuditLogs(providerId: string, context: RequestContext): Promise<any[]> {
    this.requirePermission(context, PERMISSIONS.AUDIT_READ);
    logger.debug({ providerId }, 'Fetching audit logs for provider');

    return await this.auditService.getEntityAuditLogs('provider', providerId);
  }

  /**
   * Loads the fallback graph reachable from `fallbacks` (batched BFS over
   * the providers table) and runs the pure validation rules.
   * Throws ValidationError (400) on duplicate/self/missing/mismatch/cycle.
   */
  private async validateFallbacks(primaryId: string, primaryType: string, fallbacks: ProviderFallback[]): Promise<void> {
    const graph: FallbackGraphNodes = new Map();
    const queued = new Set<string>();
    let batch = fallbacks.map((f) => f.providerId);
    for (const id of batch) {
      queued.add(id);
    }

    while (batch.length > 0) {
      const rows = await db
        .select({ id: providers.id, providerType: providers.providerType, fallbacks: providers.fallbacks })
        .from(providers)
        .where(drizzleInArray(providers.id, batch));

      const next: string[] = [];
      for (const row of rows) {
        const targetIds = (row.fallbacks ?? []).map((f) => f.providerId);
        graph.set(row.id, { providerType: row.providerType, fallbackTargetIds: targetIds });
        for (const targetId of targetIds) {
          if (!queued.has(targetId)) {
            queued.add(targetId);
            next.push(targetId);
          }
        }
      }
      batch = next;
    }

    validateFallbacks(primaryId, primaryType, fallbacks, graph);
  }

  /**
   * Validates a Slack provider config at write time, failing fast (400) so a
   * misconfiguration is rejected instead of being stored and silently failing
   * later. The schema's `superRefine` enforces the per-mode required credentials
   * (botToken + signingSecret for events_api; appToken + projectId for
   * socket_mode); this adds the one check the schema can't — that a socket_mode
   * `projectId` references an existing, non-archived project. No-op for
   * non-slack providers.
   */
  private async assertValidSlackConfig(apiType: string | undefined, config: Record<string, unknown> | undefined): Promise<void> {
    if (apiType !== 'slack' || !config) return;
    const parsed = slackChannelProviderConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new ValidationError('Invalid Slack channel provider config', parsed.error.issues.map((i) => ({ code: i.code, path: i.path as (string | number)[], message: i.message })));
    }
    if (parsed.data.mode !== 'socket_mode') return;
    const project = await db.query.projects.findFirst({ where: eq(projects.id, parsed.data.projectId) });
    if (!project) {
      throw new ValidationError('projectId does not reference an existing project', [{ code: 'custom', path: ['config', 'projectId'], message: `projectId ${parsed.data.projectId} does not reference an existing project` }]);
    }
    if (project.archivedAt != null) {
      throw new ValidationError('projectId references an archived project', [{ code: 'custom', path: ['config', 'projectId'], message: `projectId ${parsed.data.projectId} references an archived project` }]);
    }
  }
}
