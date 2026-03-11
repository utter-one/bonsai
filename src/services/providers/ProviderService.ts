import { injectable, inject } from 'tsyringe';
import { eq, and, desc, sql, SQL } from 'drizzle-orm';
import { buildTextSearchCondition } from '../../utils/textSearch';
import { db } from '../../db/index';
import { providers } from '../../db/schema';
import type { CreateProviderRequest, UpdateProviderRequest, ProviderResponse, ProviderListResponse } from '../../http/contracts/provider';
import type { ListParams } from '../../http/contracts/common';
import { providerResponseSchema, providerListResponseSchema } from '../../http/contracts/provider';
import { AuditService } from '../AuditService';
import { OptimisticLockError, NotFoundError, InvalidOperationError } from '../../errors';
import { buildFilterCondition, buildOrderBy } from '../../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../../utils/pagination';
import { logger } from '../../utils/logger';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import { LlmProviderFactory } from './llm/LlmProviderFactory';
import type { LlmModelInfo } from './ProviderCatalogService';

/**
 * Service for managing provider configurations with full CRUD operations and audit logging
 */
@injectable()
export class ProviderService extends BaseService {
  constructor(
    @inject(AuditService) private readonly auditService: AuditService,
    @inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory,
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

    try {
      const provider = await db.insert(providers).values({ id: providerId, name: input.name, description: input.description, providerType: input.providerType, apiType: input.apiType, config: input.config, createdBy: input.createdBy || context?.operatorId, tags: input.tags, version: 1 }).returning();

      const createdProvider = provider[0];

      const { config: _config, ...safeCreatedProvider } = createdProvider;
      await this.auditService.logCreate('provider', createdProvider.id, safeCreatedProvider, context?.operatorId);

      logger.info({ providerId: createdProvider.id }, 'Provider created successfully');

      return providerResponseSchema.parse(createdProvider);
    } catch (error) {
      logger.error({ error, providerId: input.id }, 'Failed to create provider');
      throw error;
    }
  }

  /**
   * Retrieves a provider by its unique identifier
   * @param id - The unique identifier of the provider
   * @param context - Request context for authorization
   * @returns The provider if found
   * @throws {NotFoundError} When provider is not found
   */
  async getProviderById(id: string, context?: RequestContext): Promise<ProviderResponse> {
    if (context) {
      this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    }
    logger.debug({ providerId: id }, 'Fetching provider by ID');

    try {
      const provider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

      if (!provider) {
        throw new NotFoundError(`Provider with id ${id} not found`);
      }

      return providerResponseSchema.parse(provider);
    } catch (error) {
      logger.error({ error, providerId: id }, 'Failed to fetch provider');
      throw error;
    }
  }

  /**
   * Lists providers with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @param context - Request context for authorization
   * @returns Paginated array of providers matching the criteria
   */
  async listProviders(params?: ListParams, context?: RequestContext): Promise<ProviderListResponse> {
    if (context) {
      this.requirePermission(context, PERMISSIONS.PROVIDER_READ);
    }
    logger.debug({ params }, 'Listing providers');

    try {
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
            conditions.push(sql`${providers.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
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
    } catch (error) {
      logger.error({ error, params }, 'Failed to list providers');
      throw error;
    }
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

    try {
      const existingProvider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

      if (!existingProvider) {
        throw new NotFoundError(`Provider with id ${id} not found`);
      }

      if (existingProvider.version !== expectedVersion) {
        throw new OptimisticLockError(`Provider version mismatch. Expected ${expectedVersion}, got ${existingProvider.version}`);
      }

      const updatePayload: any = {
        name: updateData.name,
        description: updateData.description,
        providerType: updateData.providerType,
        apiType: updateData.apiType,
        config: updateData.config,
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

      return providerResponseSchema.parse(provider);
    } catch (error) {
      logger.error({ error, providerId: id }, 'Failed to update provider');
      throw error;
    }
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

    try {
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
    } catch (error) {
      logger.error({ error, providerId: id }, 'Failed to delete provider');
      throw error;
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

    const instance = this.llmProviderFactory.createProviderForEnumeration(provider);
    await instance.init();
    try {
      return await instance.enumerateModels();
    } finally {
      await instance.cleanup();
    }
  }

  /**
   * Retrieves all audit log entries for a specific provider
   * @param providerId - The unique identifier of the provider
   * @param context - Request context for authorization
   * @returns Array of audit log entries for the provider
   */
  async getProviderAuditLogs(providerId: string, context?: RequestContext): Promise<any[]> {
    if (context) {
      this.requirePermission(context, PERMISSIONS.AUDIT_READ);
    }
    logger.debug({ providerId }, 'Fetching audit logs for provider');

    try {
      return await this.auditService.getEntityAuditLogs('provider', providerId);
    } catch (error) {
      logger.error({ error, providerId }, 'Failed to fetch provider audit logs');
      throw error;
    }
  }
}
