import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { contextTransformers } from '../db/schema';
import type { CreateContextTransformerRequest, UpdateContextTransformerRequest, ContextTransformerResponse, ContextTransformerListResponse, CloneContextTransformerRequest } from '../http/contracts/contextTransformer';
import type { ListParams } from '../http/contracts/common';
import { contextTransformerResponseSchema, contextTransformerListResponseSchema } from '../http/contracts/contextTransformer';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing context transformers with full CRUD operations and audit logging
 * Context transformers are used to transform and enrich conversation context using LLMs
 */
@injectable()
export class ContextTransformerService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new context transformer and logs the creation in the audit trail
   * @param input - Context transformer creation data including id, name, prompt, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created context transformer
   */
  async createContextTransformer(projectId: string, input: CreateContextTransformerRequest, context: RequestContext): Promise<ContextTransformerResponse> {
    this.requirePermission(context, PERMISSIONS.CONTEXT_TRANSFORMER_WRITE);
    const transformerId = input.id ?? generateId(ID_PREFIXES.CONTEXT_TRANSFORMER);
    logger.info({ transformerId, projectId, name: input.name, adminId: context?.adminId }, 'Creating context transformer');

    try {
      const transformer = await db.insert(contextTransformers).values({ id: transformerId, projectId, name: input.name, description: input.description ?? null, prompt: input.prompt, contextFields: input.contextFields ?? null, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdTransformer = transformer[0];

      await this.auditService.logCreate('context_transformer', createdTransformer.id, { id: createdTransformer.id, projectId: createdTransformer.projectId, name: createdTransformer.name, description: createdTransformer.description, prompt: createdTransformer.prompt, contextFields: createdTransformer.contextFields, llmProviderId: createdTransformer.llmProviderId, llmSettings: createdTransformer.llmSettings, tags: createdTransformer.tags, metadata: createdTransformer.metadata }, context?.adminId);

      logger.info({ transformerId: createdTransformer.id }, 'Context transformer created successfully');

      return contextTransformerResponseSchema.parse(createdTransformer);
    } catch (error) {
      logger.error({ error, transformerId: input.id }, 'Failed to create context transformer');
      throw error;
    }
  }

  /**
   * Retrieves a context transformer by its unique identifier
   * @param id - The unique identifier of the context transformer
   * @returns The context transformer if found
   * @throws {NotFoundError} When context transformer is not found
   */
  async getContextTransformerById(projectId: string, id: string): Promise<ContextTransformerResponse> {
    logger.debug({ transformerId: id }, 'Fetching context transformer by ID');

    try {
      const transformer = await db.query.contextTransformers.findFirst({ where: and(eq(contextTransformers.projectId, projectId), eq(contextTransformers.id, id)) });

      if (!transformer) {
        throw new NotFoundError(`Context transformer with id ${id} not found`);
      }

      return contextTransformerResponseSchema.parse(transformer);
    } catch (error) {
      logger.error({ error, transformerId: id }, 'Failed to fetch context transformer');
      throw error;
    }
  }

  /**
   * Lists context transformers with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of context transformers matching the criteria
   */
  async listContextTransformers(projectId: string, params?: ListParams): Promise<ContextTransformerListResponse> {
    logger.debug({ params }, 'Listing context transformers');

    try {
      const conditions: SQL[] = [eq(contextTransformers.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: contextTransformers.id,
        projectId: contextTransformers.projectId,
        name: contextTransformers.name,
        llmProviderId: contextTransformers.llmProviderId,
        version: contextTransformers.version,
        createdAt: contextTransformers.createdAt,
        updatedAt: contextTransformers.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${contextTransformers.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name and description)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(contextTransformers.name, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.contextTransformers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const transformerList = await db.query.contextTransformers.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(contextTransformers.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return contextTransformerListResponseSchema.parse({
        items: transformerList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list context transformers');
      throw error;
    }
  }

  /**
   * Updates a context transformer using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the context transformer to update
   * @param input - Context transformer update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated context transformer
   * @throws {NotFoundError} When context transformer is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateContextTransformer(projectId: string, id: string, input: UpdateContextTransformerRequest, context: RequestContext): Promise<ContextTransformerResponse> {
    this.requirePermission(context, PERMISSIONS.CONTEXT_TRANSFORMER_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ transformerId: id, expectedVersion, adminId: context?.adminId }, 'Updating context transformer');

    try {
      const existingTransformer = await db.query.contextTransformers.findFirst({ where: and(eq(contextTransformers.projectId, projectId), eq(contextTransformers.id, id)) });

      if (!existingTransformer) {
        throw new NotFoundError(`Context transformer with id ${id} not found`);
      }

      if (existingTransformer.version !== expectedVersion) {
        throw new OptimisticLockError(`Context transformer version mismatch. Expected ${expectedVersion}, got ${existingTransformer.version}`);
      }

      const updatePayload: any = { version: existingTransformer.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.prompt !== undefined) updatePayload.prompt = updateData.prompt;
      if (updateData.contextFields !== undefined) updatePayload.contextFields = updateData.contextFields;
      if (updateData.llmProviderId !== undefined) updatePayload.llmProviderId = updateData.llmProviderId;
      if (updateData.llmSettings !== undefined) updatePayload.llmSettings = updateData.llmSettings;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedTransformer = await db.update(contextTransformers).set(updatePayload).where(and(eq(contextTransformers.projectId, projectId), eq(contextTransformers.id, id), eq(contextTransformers.version, expectedVersion))).returning();

      if (updatedTransformer.length === 0) {
        throw new OptimisticLockError(`Failed to update context transformer due to version conflict`);
      }

      const transformer = updatedTransformer[0];

      await this.auditService.logUpdate('context_transformer', transformer.id, { id: existingTransformer.id, name: existingTransformer.name, description: existingTransformer.description, prompt: existingTransformer.prompt, contextFields: existingTransformer.contextFields, llmProviderId: existingTransformer.llmProviderId, llmSettings: existingTransformer.llmSettings, tags: existingTransformer.tags, metadata: existingTransformer.metadata }, { id: transformer.id, name: transformer.name, description: transformer.description, prompt: transformer.prompt, contextFields: transformer.contextFields, llmProviderId: transformer.llmProviderId, llmSettings: transformer.llmSettings, tags: transformer.tags, metadata: transformer.metadata }, context?.adminId, projectId);

      logger.info({ transformerId: transformer.id, newVersion: transformer.version }, 'Context transformer updated successfully');

      return contextTransformerResponseSchema.parse(transformer);
    } catch (error) {
      logger.error({ error, transformerId: id }, 'Failed to update context transformer');
      throw error;
    }
  }

  /**
   * Deletes a context transformer using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the context transformer to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When context transformer is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteContextTransformer(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.CONTEXT_TRANSFORMER_DELETE);
    logger.info({ transformerId: id, expectedVersion, adminId: context?.adminId }, 'Deleting context transformer');

    try {
      const existingTransformer = await db.query.contextTransformers.findFirst({ where: and(eq(contextTransformers.projectId, projectId), eq(contextTransformers.id, id)) });

      if (!existingTransformer) {
        throw new NotFoundError(`Context transformer with id ${id} not found`);
      }

      if (existingTransformer.version !== expectedVersion) {
        throw new OptimisticLockError(`Context transformer version mismatch. Expected ${expectedVersion}, got ${existingTransformer.version}`);
      }

      const deleted = await db.delete(contextTransformers).where(and(eq(contextTransformers.projectId, projectId), eq(contextTransformers.id, id), eq(contextTransformers.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete context transformer due to version conflict`);
      }

      await this.auditService.logDelete('context_transformer', id, { id: existingTransformer.id, name: existingTransformer.name, description: existingTransformer.description, prompt: existingTransformer.prompt, contextFields: existingTransformer.contextFields, llmProviderId: existingTransformer.llmProviderId, llmSettings: existingTransformer.llmSettings, tags: existingTransformer.tags, metadata: existingTransformer.metadata }, context?.adminId, projectId);

      logger.info({ transformerId: id }, 'Context transformer deleted successfully');
    } catch (error) {
      logger.error({ error, transformerId: id }, 'Failed to delete context transformer');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing context transformer with a new ID and optional name override
   * @param id - The unique identifier of the context transformer to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned context transformer
   * @throws {NotFoundError} When the source context transformer is not found
   */
  async cloneContextTransformer(projectId: string, id: string, input: CloneContextTransformerRequest, context: RequestContext): Promise<ContextTransformerResponse> {
    this.requirePermission(context, PERMISSIONS.CONTEXT_TRANSFORMER_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning context transformer');

    try {
      const existingTransformer = await db.query.contextTransformers.findFirst({ where: and(eq(contextTransformers.projectId, projectId), eq(contextTransformers.id, id)) });

      if (!existingTransformer) {
        throw new NotFoundError(`Context transformer with id ${id} not found`);
      }

      return await this.createContextTransformer(projectId, { id: input.id, name: input.name ?? `${existingTransformer.name} (Clone)`, description: existingTransformer.description ?? undefined, prompt: existingTransformer.prompt, contextFields: existingTransformer.contextFields as string[] ?? undefined, llmProviderId: existingTransformer.llmProviderId, llmSettings: existingTransformer.llmSettings as any, tags: existingTransformer.tags as string[], metadata: existingTransformer.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone context transformer');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific context transformer
   * @param transformerId - The unique identifier of the context transformer
   * @returns Array of audit log entries for the context transformer
   */
  async getContextTransformerAuditLogs(transformerId: string): Promise<any[]> {
    logger.debug({ transformerId }, 'Fetching audit logs for context transformer');

    try {
      return await this.auditService.getEntityAuditLogs('context_transformer', transformerId);
    } catch (error) {
      logger.error({ error, transformerId }, 'Failed to fetch context transformer audit logs');
      throw error;
    }
  }
}
