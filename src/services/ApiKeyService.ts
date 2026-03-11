import { injectable, inject } from 'tsyringe';
import { eq, ilike, or, inArray, SQL, desc, and, isNotNull } from 'drizzle-orm';
import crypto from 'crypto';
import { db } from '../db/index';
import { apiKeys, projects } from '../db/schema';
import type { CreateApiKeyRequest, UpdateApiKeyRequest, ApiKeyResponse, ApiKeyListResponse } from '../http/contracts/apiKey';
import type { ListParams } from '../http/contracts/common';
import { apiKeyResponseSchema, apiKeyListResponseSchema } from '../http/contracts/apiKey';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { parseTextSearch } from '../utils/textSearch';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing API keys with full CRUD operations and audit logging
 * API keys are used for WebSocket authentication to conduct conversations
 */
@injectable()
export class ApiKeyService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Generate a secure random API key
   * Format: akey_live_{random_string}
   * @returns The generated API key string
   */
  private generateApiKey(): string {
    const randomBytes = crypto.randomBytes(32);
    const randomString = randomBytes.toString('base64url');
    return `akey_live_${randomString}`;
  }

  /**
   * Get a preview of an API key (first 12 characters)
   * @param key - The full API key
   * @returns Preview string
   */
  private getKeyPreview(key: string): string {
    return key.substring(0, 12) + '...';
  }

  /**
   * Creates a new API key and logs the creation in the audit trail
   * @param input - API key creation data including projectId, name, and optional metadata
   * @param context - Request context for auditing and authorization
   * @returns The created API key with the full secret key (only returned once)
   */
  async createApiKey(projectId: string, input: CreateApiKeyRequest, context: RequestContext): Promise<ApiKeyResponse> {
    this.requirePermission(context, PERMISSIONS.API_KEY_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ projectId, name: input.name, operatorId: context.operatorId }, 'Creating API key');

    try {
      const id = generateId(ID_PREFIXES.API_KEY);
      const key = this.generateApiKey();

      const apiKey = await db.insert(apiKeys).values({ id, projectId, name: input.name, key, isActive: true, metadata: input.metadata, version: 1 }).returning();

      const createdApiKey = apiKey[0];

      const { key: _key, ...safeCreatedApiKey } = createdApiKey;
      await this.auditService.logCreate('api_key', createdApiKey.id, safeCreatedApiKey, context.operatorId);

      logger.info({ apiKeyId: createdApiKey.id, projectId }, 'API key created successfully');

      return apiKeyResponseSchema.parse({ ...createdApiKey, key, keyPreview: this.getKeyPreview(key), lastUsedAt: createdApiKey.lastUsedAt?.toISOString() ?? null, createdAt: createdApiKey.createdAt.toISOString(), updatedAt: createdApiKey.updatedAt.toISOString() });
    } catch (error) {
      logger.error({ error, projectId, name: input.name }, 'Failed to create API key');
      throw error;
    }
  }

  /**
   * Retrieves an API key by its unique identifier
   * Note: Does not return the full secret key for security reasons
   * @param id - The unique identifier of the API key
   * @returns The API key if found
   * @throws {NotFoundError} When API key is not found
   */
  async getApiKeyById(projectId: string, id: string): Promise<ApiKeyResponse> {
    logger.debug({ apiKeyId: id }, 'Fetching API key by ID');

    try {
      const apiKey = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.projectId, projectId), eq(apiKeys.id, id)) });

      if (!apiKey) {
        throw new NotFoundError(`API key with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return apiKeyResponseSchema.parse({ ...apiKey, keyPreview: this.getKeyPreview(apiKey.key), lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null, createdAt: apiKey.createdAt.toISOString(), updatedAt: apiKey.updatedAt.toISOString(), archived });
    } catch (error) {
      logger.error({ error, apiKeyId: id }, 'Failed to fetch API key');
      throw error;
    }
  }

  /**
   * Retrieves an API key by its secret key value
   * Used for authentication purposes
   * @param key - The secret API key string
   * @returns The API key if found and active
   * @throws {NotFoundError} When API key is not found or inactive
   */
  async getApiKeyByKey(key: string): Promise<ApiKeyResponse> {
    logger.debug('Fetching API key by key value');

    try {
      const apiKey = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.key, key), eq(apiKeys.isActive, true)) });

      if (!apiKey) {
        throw new NotFoundError('Invalid or inactive API key');
      }

      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, apiKey.id));

      return apiKeyResponseSchema.parse({ ...apiKey, keyPreview: this.getKeyPreview(apiKey.key), lastUsedAt: new Date().toISOString(), createdAt: apiKey.createdAt.toISOString(), updatedAt: apiKey.updatedAt.toISOString() });
    } catch (error) {
      logger.error({ error }, 'Failed to fetch API key by key');
      throw error;
    }
  }

  /**
   * Lists API keys with flexible filtering, sorting, and pagination
   * @param projectId - Optional project ID to filter by. If not provided, returns API keys from all projects
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of API keys matching the criteria
   */
  async listApiKeys(projectId?: string, params?: ListParams): Promise<ApiKeyListResponse> {
    logger.debug({ projectId, params }, 'Listing API keys');

    try {
      const offset = params?.offset || 0;
      const limit = normalizeListLimit(params?.limit);

      const conditions: SQL[] = [];
      if (projectId) {
        conditions.push(eq(apiKeys.projectId, projectId));
      }
      const columnMap = { id: apiKeys.id, projectId: apiKeys.projectId, name: apiKeys.name, isActive: apiKeys.isActive, createdAt: apiKeys.createdAt, updatedAt: apiKeys.updatedAt };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const parsed = parseTextSearch(params.textSearch);
        if (parsed.type === 'text') {
          const searchTerm = `%${parsed.value}%`;
          const projectSubQuery = db.select({ id: projects.id }).from(projects).where(ilike(projects.name, searchTerm));
          conditions.push(or(ilike(apiKeys.name, searchTerm), inArray(apiKeys.projectId, projectSubQuery))!);
        }
        // API keys have no tags column, so tag searches are ignored
      }

      const orderBy = buildOrderBy(params?.orderBy, columnMap) ?? desc(apiKeys.createdAt);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;
      const apiKeyList = await db.query.apiKeys.findMany({ where: whereCondition, orderBy, offset, limit });
      const total = await countRows(apiKeys, whereCondition);

      // Determine archived status per api key by examining its project's archivedAt field
      const projectIds = Array.from(new Set(apiKeyList.map(k => k.projectId)));
      let archivedSet = new Set<string>();
      if (projectIds.length > 0) {
        const archivedRows = await db.select({ id: projects.id }).from(projects).where(and(inArray(projects.id, projectIds), isNotNull(projects.archivedAt)));
        archivedSet = new Set(archivedRows.map(r => r.id));
      }

      const responseItems = apiKeyList.map(item => ({
        ...item,
        keyPreview: this.getKeyPreview(item.key),
        lastUsedAt: item.lastUsedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        archived: archivedSet.has(item.projectId),
      }));

      logger.debug({ count: apiKeyList.length, total }, 'API keys listed successfully');

      return apiKeyListResponseSchema.parse({ items: responseItems, total });
    } catch (error) {
      logger.error({ error, projectId, params }, 'Failed to list API keys');
      throw error;
    }
  }

  /**
   * Updates an existing API key with optimistic locking support
   * @param id - The unique identifier of the API key to update
   * @param input - Updated API key data
   * @param context - Request context for auditing and authorization
   * @returns The updated API key
   * @throws {NotFoundError} When API key is not found
   * @throws {OptimisticLockError} When version mismatch occurs
   */
  async updateApiKey(projectId: string, id: string, input: UpdateApiKeyRequest, context: RequestContext): Promise<ApiKeyResponse> {
    this.requirePermission(context, PERMISSIONS.API_KEY_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ apiKeyId: id, operatorId: context.operatorId }, 'Updating API key');

    try {
      const existingApiKey = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.projectId, projectId), eq(apiKeys.id, id)) });

      if (!existingApiKey) {
        throw new NotFoundError(`API key with id ${id} not found`);
      }

      if (existingApiKey.version !== input.version) {
        throw new OptimisticLockError(`API key version mismatch. Expected ${input.version}, got ${existingApiKey.version}`);
      }

      const updatedApiKey = await db.update(apiKeys).set({ name: input.name ?? existingApiKey.name, isActive: input.isActive ?? existingApiKey.isActive, metadata: input.metadata ?? existingApiKey.metadata, version: existingApiKey.version + 1, updatedAt: new Date() }).where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.id, id))).returning();

      const updated = updatedApiKey[0];

      const { key: _oldKey, ...safeExistingApiKey } = existingApiKey;
      const { key: _newKey, ...safeUpdated } = updated;
      await this.auditService.logUpdate('api_key', updated.id, safeExistingApiKey, safeUpdated, context.operatorId);

      logger.info({ apiKeyId: updated.id }, 'API key updated successfully');

      return apiKeyResponseSchema.parse({ ...updated, keyPreview: this.getKeyPreview(updated.key), lastUsedAt: updated.lastUsedAt?.toISOString() ?? null, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
    } catch (error) {
      logger.error({ error, apiKeyId: id }, 'Failed to update API key');
      throw error;
    }
  }

  /**
   * Deletes an API key with optimistic locking support
   * @param id - The unique identifier of the API key to delete
   * @param version - The current version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When API key is not found
   * @throws {OptimisticLockError} When version mismatch occurs
   */
  async deleteApiKey(projectId: string, id: string, version: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.API_KEY_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ apiKeyId: id, operatorId: context.operatorId }, 'Deleting API key');

    try {
      const existingApiKey = await db.query.apiKeys.findFirst({ where: and(eq(apiKeys.projectId, projectId), eq(apiKeys.id, id)) });

      if (!existingApiKey) {
        throw new NotFoundError(`API key with id ${id} not found`);
      }

      if (existingApiKey.version !== version) {
        throw new OptimisticLockError(`API key version mismatch. Expected ${version}, got ${existingApiKey.version}`);
      }

      await db.delete(apiKeys).where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.id, id)));

      const { key: _key, ...safeExistingApiKey } = existingApiKey;
      await this.auditService.logDelete('api_key', id, safeExistingApiKey, context.operatorId);

      logger.info({ apiKeyId: id }, 'API key deleted successfully');
    } catch (error) {
      logger.error({ error, apiKeyId: id }, 'Failed to delete API key');
      throw error;
    }
  }
}
