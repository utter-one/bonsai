import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc, sql } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { globalActions } from '../db/schema';
import type { CreateGlobalActionRequest, UpdateGlobalActionRequest, GlobalActionResponse, GlobalActionListResponse, CloneGlobalActionRequest } from '../http/contracts/globalAction';
import type { ListParams } from '../http/contracts/common';
import { globalActionResponseSchema, globalActionListResponseSchema } from '../http/contracts/globalAction';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
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
  async createGlobalAction(projectId: string, input: CreateGlobalActionRequest, context: RequestContext): Promise<GlobalActionResponse> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_WRITE);
    await this.requireProjectNotArchived(projectId);
    const globalActionId = input.id ?? generateId(ID_PREFIXES.GLOBAL_ACTION);
    logger.info({ globalActionId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating global action');

    try {
      const globalAction = await db.insert(globalActions).values({ id: globalActionId, projectId, name: input.name, condition: input.condition ?? null, triggerOnUserInput: input.triggerOnUserInput ?? true, triggerOnClientCommand: input.triggerOnClientCommand ?? false, classificationTrigger: input.classificationTrigger ?? null, overrideClassifierId: input.overrideClassifierId ?? null, parameters: input.parameters ?? [], effects: input.effects ?? [], examples: input.examples ?? null, tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdGlobalAction = globalAction[0];

      await this.auditService.logCreate('global_action', createdGlobalAction.id, { id: createdGlobalAction.id, projectId: createdGlobalAction.projectId, name: createdGlobalAction.name, condition: createdGlobalAction.condition, triggerOnUserInput: createdGlobalAction.triggerOnUserInput, triggerOnClientCommand: createdGlobalAction.triggerOnClientCommand, classificationTrigger: createdGlobalAction.classificationTrigger, overrideClassifierId: createdGlobalAction.overrideClassifierId, parameters: createdGlobalAction.parameters, effects: createdGlobalAction.effects, examples: createdGlobalAction.examples, tags: createdGlobalAction.tags, metadata: createdGlobalAction.metadata }, context?.operatorId);

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
  async getGlobalActionById(projectId: string, id: string): Promise<GlobalActionResponse> {
    logger.debug({ globalActionId: id }, 'Fetching global action by ID');

    try {
      const globalAction = await db.query.globalActions.findFirst({ where: and(eq(globalActions.projectId, projectId), eq(globalActions.id, id)) });

      if (!globalAction) {
        throw new NotFoundError(`Global action with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return globalActionResponseSchema.parse({ ...globalAction, archived });
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
  async listGlobalActions(projectId: string, params?: ListParams): Promise<GlobalActionListResponse> {
    logger.debug({ params }, 'Listing global actions');

    try {
      const conditions: SQL[] = [eq(globalActions.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: globalActions.id,
        projectId: globalActions.projectId,
        name: globalActions.name,
        version: globalActions.version,
        createdAt: globalActions.createdAt,
        updatedAt: globalActions.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${globalActions.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name, classificationTrigger, condition by ilike, or tags JSONB for "tag:" prefix)
      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [globalActions.name, globalActions.classificationTrigger, globalActions.condition], globalActions.tags);
        if (searchCondition) conditions.push(searchCondition);
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(globalActions, whereCondition);

      // Get paginated results
      const globalActionList = await db.query.globalActions.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(globalActions.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return globalActionListResponseSchema.parse({
        items: globalActionList.map(a => ({ ...a, archived })),
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
  async updateGlobalAction(projectId: string, id: string, input: UpdateGlobalActionRequest, context: RequestContext): Promise<GlobalActionResponse> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ globalActionId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating global action');

    try {
      const existingGlobalAction = await db.query.globalActions.findFirst({ where: and(eq(globalActions.projectId, projectId), eq(globalActions.id, id)) });

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
      if (updateData.parameters !== undefined) updatePayload.parameters = updateData.parameters;
      if (updateData.effects !== undefined) updatePayload.effects = updateData.effects;
      if (updateData.examples !== undefined) updatePayload.examples = updateData.examples;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedGlobalAction = await db.update(globalActions).set(updatePayload).where(and(eq(globalActions.projectId, projectId), eq(globalActions.id, id), eq(globalActions.version, expectedVersion))).returning();

      if (updatedGlobalAction.length === 0) {
        throw new OptimisticLockError(`Failed to update global action due to version conflict`);
      }

      const globalAction = updatedGlobalAction[0];

      await this.auditService.logUpdate('global_action', globalAction.id, { id: existingGlobalAction.id, name: existingGlobalAction.name, condition: existingGlobalAction.condition, triggerOnUserInput: existingGlobalAction.triggerOnUserInput, triggerOnClientCommand: existingGlobalAction.triggerOnClientCommand, classificationTrigger: existingGlobalAction.classificationTrigger, overrideClassifierId: existingGlobalAction.overrideClassifierId, parameters: existingGlobalAction.parameters, effects: existingGlobalAction.effects, examples: existingGlobalAction.examples, tags: existingGlobalAction.tags, metadata: existingGlobalAction.metadata }, { id: globalAction.id, name: globalAction.name, condition: globalAction.condition, triggerOnUserInput: globalAction.triggerOnUserInput, triggerOnClientCommand: globalAction.triggerOnClientCommand, classificationTrigger: globalAction.classificationTrigger, overrideClassifierId: globalAction.overrideClassifierId, parameters: globalAction.parameters, effects: globalAction.effects, examples: globalAction.examples, tags: globalAction.tags, metadata: globalAction.metadata }, context?.operatorId, projectId);

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
  async deleteGlobalAction(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ globalActionId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting global action');

    try {
      const existingGlobalAction = await db.query.globalActions.findFirst({ where: and(eq(globalActions.projectId, projectId), eq(globalActions.id, id)) });

      if (!existingGlobalAction) {
        throw new NotFoundError(`Global action with id ${id} not found`);
      }

      if (existingGlobalAction.version !== expectedVersion) {
        throw new OptimisticLockError(`Global action version mismatch. Expected ${expectedVersion}, got ${existingGlobalAction.version}`);
      }

      const deleted = await db.delete(globalActions).where(and(eq(globalActions.projectId, projectId), eq(globalActions.id, id), eq(globalActions.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete global action due to version conflict`);
      }

      await this.auditService.logDelete('global_action', id, { id: existingGlobalAction.id, name: existingGlobalAction.name, condition: existingGlobalAction.condition, triggerOnUserInput: existingGlobalAction.triggerOnUserInput, triggerOnClientCommand: existingGlobalAction.triggerOnClientCommand, classificationTrigger: existingGlobalAction.classificationTrigger, overrideClassifierId: existingGlobalAction.overrideClassifierId, parameters: existingGlobalAction.parameters, effects: existingGlobalAction.effects, examples: existingGlobalAction.examples, tags: existingGlobalAction.tags, metadata: existingGlobalAction.metadata }, context?.operatorId, projectId);

      logger.info({ globalActionId: id }, 'Global action deleted successfully');
    } catch (error) {
      logger.error({ error, globalActionId: id }, 'Failed to delete global action');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing global action with a new ID and optional name override
   * @param id - The unique identifier of the global action to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned global action
   * @throws {NotFoundError} When the source global action is not found
   */
  async cloneGlobalAction(projectId: string, id: string, input: CloneGlobalActionRequest, context: RequestContext): Promise<GlobalActionResponse> {
    this.requirePermission(context, PERMISSIONS.GLOBAL_ACTION_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ id, operatorId: context?.operatorId }, 'Cloning global action');

    try {
      const existingAction = await db.query.globalActions.findFirst({ where: and(eq(globalActions.projectId, projectId), eq(globalActions.id, id)) });

      if (!existingAction) {
        throw new NotFoundError(`Global action with id ${id} not found`);
      }

      return await this.createGlobalAction(projectId, { id: input.id, name: input.name ?? `${existingAction.name} (Clone)`, condition: existingAction.condition, triggerOnUserInput: existingAction.triggerOnUserInput, triggerOnClientCommand: existingAction.triggerOnClientCommand, classificationTrigger: existingAction.classificationTrigger, overrideClassifierId: existingAction.overrideClassifierId, parameters: existingAction.parameters as any, effects: existingAction.effects as any, examples: existingAction.examples as string[] ?? undefined, tags: existingAction.tags as string[], metadata: existingAction.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone global action');
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
