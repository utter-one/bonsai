import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { stageTools } from '../db/schema';
import type { CreateStageToolRequest, UpdateStageToolRequest, StageToolResponse, StageToolListResponse, CloneStageToolRequest } from '../http/contracts/stageTool';
import type { ListParams } from '../http/contracts/common';
import { stageToolResponseSchema, stageToolListResponseSchema } from '../http/contracts/stageTool';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing stage tools with full CRUD operations and audit logging
 * Stage tools are tools scoped to a specific stage within a flow, mirroring the flow-level tool structure
 */
@injectable()
export class StageToolService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new stage tool and logs the creation in the audit trail
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param stageId - ID of the stage to create the tool in
   * @param input - Stage tool creation data including id, name, prompt, inputType, outputType, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created stage tool
   */
  async createStageTool(projectId: string, flowId: string, stageId: string, input: CreateStageToolRequest, context: RequestContext): Promise<StageToolResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    const toolId = input.id ?? generateId(ID_PREFIXES.STAGE_TOOL);
    logger.info({ toolId, projectId, flowId, stageId, name: input.name, adminId: context?.adminId }, 'Creating stage tool');

    try {
      const tool = await db.insert(stageTools).values({ id: toolId, projectId, flowId, stageId, name: input.name, description: input.description ?? null, prompt: input.prompt, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, inputType: input.inputType, outputType: input.outputType, parameters: input.parameters ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const createdTool = tool[0];

      await this.auditService.logCreate('stage_tool', createdTool.id, { id: createdTool.id, projectId: createdTool.projectId, flowId: createdTool.flowId, stageId: createdTool.stageId, name: createdTool.name, description: createdTool.description, prompt: createdTool.prompt, llmProviderId: createdTool.llmProviderId, llmSettings: createdTool.llmSettings, inputType: createdTool.inputType, outputType: createdTool.outputType, parameters: createdTool.parameters, metadata: createdTool.metadata }, context?.adminId);

      logger.info({ toolId: createdTool.id }, 'Stage tool created successfully');

      return stageToolResponseSchema.parse(createdTool);
    } catch (error) {
      logger.error({ error, toolId: input.id }, 'Failed to create stage tool');
      throw error;
    }
  }

  /**
   * Retrieves a stage tool by its unique identifier
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param stageId - ID of the stage
   * @param id - The unique identifier of the stage tool
   * @returns The stage tool if found
   * @throws {NotFoundError} When stage tool is not found
   */
  async getStageToolById(projectId: string, flowId: string, stageId: string, id: string): Promise<StageToolResponse> {
    logger.debug({ toolId: id }, 'Fetching stage tool by ID');

    try {
      const tool = await db.query.stageTools.findFirst({ where: and(eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId), eq(stageTools.id, id)) });

      if (!tool) {
        throw new NotFoundError(`Stage tool with id ${id} not found`);
      }

      return stageToolResponseSchema.parse(tool);
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to fetch stage tool');
      throw error;
    }
  }

  /**
   * Lists stage tools with flexible filtering, sorting, and pagination
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param stageId - ID of the stage
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of stage tools matching the criteria
   */
  async listStageTools(projectId: string, flowId: string, stageId: string, params?: ListParams): Promise<StageToolListResponse> {
    logger.debug({ params }, 'Listing stage tools');

    try {
      const conditions: SQL[] = [eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      const columnMap = {
        id: stageTools.id,
        projectId: stageTools.projectId,
        flowId: stageTools.flowId,
        stageId: stageTools.stageId,
        name: stageTools.name,
        inputType: stageTools.inputType,
        outputType: stageTools.outputType,
        llmProviderId: stageTools.llmProviderId,
        version: stageTools.version,
        createdAt: stageTools.createdAt,
        updatedAt: stageTools.updatedAt,
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
        conditions.push(like(stageTools.name, searchTerm));
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      const totalResult = await db.query.stageTools.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      const toolList = await db.query.stageTools.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(stageTools.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return stageToolListResponseSchema.parse({
        items: toolList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list stage tools');
      throw error;
    }
  }

  /**
   * Updates a stage tool using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param stageId - ID of the stage
   * @param id - The unique identifier of the stage tool to update
   * @param input - Stage tool update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated stage tool
   * @throws {NotFoundError} When stage tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateStageTool(projectId: string, flowId: string, stageId: string, id: string, input: UpdateStageToolRequest, context: RequestContext): Promise<StageToolResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ toolId: id, expectedVersion, adminId: context?.adminId }, 'Updating stage tool');

    try {
      const existingTool = await db.query.stageTools.findFirst({ where: and(eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId), eq(stageTools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Stage tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Stage tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
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

      const updatedTool = await db.update(stageTools).set(updatePayload).where(and(eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId), eq(stageTools.id, id), eq(stageTools.version, expectedVersion))).returning();

      if (updatedTool.length === 0) {
        throw new OptimisticLockError(`Failed to update stage tool due to version conflict`);
      }

      const tool = updatedTool[0];

      await this.auditService.logUpdate('stage_tool', tool.id, { id: existingTool.id, name: existingTool.name, description: existingTool.description, prompt: existingTool.prompt, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings, inputType: existingTool.inputType, outputType: existingTool.outputType, parameters: existingTool.parameters, metadata: existingTool.metadata }, { id: tool.id, name: tool.name, description: tool.description, prompt: tool.prompt, llmProviderId: tool.llmProviderId, llmSettings: tool.llmSettings, inputType: tool.inputType, outputType: tool.outputType, parameters: tool.parameters, metadata: tool.metadata }, context?.adminId);

      logger.info({ toolId: tool.id, newVersion: tool.version }, 'Stage tool updated successfully');

      return stageToolResponseSchema.parse(tool);
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to update stage tool');
      throw error;
    }
  }

  /**
   * Deletes a stage tool using optimistic locking to prevent concurrent modifications
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param stageId - ID of the stage
   * @param id - The unique identifier of the stage tool to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When stage tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteStageTool(projectId: string, flowId: string, stageId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.STAGE_DELETE);
    logger.info({ toolId: id, expectedVersion, adminId: context?.adminId }, 'Deleting stage tool');

    try {
      const existingTool = await db.query.stageTools.findFirst({ where: and(eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId), eq(stageTools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Stage tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Stage tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const deleted = await db.delete(stageTools).where(and(eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId), eq(stageTools.id, id), eq(stageTools.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete stage tool due to version conflict`);
      }

      await this.auditService.logDelete('stage_tool', id, { id: existingTool.id, name: existingTool.name, description: existingTool.description, prompt: existingTool.prompt, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings, inputType: existingTool.inputType, outputType: existingTool.outputType, parameters: existingTool.parameters, metadata: existingTool.metadata }, context?.adminId);

      logger.info({ toolId: id }, 'Stage tool deleted successfully');
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to delete stage tool');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing stage tool with a new ID and optional name override
   * @param projectId - ID of the project
   * @param flowId - ID of the flow
   * @param stageId - ID of the stage
   * @param id - The unique identifier of the stage tool to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned stage tool
   * @throws {NotFoundError} When the source stage tool is not found
   */
  async cloneStageTool(projectId: string, flowId: string, stageId: string, id: string, input: CloneStageToolRequest, context: RequestContext): Promise<StageToolResponse> {
    this.requirePermission(context, PERMISSIONS.STAGE_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning stage tool');

    try {
      const existingTool = await db.query.stageTools.findFirst({ where: and(eq(stageTools.projectId, projectId), eq(stageTools.flowId, flowId), eq(stageTools.stageId, stageId), eq(stageTools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Stage tool with id ${id} not found`);
      }

      return await this.createStageTool(projectId, flowId, stageId, { id: input.id, name: input.name ?? `${existingTool.name} (Clone)`, description: existingTool.description ?? undefined, prompt: existingTool.prompt, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings as any, inputType: existingTool.inputType as 'text' | 'image' | 'multi-modal', outputType: existingTool.outputType as 'text' | 'image' | 'multi-modal', parameters: existingTool.parameters as any, metadata: existingTool.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone stage tool');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific stage tool
   * @param toolId - The unique identifier of the stage tool
   * @returns Array of audit log entries for the stage tool
   */
  async getStageToolAuditLogs(toolId: string): Promise<any[]> {
    logger.debug({ toolId }, 'Fetching audit logs for stage tool');

    try {
      return await this.auditService.getEntityAuditLogs('stage_tool', toolId);
    } catch (error) {
      logger.error({ error, toolId }, 'Failed to fetch stage tool audit logs');
      throw error;
    }
  }
}
