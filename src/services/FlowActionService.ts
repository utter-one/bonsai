import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { flowActions } from '../db/schema';
import type { CreateFlowActionRequest, UpdateFlowActionRequest, FlowActionResponse, FlowActionListResponse, CloneFlowActionRequest } from '../http/contracts/flowAction';
import type { ListParams } from '../http/contracts/common';
import { flowActionResponseSchema, flowActionListResponseSchema } from '../http/contracts/flowAction';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing flow actions with full CRUD operations and audit logging
 * Flow actions are actions scoped to a specific flow, mirroring the global action structure
 */
@injectable()
export class FlowActionService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new flow action and logs the creation in the audit trail
   * @param projectId - ID of the project
   * @param flowId - ID of the flow to create the action in
   * @param input - Flow action creation data including id, name, trigger settings, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created flow action
   */
  async createFlowAction(projectId: string, flowId: string, input: CreateFlowActionRequest, context: RequestContext): Promise<FlowActionResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    const actionId = input.id ?? generateId(ID_PREFIXES.FLOW_ACTION);
    logger.info({ actionId, projectId, flowId, name: input.name, adminId: context?.adminId }, 'Creating flow action');

    try {
      const action = await db.insert(flowActions).values({ id: actionId, projectId, flowId, name: input.name, condition: input.condition ?? null, triggerOnUserInput: input.triggerOnUserInput ?? true, triggerOnClientCommand: input.triggerOnClientCommand ?? false, classificationTrigger: input.classificationTrigger ?? null, overrideClassifierId: input.overrideClassifierId ?? null, parameters: input.parameters ?? [], effects: input.effects ?? [], examples: input.examples ?? null, metadata: input.metadata ?? null, version: 1 }).returning();

      const createdAction = action[0];

      await this.auditService.logCreate('flow_action', createdAction.id, { id: createdAction.id, projectId: createdAction.projectId, flowId: createdAction.flowId, name: createdAction.name, condition: createdAction.condition, triggerOnUserInput: createdAction.triggerOnUserInput, triggerOnClientCommand: createdAction.triggerOnClientCommand, classificationTrigger: createdAction.classificationTrigger, overrideClassifierId: createdAction.overrideClassifierId, parameters: createdAction.parameters, effects: createdAction.effects, examples: createdAction.examples, metadata: createdAction.metadata }, context?.adminId);

      logger.info({ actionId: createdAction.id }, 'Flow action created successfully');

      return flowActionResponseSchema.parse(createdAction);
    } catch (error) {
      logger.error({ error, actionId: input.id }, 'Failed to create flow action');
      throw error;
    }
  }

  /**
   * Retrieves a flow action by its unique identifier
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow action
   * @returns The flow action if found
   * @throws {NotFoundError} When flow action is not found
   */
  async getFlowActionById(projectId: string, flowId: string, id: string): Promise<FlowActionResponse> {
    logger.debug({ actionId: id }, 'Fetching flow action by ID');

    try {
      const action = await db.query.flowActions.findFirst({ where: and(eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId), eq(flowActions.id, id)) });

      if (!action) {
        throw new NotFoundError(`Flow action with id ${id} not found`);
      }

      return flowActionResponseSchema.parse(action);
    } catch (error) {
      logger.error({ error, actionId: id }, 'Failed to fetch flow action');
      throw error;
    }
  }

  /**
   * Lists flow actions with flexible filtering, sorting, and pagination
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of flow actions matching the criteria
   */
  async listFlowActions(projectId: string, flowId: string, params?: ListParams): Promise<FlowActionListResponse> {
    logger.debug({ params }, 'Listing flow actions');

    try {
      const conditions: SQL[] = [eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: flowActions.id,
        projectId: flowActions.projectId,
        flowId: flowActions.flowId,
        name: flowActions.name,
        version: flowActions.version,
        createdAt: flowActions.createdAt,
        updatedAt: flowActions.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(flowActions.name, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      const totalResult = await db.query.flowActions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      const actionList = await db.query.flowActions.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(flowActions.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return flowActionListResponseSchema.parse({
        items: actionList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list flow actions');
      throw error;
    }
  }

  /**
   * Updates a flow action using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow action to update
   * @param input - Flow action update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated flow action
   * @throws {NotFoundError} When flow action is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateFlowAction(projectId: string, flowId: string, id: string, input: UpdateFlowActionRequest, context: RequestContext): Promise<FlowActionResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ actionId: id, expectedVersion, adminId: context?.adminId }, 'Updating flow action');

    try {
      const existingAction = await db.query.flowActions.findFirst({ where: and(eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId), eq(flowActions.id, id)) });

      if (!existingAction) {
        throw new NotFoundError(`Flow action with id ${id} not found`);
      }

      if (existingAction.version !== expectedVersion) {
        throw new OptimisticLockError(`Flow action version mismatch. Expected ${expectedVersion}, got ${existingAction.version}`);
      }

      const updatePayload: any = { version: existingAction.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.condition !== undefined) updatePayload.condition = updateData.condition;
      if (updateData.triggerOnUserInput !== undefined) updatePayload.triggerOnUserInput = updateData.triggerOnUserInput;
      if (updateData.triggerOnClientCommand !== undefined) updatePayload.triggerOnClientCommand = updateData.triggerOnClientCommand;
      if (updateData.classificationTrigger !== undefined) updatePayload.classificationTrigger = updateData.classificationTrigger;
      if (updateData.overrideClassifierId !== undefined) updatePayload.overrideClassifierId = updateData.overrideClassifierId;
      if (updateData.parameters !== undefined) updatePayload.parameters = updateData.parameters;
      if (updateData.effects !== undefined) updatePayload.effects = updateData.effects;
      if (updateData.examples !== undefined) updatePayload.examples = updateData.examples;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedAction = await db.update(flowActions).set(updatePayload).where(and(eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId), eq(flowActions.id, id), eq(flowActions.version, expectedVersion))).returning();

      if (updatedAction.length === 0) {
        throw new OptimisticLockError(`Failed to update flow action due to version conflict`);
      }

      const action = updatedAction[0];

      await this.auditService.logUpdate('flow_action', action.id, { id: existingAction.id, name: existingAction.name, condition: existingAction.condition, triggerOnUserInput: existingAction.triggerOnUserInput, triggerOnClientCommand: existingAction.triggerOnClientCommand, classificationTrigger: existingAction.classificationTrigger, overrideClassifierId: existingAction.overrideClassifierId, parameters: existingAction.parameters, effects: existingAction.effects, examples: existingAction.examples, metadata: existingAction.metadata }, { id: action.id, name: action.name, condition: action.condition, triggerOnUserInput: action.triggerOnUserInput, triggerOnClientCommand: action.triggerOnClientCommand, classificationTrigger: action.classificationTrigger, overrideClassifierId: action.overrideClassifierId, parameters: action.parameters, effects: action.effects, examples: action.examples, metadata: action.metadata }, context?.adminId);

      logger.info({ actionId: action.id, newVersion: action.version }, 'Flow action updated successfully');

      return flowActionResponseSchema.parse(action);
    } catch (error) {
      logger.error({ error, actionId: id }, 'Failed to update flow action');
      throw error;
    }
  }

  /**
   * Deletes a flow action using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow action to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When flow action is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteFlowAction(projectId: string, flowId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.FLOW_DELETE);
    logger.info({ actionId: id, expectedVersion, adminId: context?.adminId }, 'Deleting flow action');

    try {
      const existingAction = await db.query.flowActions.findFirst({ where: and(eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId), eq(flowActions.id, id)) });

      if (!existingAction) {
        throw new NotFoundError(`Flow action with id ${id} not found`);
      }

      if (existingAction.version !== expectedVersion) {
        throw new OptimisticLockError(`Flow action version mismatch. Expected ${expectedVersion}, got ${existingAction.version}`);
      }

      const deleted = await db.delete(flowActions).where(and(eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId), eq(flowActions.id, id), eq(flowActions.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete flow action due to version conflict`);
      }

      await this.auditService.logDelete('flow_action', id, { id: existingAction.id, name: existingAction.name, condition: existingAction.condition, triggerOnUserInput: existingAction.triggerOnUserInput, triggerOnClientCommand: existingAction.triggerOnClientCommand, classificationTrigger: existingAction.classificationTrigger, overrideClassifierId: existingAction.overrideClassifierId, parameters: existingAction.parameters, effects: existingAction.effects, examples: existingAction.examples, metadata: existingAction.metadata }, context?.adminId);

      logger.info({ actionId: id }, 'Flow action deleted successfully');
    } catch (error) {
      logger.error({ error, actionId: id }, 'Failed to delete flow action');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing flow action with a new ID and optional name override
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow action to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned flow action
   * @throws {NotFoundError} When the source flow action is not found
   */
  async cloneFlowAction(projectId: string, flowId: string, id: string, input: CloneFlowActionRequest, context: RequestContext): Promise<FlowActionResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning flow action');

    try {
      const existingAction = await db.query.flowActions.findFirst({ where: and(eq(flowActions.projectId, projectId), eq(flowActions.flowId, flowId), eq(flowActions.id, id)) });

      if (!existingAction) {
        throw new NotFoundError(`Flow action with id ${id} not found`);
      }

      return await this.createFlowAction(projectId, flowId, { id: input.id, name: input.name ?? `${existingAction.name} (Clone)`, condition: existingAction.condition, triggerOnUserInput: existingAction.triggerOnUserInput, triggerOnClientCommand: existingAction.triggerOnClientCommand, classificationTrigger: existingAction.classificationTrigger, overrideClassifierId: existingAction.overrideClassifierId, parameters: existingAction.parameters as any, effects: existingAction.effects as any, examples: existingAction.examples as string[] ?? undefined, metadata: existingAction.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone flow action');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific flow action
   * @param actionId - The unique identifier of the flow action
   * @returns Array of audit log entries for the flow action
   */
  async getFlowActionAuditLogs(actionId: string): Promise<any[]> {
    logger.debug({ actionId }, 'Fetching audit logs for flow action');

    try {
      return await this.auditService.getEntityAuditLogs('flow_action', actionId);
    } catch (error) {
      logger.error({ error, actionId }, 'Failed to fetch flow action audit logs');
      throw error;
    }
  }
}
