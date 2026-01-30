import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { globalActions } from '../db/schema';
import type { CreateGlobalActionRequest, UpdateGlobalActionRequest, GlobalActionResponse, GlobalActionListResponse } from '../http/contracts/globalAction';
import type { ListParams } from '../http/contracts/common';
import { globalActionResponseSchema, globalActionListResponseSchema } from '../http/contracts/globalAction';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing global actions with full CRUD operations and audit logging
 * Global actions are user actions that can be triggered at any point during a conversation
 */
@injectable()
export class GlobalActionService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new global action and logs the creation in the audit trail
   * @param input - Global action creation data including id, name, trigger settings, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created global action
   */
  async createGlobalAction(input: CreateGlobalActionRequest, context: RequestContext): Promise<GlobalActionResponse> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_WRITE);
    const globalActionId = input.id ?? generateId(ID_PREFIXES.GLOBAL_ACTION);
    logger.info({ globalActionId, projectId: input.projectId, name: input.name, adminId: context?.adminId }, 'Creating global action');

    try {
      const globalAction = await db.insert(globalActions).values({ id: globalActionId, projectId: input.projectId, name: input.name, condition: input.condition ?? null, triggerOnUserInput: input.triggerOnUserInput ?? true, triggerOnClientCommand: input.triggerOnClientCommand ?? false, classificationTrigger: input.classificationTrigger ?? null, overrideClassifierId: input.overrideClassifierId ?? null, operations: input.operations ?? [], template: input.template ?? null, examples: input.examples ?? null, metadata: input.metadata ?? null, version: 1 }).returning();

      const createdGlobalAction = globalAction[0];

      await this.auditService.logCreate('global_action', createdGlobalAction.id, { id: createdGlobalAction.id, projectId: createdGlobalAction.projectId, name: createdGlobalAction.name, condition: createdGlobalAction.condition, triggerOnUserInput: createdGlobalAction.triggerOnUserInput, triggerOnClientCommand: createdGlobalAction.triggerOnClientCommand, classificationTrigger: createdGlobalAction.classificationTrigger, overrideClassifierId: createdGlobalAction.overrideClassifierId, operations: createdGlobalAction.operations, template: createdGlobalAction.template, examples: createdGlobalAction.examples, metadata: createdGlobalAction.metadata }, context?.adminId);

      logger.info({ globalActionId: createdGlobalAction.id }, 'Global action created successfully');

      return globalActionResponseSchema.parse(createdGlobalAction);
    } catch (error) {
      logger.error({ error, globalActionId: input.id }, 'Failed to create global action');
      throw error;
    }
  }

  /**
   * Retrieves a global action by its unique identifier
   * @param id - The unique identifier of the global action
   * @returns The global action if found
   * @throws {NotFoundError} When global action is not found
   */
  async getGlobalActionById(id: string): Promise<GlobalActionResponse> {
    logger.debug({ globalActionId: id }, 'Fetching global action by ID');

    try {
      const globalAction = await db.query.globalActions.findFirst({ where: eq(globalActions.id, id) });

      if (!globalAction) {
        throw new NotFoundError(`Global action with id ${id} not found`);
      }

      return globalActionResponseSchema.parse(globalAction);
    } catch (error) {
      logger.error({ error, globalActionId: id }, 'Failed to fetch global action');
      throw error;
    }
  }

  /**
   * Lists global actions with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of global actions matching the criteria
   */
  async listGlobalActions(params?: ListParams): Promise<GlobalActionListResponse> {
    logger.debug({ params }, 'Listing global actions');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: globalActions.id,
        name: globalActions.name,
        version: globalActions.version,
        createdAt: globalActions.createdAt,
        updatedAt: globalActions.updatedAt,
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

      // Apply text search (searches name only)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(globalActions.name, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.globalActions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const globalActionList = await db.query.globalActions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(globalActions.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return globalActionListResponseSchema.parse({
        items: globalActionList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list global actions');
      throw error;
    }
  }

  /**
   * Updates a global action using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the global action to update
   * @param input - Global action update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated global action
   * @throws {NotFoundError} When global action is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateGlobalAction(id: string, input: UpdateGlobalActionRequest, context: RequestContext): Promise<GlobalActionResponse> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ globalActionId: id, expectedVersion, adminId: context?.adminId }, 'Updating global action');

    try {
      const existingGlobalAction = await db.query.globalActions.findFirst({ where: eq(globalActions.id, id) });

      if (!existingGlobalAction) {
        throw new NotFoundError(`Global action with id ${id} not found`);
      }

      if (existingGlobalAction.version !== expectedVersion) {
        throw new OptimisticLockError(`Global action version mismatch. Expected ${expectedVersion}, got ${existingGlobalAction.version}`);
      }

      const updatePayload: any = { version: existingGlobalAction.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.condition !== undefined) updatePayload.condition = updateData.condition;
      if (updateData.triggerOnUserInput !== undefined) updatePayload.triggerOnUserInput = updateData.triggerOnUserInput;
      if (updateData.triggerOnClientCommand !== undefined) updatePayload.triggerOnClientCommand = updateData.triggerOnClientCommand;
      if (updateData.classificationTrigger !== undefined) updatePayload.classificationTrigger = updateData.classificationTrigger;
      if (updateData.overrideClassifierId !== undefined) updatePayload.overrideClassifierId = updateData.overrideClassifierId;
      if (updateData.operations !== undefined) updatePayload.operations = updateData.operations;
      if (updateData.template !== undefined) updatePayload.template = updateData.template;
      if (updateData.examples !== undefined) updatePayload.examples = updateData.examples;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedGlobalAction = await db.update(globalActions).set(updatePayload).where(and(eq(globalActions.id, id), eq(globalActions.version, expectedVersion))).returning();

      if (updatedGlobalAction.length === 0) {
        throw new OptimisticLockError(`Failed to update global action due to version conflict`);
      }

      const globalAction = updatedGlobalAction[0];

      await this.auditService.logUpdate('global_action', globalAction.id, { id: existingGlobalAction.id, name: existingGlobalAction.name, condition: existingGlobalAction.condition, triggerOnUserInput: existingGlobalAction.triggerOnUserInput, triggerOnClientCommand: existingGlobalAction.triggerOnClientCommand, classificationTrigger: existingGlobalAction.classificationTrigger, overrideClassifierId: existingGlobalAction.overrideClassifierId, operations: existingGlobalAction.operations, template: existingGlobalAction.template, examples: existingGlobalAction.examples, metadata: existingGlobalAction.metadata }, { id: globalAction.id, name: globalAction.name, condition: globalAction.condition, triggerOnUserInput: globalAction.triggerOnUserInput, triggerOnClientCommand: globalAction.triggerOnClientCommand, classificationTrigger: globalAction.classificationTrigger, overrideClassifierId: globalAction.overrideClassifierId, operations: globalAction.operations, template: globalAction.template, examples: globalAction.examples, metadata: globalAction.metadata }, context?.adminId);

      logger.info({ globalActionId: globalAction.id, newVersion: globalAction.version }, 'Global action updated successfully');

      return globalActionResponseSchema.parse(globalAction);
    } catch (error) {
      logger.error({ error, globalActionId: id }, 'Failed to update global action');
      throw error;
    }
  }

  /**
   * Deletes a global action using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the global action to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When global action is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteGlobalAction(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_DELETE);
    logger.info({ globalActionId: id, expectedVersion, adminId: context?.adminId }, 'Deleting global action');

    try {
      const existingGlobalAction = await db.query.globalActions.findFirst({ where: eq(globalActions.id, id) });

      if (!existingGlobalAction) {
        throw new NotFoundError(`Global action with id ${id} not found`);
      }

      if (existingGlobalAction.version !== expectedVersion) {
        throw new OptimisticLockError(`Global action version mismatch. Expected ${expectedVersion}, got ${existingGlobalAction.version}`);
      }

      const deleted = await db.delete(globalActions).where(and(eq(globalActions.id, id), eq(globalActions.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete global action due to version conflict`);
      }

      await this.auditService.logDelete('global_action', id, { id: existingGlobalAction.id, name: existingGlobalAction.name, condition: existingGlobalAction.condition, triggerOnUserInput: existingGlobalAction.triggerOnUserInput, triggerOnClientCommand: existingGlobalAction.triggerOnClientCommand, classificationTrigger: existingGlobalAction.classificationTrigger, overrideClassifierId: existingGlobalAction.overrideClassifierId, operations: existingGlobalAction.operations, template: existingGlobalAction.template, examples: existingGlobalAction.examples, metadata: existingGlobalAction.metadata }, context?.adminId);

      logger.info({ globalActionId: id }, 'Global action deleted successfully');
    } catch (error) {
      logger.error({ error, globalActionId: id }, 'Failed to delete global action');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific global action
   * @param globalActionId - The unique identifier of the global action
   * @returns Array of audit log entries for the global action
   */
  async getGlobalActionAuditLogs(globalActionId: string): Promise<any[]> {
    logger.debug({ globalActionId }, 'Fetching audit logs for global action');

    try {
      return await this.auditService.getEntityAuditLogs('global_action', globalActionId);
    } catch (error) {
      logger.error({ error, globalActionId }, 'Failed to fetch global action audit logs');
      throw error;
    }
  }
}
