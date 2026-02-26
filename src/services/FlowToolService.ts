import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { flowTools } from '../db/schema';
import type { CreateFlowToolRequest, UpdateFlowToolRequest, FlowToolResponse, FlowToolListResponse, CloneFlowToolRequest } from '../http/contracts/flowTool';
import type { ListParams } from '../http/contracts/common';
import { flowToolResponseSchema, flowToolListResponseSchema } from '../http/contracts/flowTool';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing flow tools with full CRUD operations and audit logging
 * Flow tools are tools scoped to a specific flow, mirroring the project-level tool structure
 */
@injectable()
export class FlowToolService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new flow tool and logs the creation in the audit trail
   * @param projectId - ID of the project
   * @param flowId - ID of the flow to create the tool in
   * @param input - Flow tool creation data including id, name, prompt, inputType, outputType, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created flow tool
   */
  async createFlowTool(projectId: string, flowId: string, input: CreateFlowToolRequest, context: RequestContext): Promise<FlowToolResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    const toolId = input.id ?? generateId(ID_PREFIXES.FLOW_TOOL);
    logger.info({ toolId, projectId, flowId, name: input.name, adminId: context?.adminId }, 'Creating flow tool');

    try {
      const tool = await db.insert(flowTools).values({ id: toolId, projectId, flowId, name: input.name, description: input.description ?? null, prompt: input.prompt, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, inputType: input.inputType, outputType: input.outputType, parameters: input.parameters ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdTool = tool[0];

      await this.auditService.logCreate('flow_tool', createdTool.id, { id: createdTool.id, projectId: createdTool.projectId, flowId: createdTool.flowId, name: createdTool.name, description: createdTool.description, prompt: createdTool.prompt, llmProviderId: createdTool.llmProviderId, llmSettings: createdTool.llmSettings, inputType: createdTool.inputType, outputType: createdTool.outputType, parameters: createdTool.parameters, metadata: createdTool.metadata }, context?.adminId);

      logger.info({ toolId: createdTool.id }, 'Flow tool created successfully');

      return flowToolResponseSchema.parse(createdTool);
    } catch (error) {
      logger.error({ error, toolId: input.id }, 'Failed to create flow tool');
      throw error;
    }
  }

  /**
   * Retrieves a flow tool by its unique identifier
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow tool
   * @returns The flow tool if found
   * @throws {NotFoundError} When flow tool is not found
   */
  async getFlowToolById(projectId: string, flowId: string, id: string): Promise<FlowToolResponse> {
    logger.debug({ toolId: id }, 'Fetching flow tool by ID');

    try {
      const tool = await db.query.flowTools.findFirst({ where: and(eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId), eq(flowTools.id, id)) });

      if (!tool) {
        throw new NotFoundError(`Flow tool with id ${id} not found`);
      }

      return flowToolResponseSchema.parse(tool);
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to fetch flow tool');
      throw error;
    }
  }

  /**
   * Lists flow tools with flexible filtering, sorting, and pagination
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of flow tools matching the criteria
   */
  async listFlowTools(projectId: string, flowId: string, params?: ListParams): Promise<FlowToolListResponse> {
    logger.debug({ params }, 'Listing flow tools');

    try {
      const conditions: SQL[] = [eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: flowTools.id,
        projectId: flowTools.projectId,
        flowId: flowTools.flowId,
        name: flowTools.name,
        inputType: flowTools.inputType,
        outputType: flowTools.outputType,
        llmProviderId: flowTools.llmProviderId,
        version: flowTools.version,
        createdAt: flowTools.createdAt,
        updatedAt: flowTools.updatedAt,
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
        conditions.push(like(flowTools.name, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      const totalResult = await db.query.flowTools.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      const toolList = await db.query.flowTools.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(flowTools.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return flowToolListResponseSchema.parse({
        items: toolList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list flow tools');
      throw error;
    }
  }

  /**
   * Updates a flow tool using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow tool to update
   * @param input - Flow tool update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated flow tool
   * @throws {NotFoundError} When flow tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateFlowTool(projectId: string, flowId: string, id: string, input: UpdateFlowToolRequest, context: RequestContext): Promise<FlowToolResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ toolId: id, expectedVersion, adminId: context?.adminId }, 'Updating flow tool');

    try {
      const existingTool = await db.query.flowTools.findFirst({ where: and(eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId), eq(flowTools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Flow tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Flow tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const updatePayload: any = { version: existingTool.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.prompt !== undefined) updatePayload.prompt = updateData.prompt;
      if (updateData.llmProviderId !== undefined) updatePayload.llmProviderId = updateData.llmProviderId;
      if (updateData.llmSettings !== undefined) updatePayload.llmSettings = updateData.llmSettings;
      if (updateData.inputType !== undefined) updatePayload.inputType = updateData.inputType;
      if (updateData.outputType !== undefined) updatePayload.outputType = updateData.outputType;
      if (updateData.parameters !== undefined) updatePayload.parameters = updateData.parameters;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updatedTool = await db.update(flowTools).set(updatePayload).where(and(eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId), eq(flowTools.id, id), eq(flowTools.version, expectedVersion))).returning();

      if (updatedTool.length === 0) {
        throw new OptimisticLockError(`Failed to update flow tool due to version conflict`);
      }

      const tool = updatedTool[0];

      await this.auditService.logUpdate('flow_tool', tool.id, { id: existingTool.id, name: existingTool.name, description: existingTool.description, prompt: existingTool.prompt, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings, inputType: existingTool.inputType, outputType: existingTool.outputType, parameters: existingTool.parameters, metadata: existingTool.metadata }, { id: tool.id, name: tool.name, description: tool.description, prompt: tool.prompt, llmProviderId: tool.llmProviderId, llmSettings: tool.llmSettings, inputType: tool.inputType, outputType: tool.outputType, parameters: tool.parameters, metadata: tool.metadata }, context?.adminId);

      logger.info({ toolId: tool.id, newVersion: tool.version }, 'Flow tool updated successfully');

      return flowToolResponseSchema.parse(tool);
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to update flow tool');
      throw error;
    }
  }

  /**
   * Deletes a flow tool using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow tool to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When flow tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteFlowTool(projectId: string, flowId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.FLOW_DELETE);
    logger.info({ toolId: id, expectedVersion, adminId: context?.adminId }, 'Deleting flow tool');

    try {
      const existingTool = await db.query.flowTools.findFirst({ where: and(eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId), eq(flowTools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Flow tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Flow tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const deleted = await db.delete(flowTools).where(and(eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId), eq(flowTools.id, id), eq(flowTools.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete flow tool due to version conflict`);
      }

      await this.auditService.logDelete('flow_tool', id, { id: existingTool.id, name: existingTool.name, description: existingTool.description, prompt: existingTool.prompt, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings, inputType: existingTool.inputType, outputType: existingTool.outputType, parameters: existingTool.parameters, metadata: existingTool.metadata }, context?.adminId);

      logger.info({ toolId: id }, 'Flow tool deleted successfully');
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to delete flow tool');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing flow tool with a new ID and optional name override
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param id - The unique identifier of the flow tool to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned flow tool
   * @throws {NotFoundError} When the source flow tool is not found
   */
  async cloneFlowTool(projectId: string, flowId: string, id: string, input: CloneFlowToolRequest, context: RequestContext): Promise<FlowToolResponse> {
    this.requirePermission(context, PERMISSIONS.FLOW_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning flow tool');

    try {
      const existingTool = await db.query.flowTools.findFirst({ where: and(eq(flowTools.projectId, projectId), eq(flowTools.flowId, flowId), eq(flowTools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Flow tool with id ${id} not found`);
      }

      return await this.createFlowTool(projectId, flowId, { id: input.id, name: input.name ?? `${existingTool.name} (Clone)`, description: existingTool.description ?? undefined, prompt: existingTool.prompt, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings as any, inputType: existingTool.inputType as 'text' | 'image' | 'multi-modal', outputType: existingTool.outputType as 'text' | 'image' | 'multi-modal', parameters: existingTool.parameters as any, metadata: existingTool.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone flow tool');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific flow tool
   * @param toolId - The unique identifier of the flow tool
   * @returns Array of audit log entries for the flow tool
   */
  async getFlowToolAuditLogs(toolId: string): Promise<any[]> {
    logger.debug({ toolId }, 'Fetching audit logs for flow tool');

    try {
      return await this.auditService.getEntityAuditLogs('flow_tool', toolId);
    } catch (error) {
      logger.error({ error, toolId }, 'Failed to fetch flow tool audit logs');
      throw error;
    }
  }
}
