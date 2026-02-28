import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { agents } from '../db/schema';
import type { CreateAgentRequest, UpdateAgentRequest, AgentResponse, AgentListResponse, CloneAgentRequest } from '../http/contracts/agent';
import type { ListParams } from '../http/contracts/common';
import { agentResponseSchema, agentListResponseSchema } from '../http/contracts/agent';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing agents with full CRUD operations and audit logging
 */
@injectable()
export class AgentService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new agent and logs the creation in the audit trail
   * @param input - Agent creation data including id, name, description, prompt, ttsProviderId, ttsSettings, and optional metadata
   * @param context - Request context for auditing and authorization
   * @returns The created agent
   */
  async createAgent(projectId: string, input: CreateAgentRequest, context: RequestContext): Promise<AgentResponse> {
    this.requirePermission(context, PERMISSIONS.AGENT_WRITE);
    const agentId = input.id ?? generateId(ID_PREFIXES.AGENT);
    logger.info({ agentId, projectId, name: input.name, adminId: context?.adminId }, 'Creating agent');

    try {
      const agent = await db.insert(agents).values({ id: agentId, projectId, name: input.name, description: input.description ?? null, prompt: input.prompt, ttsProviderId: input.ttsProviderId, ttsSettings: input.ttsSettings, tags: input.tags ?? [], metadata: input.metadata, version: 1 }).returning();

      const createdAgent = agent[0];

      await this.auditService.logCreate('agent', createdAgent.id, { id: createdAgent.id, projectId: createdAgent.projectId, name: createdAgent.name, description: createdAgent.description, prompt: createdAgent.prompt, ttsProviderId: createdAgent.ttsProviderId, ttsSettings: createdAgent.ttsSettings, tags: createdAgent.tags, metadata: createdAgent.metadata }, context?.adminId);

      logger.info({ agentId: createdAgent.id }, 'Agent created successfully');

      return agentResponseSchema.parse(createdAgent);
    } catch (error) {
      logger.error({ error, agentId: input.id }, 'Failed to create agent');
      throw error;
    }
  }

  /**
   * Retrieves an agent by their unique identifier
   * @param id - The unique identifier of the agent
   * @returns The agent if found
   * @throws {NotFoundError} When agent is not found
   */
  async getAgentById(projectId: string, id: string): Promise<AgentResponse> {
    logger.debug({ agentId: id }, 'Fetching agent by ID');

    try {
      const agent = await db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.id, id)) });

      if (!agent) {
        throw new NotFoundError(`Agent with id ${id} not found`);
      }

      return agentResponseSchema.parse(agent);
    } catch (error) {
      logger.error({ error, agentId: id }, 'Failed to fetch agent');
      throw error;
    }
  }

  /**
   * Lists agents with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of agents matching the criteria
   */
  async listAgents(projectId: string, params?: ListParams): Promise<AgentListResponse> {
    logger.debug({ params }, 'Listing agents');

    try {
      const conditions: SQL[] = [eq(agents.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: agents.id,
        projectId: agents.projectId,
        name: agents.name,
        version: agents.version,
        createdAt: agents.createdAt,
        updatedAt: agents.updatedAt,
      };

      // Apply filters
      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${agents.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches name and id)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(agents.name, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.agents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const agentList = await db.query.agents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(agents.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return agentListResponseSchema.parse({
        items: agentList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list agents');
      throw error;
    }
  }

  /**
   * Updates an agent using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the agent to update
   * @param input - Agent update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated agent
   * @throws {NotFoundError} When agent is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateAgent(projectId: string, id: string, input: UpdateAgentRequest, context: RequestContext): Promise<AgentResponse> {
    this.requirePermission(context, PERMISSIONS.AGENT_WRITE);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ agentId: id, expectedVersion, adminId: context?.adminId }, 'Updating agent');

    try {
      const existingAgent = await db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.id, id)) });

      if (!existingAgent) {
        throw new NotFoundError(`Agent with id ${id} not found`);
      }

      if (existingAgent.version !== expectedVersion) {
        throw new OptimisticLockError(`Agent version mismatch. Expected ${expectedVersion}, got ${existingAgent.version}`);
      }

      const updatedAgent = await db.update(agents).set({ name: updateData.name, description: updateData.description, prompt: updateData.prompt, ttsProviderId: updateData.ttsProviderId, ttsSettings: updateData.ttsSettings, tags: updateData.tags, metadata: updateData.metadata, version: existingAgent.version + 1, updatedAt: new Date() }).where(and(eq(agents.projectId, projectId), eq(agents.id, id), eq(agents.version, expectedVersion))).returning();

      if (updatedAgent.length === 0) {
        throw new OptimisticLockError(`Failed to update agent due to version conflict`);
      }

      const agent = updatedAgent[0];

      await this.auditService.logUpdate('agent', agent.id, { id: existingAgent.id, name: existingAgent.name, description: existingAgent.description, prompt: existingAgent.prompt, ttsProviderId: existingAgent.ttsProviderId, ttsSettings: existingAgent.ttsSettings, tags: existingAgent.tags, metadata: existingAgent.metadata }, { id: agent.id, name: agent.name, description: agent.description, prompt: agent.prompt, ttsProviderId: agent.ttsProviderId, ttsSettings: agent.ttsSettings, tags: agent.tags, metadata: agent.metadata }, context?.adminId);

      logger.info({ agentId: agent.id, newVersion: agent.version }, 'Agent updated successfully');

      return agentResponseSchema.parse(agent);
    } catch (error) {
      logger.error({ error, agentId: id }, 'Failed to update agent');
      throw error;
    }
  }

  /**
   * Deletes an agent using optimistic locking to prevent concurrent modifications
   * @param id - The unique identifier of the agent to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When agent is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteAgent(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.AGENT_DELETE);
    logger.info({ agentId: id, expectedVersion, adminId: context?.adminId }, 'Deleting agent');

    try {
      const existingAgent = await db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.id, id)) });

      if (!existingAgent) {
        throw new NotFoundError(`Agent with id ${id} not found`);
      }

      if (existingAgent.version !== expectedVersion) {
        throw new OptimisticLockError(`Agent version mismatch. Expected ${expectedVersion}, got ${existingAgent.version}`);
      }

      const deleted = await db.delete(agents).where(and(eq(agents.projectId, projectId), eq(agents.id, id), eq(agents.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete agent due to version conflict`);
      }

      await this.auditService.logDelete('agent', id, { id: existingAgent.id, name: existingAgent.name, description: existingAgent.description, prompt: existingAgent.prompt, ttsProviderId: existingAgent.ttsProviderId, ttsSettings: existingAgent.ttsSettings, tags: existingAgent.tags, metadata: existingAgent.metadata }, context?.adminId);

      logger.info({ agentId: id }, 'Agent deleted successfully');
    } catch (error) {
      logger.error({ error, agentId: id }, 'Failed to delete agent');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing agent with a new ID and optional name override
   * @param id - The unique identifier of the agent to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned agent
   * @throws {NotFoundError} When the source agent is not found
   */
  async cloneAgent(projectId: string, id: string, input: CloneAgentRequest, context: RequestContext): Promise<AgentResponse> {
    this.requirePermission(context, PERMISSIONS.AGENT_WRITE);
    logger.info({ id, adminId: context?.adminId }, 'Cloning agent');

    try {
      const existingAgent = await db.query.agents.findFirst({ where: and(eq(agents.projectId, projectId), eq(agents.id, id)) });

      if (!existingAgent) {
        throw new NotFoundError(`Agent with id ${id} not found`);
      }

      return await this.createAgent(projectId, { id: input.id, name: input.name ?? `${existingAgent.name} (Clone)`, description: existingAgent.description ?? undefined, prompt: existingAgent.prompt, ttsProviderId: existingAgent.ttsProviderId ?? undefined, ttsSettings: existingAgent.ttsSettings as any, tags: existingAgent.tags as string[], metadata: existingAgent.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone agent');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific agent
   * @param agentId - The unique identifier of the agent
   * @returns Array of audit log entries for the agent
   */
  async getAgentAuditLogs(agentId: string): Promise<any[]> {
    logger.debug({ agentId }, 'Fetching audit logs for agent');

    try {
      return await this.auditService.getEntityAuditLogs('agent', agentId);
    } catch (error) {
      logger.error({ error, agentId }, 'Failed to fetch agent audit logs');
      throw error;
    }
  }
}
