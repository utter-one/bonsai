import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { tools } from '../db/schema';
import type { CreateToolRequest, UpdateToolRequest, ToolResponse, ToolListResponse } from '../api/tool';
import type { ListParams } from '../api/common';
import { toolResponseSchema, toolListResponseSchema } from '../api/tool';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from '../types/request-context';
import { PERMISSIONS } from '../permissions';

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
  async createTool(input: CreateToolRequest, context: RequestContext): Promise<ToolResponse> {
    this.requirePermission(context, PERMISSIONS.TOOL_WRITE);
    logger.info({ toolId: input.id, name: input.name, adminId: context?.adminId }, 'Creating tool');

    try {
      const tool = await db.insert(tools).values({ id: input.id, name: input.name, description: input.description ?? null, prompt: input.prompt, llmProvider: input.llmProvider ?? null, llmProviderConfig: input.llmProviderConfig ?? null, inputType: input.inputType, outputType: input.outputType, metadata: input.metadata ?? null, version: 1 }).returning();

      const createdTool = tool[0];

      await this.auditService.logCreate('tool', createdTool.id, { id: createdTool.id, name: createdTool.name, description: createdTool.description, prompt: createdTool.prompt, llmProvider: createdTool.llmProvider, llmProviderConfig: createdTool.llmProviderConfig, inputType: createdTool.inputType, outputType: createdTool.outputType, metadata: createdTool.metadata }, context?.adminId);

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
  async getToolById(id: string): Promise<ToolResponse> {
    logger.debug({ toolId: id }, 'Fetching tool by ID');

    try {
      const tool = await db.query.tools.findFirst({ where: eq(tools.id, id) });

      if (!tool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      return toolResponseSchema.parse(tool);
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
  async listTools(params?: ListParams): Promise<ToolListResponse> {
    logger.debug({ params }, 'Listing tools');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: tools.id,
        name: tools.name,
        inputType: tools.inputType,
        outputType: tools.outputType,
        llmProvider: tools.llmProvider,
        version: tools.version,
        createdAt: tools.createdAt,
        updatedAt: tools.updatedAt,
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

      // Apply text search (searches name and description)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(tools.name, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.tools.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const toolList = await db.query.tools.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(tools.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return toolListResponseSchema.parse({
        items: toolList,
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
   * @param input - Tool update data (without version)
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @returns The updated tool
   * @throws {NotFoundError} When tool is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateTool(id: string, input: Omit<UpdateToolRequest, 'version'>, expectedVersion: number, context: RequestContext): Promise<ToolResponse> {
    this.requirePermission(context, PERMISSIONS.TOOL_WRITE);
    logger.info({ toolId: id, expectedVersion, adminId: context?.adminId }, 'Updating tool');

    try {
      const existingTool = await db.query.tools.findFirst({ where: eq(tools.id, id) });

      if (!existingTool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const updateData: any = { version: existingTool.version + 1, updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.prompt !== undefined) updateData.prompt = input.prompt;
      if (input.llmProvider !== undefined) updateData.llmProvider = input.llmProvider;
      if (input.llmProviderConfig !== undefined) updateData.llmProviderConfig = input.llmProviderConfig;
      if (input.inputType !== undefined) updateData.inputType = input.inputType;
      if (input.outputType !== undefined) updateData.outputType = input.outputType;
      if (input.metadata !== undefined) updateData.metadata = input.metadata;

      const updatedTool = await db.update(tools).set(updateData).where(and(eq(tools.id, id), eq(tools.version, expectedVersion))).returning();

      if (updatedTool.length === 0) {
        throw new OptimisticLockError(`Failed to update tool due to version conflict`);
      }

      const tool = updatedTool[0];

      await this.auditService.logUpdate('tool', tool.id, { id: existingTool.id, name: existingTool.name, description: existingTool.description, prompt: existingTool.prompt, llmProvider: existingTool.llmProvider, llmProviderConfig: existingTool.llmProviderConfig, inputType: existingTool.inputType, outputType: existingTool.outputType, metadata: existingTool.metadata }, { id: tool.id, name: tool.name, description: tool.description, prompt: tool.prompt, llmProvider: tool.llmProvider, llmProviderConfig: tool.llmProviderConfig, inputType: tool.inputType, outputType: tool.outputType, metadata: tool.metadata }, context?.adminId);

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
  async deleteTool(id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.TOOL_DELETE);
    logger.info({ toolId: id, expectedVersion, adminId: context?.adminId }, 'Deleting tool');

    try {
      const existingTool = await db.query.tools.findFirst({ where: eq(tools.id, id) });

      if (!existingTool) {
        throw new NotFoundError(`Tool with id ${id} not found`);
      }

      if (existingTool.version !== expectedVersion) {
        throw new OptimisticLockError(`Tool version mismatch. Expected ${expectedVersion}, got ${existingTool.version}`);
      }

      const deleted = await db.delete(tools).where(and(eq(tools.id, id), eq(tools.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete tool due to version conflict`);
      }

      await this.auditService.logDelete('tool', id, { id: existingTool.id, name: existingTool.name, description: existingTool.description, prompt: existingTool.prompt, llmProvider: existingTool.llmProvider, llmProviderConfig: existingTool.llmProviderConfig, inputType: existingTool.inputType, outputType: existingTool.outputType, metadata: existingTool.metadata }, context?.adminId);

      logger.info({ toolId: id }, 'Tool deleted successfully');
    } catch (error) {
      logger.error({ error, toolId: id }, 'Failed to delete tool');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific tool
   * @param toolId - The unique identifier of the tool
   * @returns Array of audit log entries for the tool
   */
  async getToolAuditLogs(toolId: string): Promise<any[]> {
    logger.debug({ toolId }, 'Fetching audit logs for tool');

    try {
      return await this.auditService.getEntityAuditLogs('tool', toolId);
    } catch (error) {
      logger.error({ error, toolId }, 'Failed to fetch tool audit logs');
      throw error;
    }
  }
}
