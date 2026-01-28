import { injectable, inject } from 'tsyringe';
import { eq, and, desc, SQL } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers } from '../../db/schema';
import type { CreateProviderRequest, UpdateProviderRequest, ProviderResponse, ProviderListResponse } from '../../http/contracts/provider';
import type { ListParams } from '../../http/contracts/common';
import { providerResponseSchema, providerListResponseSchema } from '../../http/contracts/provider';
import { AuditService } from '../AuditService';
import { OptimisticLockError, NotFoundError } from '../../errors';
import { buildFilterCondition, buildOrderBy } from '../../utils/queryBuilder';
import { logger } from '../../utils/logger';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';

/**
 * Service for managing provider configurations with full CRUD operations and audit logging
 */
@injectable()
export class ProviderService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
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
    logger.info({ providerId, displayName: input.displayName, providerType: input.providerType, apiType: input.apiType, contextAdminId: context?.adminId }, 'Creating provider');

    try {
      const provider = await db.insert(providers).values({ id: providerId, displayName: input.displayName, description: input.description, providerType: input.providerType, apiType: input.apiType, config: input.config, createdBy: input.createdBy || context?.adminId, tags: input.tags, version: 1 }).returning();

      const createdProvider = provider[0];

      await this.auditService.logCreate('provider', createdProvider.id, { id: createdProvider.id, displayName: createdProvider.displayName, providerType: createdProvider.providerType, apiType: createdProvider.apiType, config: createdProvider.config, tags: createdProvider.tags }, context?.adminId);

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
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: providers.id,
        displayName: providers.displayName,
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
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches displayName, description, and id)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        const { like, or } = await import('drizzle-orm');
        conditions.push(or(like(providers.displayName, searchTerm), like(providers.description, searchTerm), like(providers.id, searchTerm))!);
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.providers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const providerList = await db.query.providers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(providers.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      // Filter by tags if needed (array contains check)
      let filteredList = providerList;
      if (params?.filters?.tags) {
        const tagsFilter = params.filters.tags;
        let tagValues: string[] = [];

        if (Array.isArray(tagsFilter)) {
          tagValues = tagsFilter as string[];
        } else if (typeof tagsFilter === 'object' && 'value' in tagsFilter && Array.isArray(tagsFilter.value)) {
          tagValues = tagsFilter.value as string[];
        }

        if (tagValues.length > 0) {
          filteredList = providerList.filter(provider => provider.tags?.some(tag => tagValues.includes(tag)));
        }
      }

      return providerListResponseSchema.parse({
        items: filteredList,
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
    logger.info({ providerId: id, expectedVersion, contextAdminId: context?.adminId }, 'Updating provider');

    try {
      const existingProvider = await db.query.providers.findFirst({ where: eq(providers.id, id) });

      if (!existingProvider) {
        throw new NotFoundError(`Provider with id ${id} not found`);
      }

      if (existingProvider.version !== expectedVersion) {
        throw new OptimisticLockError(`Provider version mismatch. Expected ${expectedVersion}, got ${existingProvider.version}`);
      }

      const updatePayload: any = {
        displayName: updateData.displayName,
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

      await this.auditService.logUpdate('provider', provider.id, { id: existingProvider.id, displayName: existingProvider.displayName, providerType: existingProvider.providerType, apiType: existingProvider.apiType, config: existingProvider.config, tags: existingProvider.tags }, { id: provider.id, displayName: provider.displayName, providerType: provider.providerType, apiType: provider.apiType, config: provider.config, tags: provider.tags }, context?.adminId);

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
    logger.info({ providerId: id, expectedVersion, contextAdminId: context?.adminId }, 'Deleting provider');

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

      await this.auditService.logDelete('provider', id, { id: existingProvider.id, displayName: existingProvider.displayName, providerType: existingProvider.providerType, apiType: existingProvider.apiType, config: existingProvider.config, tags: existingProvider.tags }, context?.adminId);

      logger.info({ providerId: id }, 'Provider deleted successfully');
    } catch (error) {
      logger.error({ error, providerId: id }, 'Failed to delete provider');
      throw error;
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
