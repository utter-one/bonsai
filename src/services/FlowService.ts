import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { flows } from '../db/schema';
import type { CreateFlowRequest, UpdateFlowRequest, FlowResponse, FlowListResponse, CloneFlowRequest } from '../http/contracts/flow';
import type { ListParams } from '../http/contracts/common';
import { flowResponseSchema, flowListResponseSchema } from '../http/contracts/flow';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing flows with full CRUD operations and audit logging
 * Flows are project-scoped entities that group their own actions and tools
 */
@injectable()
export class FlowService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new flow and logs the creation in the audit trail
   * @param projectId - ID of the project to create the flow in
   * @param input - Flow creation data including id, name, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created flow
   */
  async createFlow(projectId: string, input: CreateFlowRequest, context: RequestContext): Promise<FlowResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    const flowId = input.id ?? generateId(ID_PREFIXES.FLOW);
    logger.info({ flowId, projectId, name: input.name, adminId: context?.adminId }, 'Creating flow');

    try {
      const flow = await db.insert(flows).values({ id: flowId, projectId, name: input.name, description: input.description ?? null, metadata: input.metadata ?? null, version: 1 }).returning();

      const createdFlow = flow[0];

      await this.auditService.logCreate('flow', createdFlow.id, { id: createdFlow.id, projectId: createdFlow.projectId, name: createdFlow.name, description: createdFlow.description, metadata: createdFlow.metadata }, context?.adminId);

      logger.info({ flowId: createdFlow.id }, 'Flow created successfully');

      return flowResponseSchema.parse(createdFlow);
    } catch (error) {
      logger.error({ error, flowId: input.id }, 'Failed to create flow');
      throw error;
    }
  }

  /**
   * Retrieves a flow by its unique identifier
   * @param projectId - ID of the project the flow belongs to
   * @param id - The unique identifier of the flow
   * @returns The flow if found
   * @throws {NotFoundError} When flow is not found
   */
  async getFlowById(projectId: string, id: string): Promise<FlowResponse> {
    logger.debug({ flowId: id }, 'Fetching flow by ID');

    try {
      const flow = await db.query.flows.findFirst({ where: and(eq(flows.projectId, projectId), eq(flows.id, id)) });

      if (!flow) {
        throw new NotFoundError(`Flow with id ${id} not found`);
      }

      return flowResponseSchema.parse(flow);
    } catch (error) {
      logger.error({ error, flowId: id }, 'Failed to fetch flow');
      throw error;
    }
  }

  /**
   * Lists flows with flexible filtering, sorting, and pagination
   * @param projectId - ID of the project to list flows for
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of flows matching the criteria
   */
  async listFlows(projectId: string, params?: ListParams): Promise<FlowListResponse> {
    logger.debug({ params }, 'Listing flows');

    try {
      const conditions: SQL[] = [eq(flows.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: flows.id,
        projectId: flows.projectId,
        name: flows.name,
        version: flows.version,
        createdAt: flows.createdAt,
        updatedAt: flows.updatedAt,
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
        conditions.push(like(flows.name, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      const totalResult = await db.query.flows.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      const flowList = await db.query.flows.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(flows.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return flowListResponseSchema.parse({
        items: flowList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list flows');
      throw error;
    }
  }

  /**
   * Updates a flow using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project the flow belongs to
   * @param id - The unique identifier of the flow to update
   * @param input - Flow update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated flow
   * @throws {NotFoundError} When flow is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateFlow(projectId: string, id: string, input: UpdateFlowRequest, context: RequestContext): Promise<FlowResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ flowId: id, expectedVersion, adminId: context?.adminId }, 'Updating flow');

    try {
      const existingFlow = await db.query.flows.findFirst({ where: and(eq(flows.projectId, projectId), eq(flows.id, id)) });

      if (!existingFlow) {
        throw new NotFoundError(`Flow with id ${id} not found`);
      }

      if (existingFlow.version !== expectedVersion) {
        throw new OptimisticLockError(`Flow version mismatch. Expected ${expectedVersion}, got ${existingFlow.version}`);
      }

      const updatePayload: any = { version: existingFlow.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedFlow = await db.update(flows).set(updatePayload).where(and(eq(flows.projectId, projectId), eq(flows.id, id), eq(flows.version, expectedVersion))).returning();

      if (updatedFlow.length === 0) {
        throw new OptimisticLockError(`Failed to update flow due to version conflict`);
      }

      const flow = updatedFlow[0];

      await this.auditService.logUpdate('flow', flow.id, { id: existingFlow.id, name: existingFlow.name, description: existingFlow.description, metadata: existingFlow.metadata }, { id: flow.id, name: flow.name, description: flow.description, metadata: flow.metadata }, context?.adminId);

      logger.info({ flowId: flow.id, newVersion: flow.version }, 'Flow updated successfully');

      return flowResponseSchema.parse(flow);
    } catch (error) {
      logger.error({ error, flowId: id }, 'Failed to update flow');
      throw error;
    }
  }

  /**
   * Deletes a flow using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project the flow belongs to
   * @param id - The unique identifier of the flow to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When flow is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteFlow(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.FLOW_DELETE);
    logger.info({ flowId: id, expectedVersion, adminId: context?.adminId }, 'Deleting flow');

    try {
      const existingFlow = await db.query.flows.findFirst({ where: and(eq(flows.projectId, projectId), eq(flows.id, id)) });

      if (!existingFlow) {
        throw new NotFoundError(`Flow with id ${id} not found`);
      }

      if (existingFlow.version !== expectedVersion) {
        throw new OptimisticLockError(`Flow version mismatch. Expected ${expectedVersion}, got ${existingFlow.version}`);
      }

      const deleted = await db.delete(flows).where(and(eq(flows.projectId, projectId), eq(flows.id, id), eq(flows.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete flow due to version conflict`);
      }

      await this.auditService.logDelete('flow', id, { id: existingFlow.id, name: existingFlow.name, description: existingFlow.description, metadata: existingFlow.metadata }, context?.adminId);

      logger.info({ flowId: id }, 'Flow deleted successfully');
    } catch (error) {
      logger.error({ error, flowId: id }, 'Failed to delete flow');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing flow with a new ID and optional name override
   * @param projectId - ID of the project the flow belongs to
   * @param id - The unique identifier of the flow to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned flow
   * @throws {NotFoundError} When the source flow is not found
   */
  async cloneFlow(projectId: string, id: string, input: CloneFlowRequest, context: RequestContext): Promise<FlowResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning flow');

    try {
      const existingFlow = await db.query.flows.findFirst({ where: and(eq(flows.projectId, projectId), eq(flows.id, id)) });

      if (!existingFlow) {
        throw new NotFoundError(`Flow with id ${id} not found`);
      }

      return await this.createFlow(projectId, { id: input.id, name: input.name ?? `${existingFlow.name} (Clone)`, description: existingFlow.description ?? undefined, metadata: existingFlow.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone flow');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific flow
   * @param flowId - The unique identifier of the flow
   * @returns Array of audit log entries for the flow
   */
  async getFlowAuditLogs(flowId: string): Promise<any[]> {
    logger.debug({ flowId }, 'Fetching audit logs for flow');

    try {
      return await this.auditService.getEntityAuditLogs('flow', flowId);
    } catch (error) {
      logger.error({ error, flowId }, 'Failed to fetch flow audit logs');
      throw error;
    }
  }
}
