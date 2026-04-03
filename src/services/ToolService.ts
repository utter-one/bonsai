import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc, sql, inArray } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { tools } from '../db/schema';
import type { ToolType } from '../db/schema';
import type { CreateToolRequest, UpdateToolRequest, ToolResponse, ToolListResponse, CloneToolRequest } from '../http/contracts/tool';
import type { ListParams } from '../http/contracts/common';
import { toolResponseSchema, toolListResponseSchema } from '../http/contracts/tool';
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
 * Service for managing tools with full CRUD operations and audit logging
 * Tools are reusable components that can be invoked during conversation stages for LLM calls
 */
@injectable()
export class ToolService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new tool and logs the creation in the audit trail
   * @param input - Tool creation data including id, name, prompt, inputType, outputType, and optional configuration
   * @param context - Request context for auditing and authorization
   * @returns The created tool
   */
  async createTool(projectId: string, input: CreateToolRequest, context: RequestContext): Promise<ToolResponse> {
    this.requirePermission(context, PERMISSIONS.TOOL_WRITE);
    await this.requireProjectNotArchived(projectId);
    const toolId = input.id ?? generateId(ID_PREFIXES.TOOL);
    logger.info({ toolId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating tool');

    try {
      const toolValues: any = { id: toolId, projectId, name: input.name, description: input.description ?? null, type: input.type, parameters: input.parameters ?? [], tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 };
      if (input.type === 'smart_function') {
        toolValues.prompt = input.prompt;
        toolValues.llmProviderId = input.llmProviderId ?? null;
        toolValues.llmSettings = input.llmSettings ?? null;
        toolValues.inputType = input.inputType;
        toolValues.outputType = input.outputType;
      } else if (input.type === 'webhook') {
        toolValues.url = input.url;
        toolValues.webhookMethod = input.webhookMethod ?? 'GET';
        toolValues.webhookHeaders = input.webhookHeaders ?? null;
        toolValues.webhookBody = input.webhookBody ?? null;
      } else if (input.type === 'script') {
        toolValues.code = input.code;
      }
      const tool = await db.insert(tools).values(toolValues).returning();

      const createdTool = tool[0];

      await this.auditService.logCreate('tool', createdTool.id, createdTool, context?.operatorId);

      logger.info({ toolId: createdTool.id }, 'Tool created successfully');

      return toolResponseSchema.parse(createdTool);
    } catch (error) {
      logger.error({ error, toolId: input.id }, 'Failed to create tool');
      throw error;
    }
  }

  /**
   * Retrieves a tool by its unique identifier
   * @param id - The unique identifier of the tool
   * @returns The tool if found
   * @throws {NotFoundError} When tool is not found
   */
  async getToolById(projectId: string, id: string): Promise<ToolResponse> {
    logger.debug({ toolId: id }, 'Fetching tool by ID');

    try {
      const tool = await db.query.tools.findFirst({ where: and(eq(tools.projectId, projectId), eq(tools.id, id)) });

      if (!tool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return toolResponseSchema.parse({ ...tool, archived });
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to fetch tool');
      throw error;
    }
  }

  /**
   * Lists tools with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of tools matching the criteria
   */
  async listTools(projectId: string, params?: ListParams): Promise<ToolListResponse> {
    logger.debug({ params }, 'Listing tools');

    try {
      const conditions: SQL[] = [eq(tools.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: tools.id,
        projectId: tools.projectId,
        name: tools.name,
        type: tools.type,
        inputType: tools.inputType,
        outputType: tools.outputType,
        llmProviderId: tools.llmProviderId,
        version: tools.version,
        createdAt: tools.createdAt,
        updatedAt: tools.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${tools.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name by ilike, or tags JSONB containment for "tag:" prefix)
      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [tools.name], tools.tags);
        if (searchCondition) conditions.push(searchCondition);
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(tools, whereCondition);

      // Get paginated results
      const toolList = await db.query.tools.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(tools.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return toolListResponseSchema.parse({
        items: toolList.map(t => ({ ...t, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list tools');
      throw error;
    }
  }

  /**
   * Updates a tool using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the tool to update
   * @param input - Tool update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated tool
   * @throws {NotFoundError} When tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateTool(projectId: string, id: string, input: UpdateToolRequest, context: RequestContext): Promise<ToolResponse> {
    this.requirePermission(context, PERMISSIONS.TOOL_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ toolId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating tool');

    try {
      const existingTool = await db.query.tools.findFirst({ where: and(eq(tools.projectId, projectId), eq(tools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const updatePayload: any = { version: existingTool.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.parameters !== undefined) updatePayload.parameters = updateData.parameters;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      if (updateData.type === 'smart_function') {
        updatePayload.llmProviderId = updateData.llmProviderId;
        updatePayload.llmSettings = updateData.llmSettings;
        if (updateData.prompt !== undefined) updatePayload.prompt = updateData.prompt;
        if (updateData.inputType !== undefined) updatePayload.inputType = updateData.inputType;
        if (updateData.outputType !== undefined) updatePayload.outputType = updateData.outputType;
      } else if (updateData.type === 'webhook') {
        if (updateData.url !== undefined) updatePayload.url = updateData.url;
        if (updateData.webhookMethod !== undefined) updatePayload.webhookMethod = updateData.webhookMethod;
        if (updateData.webhookHeaders !== undefined) updatePayload.webhookHeaders = updateData.webhookHeaders;
        if (updateData.webhookBody !== undefined) updatePayload.webhookBody = updateData.webhookBody;
      } else if (updateData.type === 'script') {
        if (updateData.code !== undefined) updatePayload.code = updateData.code;
      }

      const updatedTool = await db.update(tools).set(updatePayload).where(and(eq(tools.projectId, projectId), eq(tools.id, id), eq(tools.version, expectedVersion))).returning();

      if (updatedTool.length === 0) {
        throw new OptimisticLockError(`Failed to update tool due to version conflict`);
      }

      const tool = updatedTool[0];

      await this.auditService.logUpdate('tool', tool.id, existingTool, tool, context?.operatorId, projectId);

      logger.info({ toolId: tool.id, newVersion: tool.version }, 'Tool updated successfully');

      return toolResponseSchema.parse(tool);
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to update tool');
      throw error;
    }
  }

  /**
   * Deletes a tool using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the tool to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteTool(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.TOOL_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ toolId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting tool');

    try {
      const existingTool = await db.query.tools.findFirst({ where: and(eq(tools.projectId, projectId), eq(tools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const deleted = await db.delete(tools).where(and(eq(tools.projectId, projectId), eq(tools.id, id), eq(tools.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete tool due to version conflict`);
      }

      await this.auditService.logDelete('tool', id, existingTool, context?.operatorId, projectId);

      logger.info({ toolId: id }, 'Tool deleted successfully');
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to delete tool');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing tool with a new ID and optional name override
   * @param id - The unique identifier of the tool to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned tool
   * @throws {NotFoundError} When the source tool is not found
   */
  async cloneTool(projectId: string, id: string, input: CloneToolRequest, context: RequestContext): Promise<ToolResponse> {
    this.requirePermission(context, PERMISSIONS.TOOL_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ id, operatorId: context?.operatorId }, 'Cloning tool');

    try {
      const existingTool = await db.query.tools.findFirst({ where: and(eq(tools.projectId, projectId), eq(tools.id, id)) });

      if (!existingTool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      const cloneBase = { id: input.id, name: input.name ?? `${existingTool.name} (Clone)`, description: existingTool.description ?? undefined, parameters: existingTool.parameters as any, tags: existingTool.tags as string[], metadata: existingTool.metadata ?? undefined };
      let cloneInput: CreateToolRequest;
      if (existingTool.type === 'webhook') {
        cloneInput = { ...cloneBase, type: 'webhook', url: existingTool.url!, webhookMethod: existingTool.webhookMethod as any, webhookHeaders: existingTool.webhookHeaders as any, webhookBody: existingTool.webhookBody ?? undefined };
      } else if (existingTool.type === 'script') {
        cloneInput = { ...cloneBase, type: 'script', code: existingTool.code! };
      } else {
        cloneInput = { ...cloneBase, type: 'smart_function', prompt: existingTool.prompt!, llmProviderId: existingTool.llmProviderId, llmSettings: existingTool.llmSettings as any, inputType: existingTool.inputType as 'text' | 'image' | 'multi-modal', outputType: existingTool.outputType as 'text' | 'image' | 'multi-modal' };
      }
      return await this.createTool(projectId, cloneInput, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone tool');
      throw error;
    }
  }

  /**
   * Batch-fetches tool types by IDs, used to determine execution priority before sorting effects
   * @param projectId - The project ID to scope the query
   * @param ids - Array of tool IDs to look up
   * @returns Map of toolId → ToolType for all found tools
   */
  async getToolTypesByIds(projectId: string, ids: string[]): Promise<Map<string, ToolType>> {
    if (ids.length === 0) return new Map();
    const rows = await db.select({ id: tools.id, type: tools.type }).from(tools).where(and(eq(tools.projectId, projectId), inArray(tools.id, ids)));
    return new Map(rows.map(r => [r.id, r.type]));
  }

  /**
   * Retrieves all audit log entries for a specific tool
   * @param toolId - The unique identifier of the tool
   * @param projectId - The project ID the tool belongs to
   * @returns Array of audit log entries for the tool
   */
  async getToolAuditLogs(toolId: string, projectId: string): Promise<any[]> {
    logger.debug({ toolId, projectId }, 'Fetching audit logs for tool');

    try {
      return await this.auditService.getEntityAuditLogs('tool', toolId, projectId);
    } catch (error) {
      logger.error({ error, toolId, projectId }, 'Failed to fetch tool audit logs');
      throw error;
    }
  }
}
