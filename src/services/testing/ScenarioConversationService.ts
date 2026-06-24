import { injectable } from 'tsyringe';
import { eq, and, SQL, desc, isNotNull } from 'drizzle-orm';
import { db } from '../../db/index';
import { scenarioConversations } from '../../db/schema';
import type { ScenarioRunStatus, TestRunStatus } from '../../db/schema';
import type { ScenarioConversationResponse, ScenarioConversationListResponse, ScenarioConversationListParams } from '../../http/contracts/scenarioConversation';
import { scenarioConversationResponseSchema, scenarioConversationListResponseSchema } from '../../http/contracts/scenarioConversation';
import { NotFoundError } from '../../errors';
import { buildFilterCondition, buildOrderBy } from '../../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../../utils/pagination';
import { logger } from '../../utils/logger';
import { BaseService } from '../BaseService';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';

/** Input for creating a scenario conversation (execution engine only) */
export type CreateScenarioConversationInput = {
  scenarioRunId: string;
  projectId: string;
  scenarioId: string;
  testerId: string;
  conversationId?: string;
};

/** Results to write when updating a scenario conversation status */
export type ScenarioConversationResults = {
  dataExtractionResults?: Record<string, unknown>;
  dataTransformationResults?: Record<string, unknown>;
  testRunStatus?: TestRunStatus;
  testStatistics?: { passedTests: number; failedTests: number };
};

/**
 * Service for reading and writing scenario conversations.
 * Write operations are for the execution engine only.
 */
@injectable()
export class ScenarioConversationService extends BaseService {
  /**
   * Retrieves a scenario conversation by its unique identifier
   * @param projectId - The project the conversation belongs to
   * @param id - The unique identifier of the scenario conversation
   * @returns The scenario conversation if found
   * @throws {NotFoundError} When scenario conversation is not found
   */
  async getScenarioConversationById(projectId: string, id: string): Promise<ScenarioConversationResponse> {
    logger.debug({ scenarioConversationId: id }, 'Fetching scenario conversation by ID');

    try {
      const conversation = await db.query.scenarioConversations.findFirst({ where: and(eq(scenarioConversations.projectId, projectId), eq(scenarioConversations.id, id)) });

      if (!conversation) {
        throw new NotFoundError(`Scenario conversation with id ${id} not found`);
      }

      return scenarioConversationResponseSchema.parse(conversation);
    } catch (error) {
      logger.error({ error, scenarioConversationId: id }, 'Failed to fetch scenario conversation');
      throw error;
    }
  }

  /**
   * Lists scenario conversations with filtering, sorting, and pagination.
   * Supports filtering by scenarioRunId.
   * @param projectId - The project to list conversations for
   * @param params - List parameters including optional scenarioRunId filter
   * @returns Paginated array of scenario conversations
   */
  async listScenarioConversations(projectId: string, params?: ScenarioConversationListParams): Promise<ScenarioConversationListResponse> {
    logger.debug({ params }, 'Listing scenario conversations');

    try {
      const conditions: SQL[] = [eq(scenarioConversations.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      if (params?.scenarioRunId) {
        conditions.push(eq(scenarioConversations.scenarioRunId, params.scenarioRunId));
      }

      const columnMap = {
        id: scenarioConversations.id,
        projectId: scenarioConversations.projectId,
        scenarioRunId: scenarioConversations.scenarioRunId,
        scenarioId: scenarioConversations.scenarioId,
        testerId: scenarioConversations.testerId,
        status: scenarioConversations.status,
        version: scenarioConversations.version,
        createdAt: scenarioConversations.createdAt,
        updatedAt: scenarioConversations.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) conditions.push(condition);
        }
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(scenarioConversations, whereCondition);

      const conversationList = await db.query.scenarioConversations.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(scenarioConversations.createdAt)],
        limit,
        offset,
      });

      return scenarioConversationListResponseSchema.parse({ items: conversationList, total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list scenario conversations');
      throw error;
    }
  }

  /**
   * Creates a new scenario conversation record for an execution slot
   * @param input - Scenario conversation creation data
   * @returns The created scenario conversation
   */
  async createScenarioConversation(input: CreateScenarioConversationInput): Promise<ScenarioConversationResponse> {
    const id = generateId(ID_PREFIXES.SCENARIO_CONVERSATION);
    logger.info({ id, scenarioRunId: input.scenarioRunId, testerId: input.testerId }, 'Creating scenario conversation');
    try {
      const result = await db.insert(scenarioConversations).values({ id, projectId: input.projectId, scenarioRunId: input.scenarioRunId, scenarioId: input.scenarioId, testerId: input.testerId, conversationId: input.conversationId ?? null, status: 'queued', version: 1 }).returning();
      return scenarioConversationResponseSchema.parse(result[0]);
    } catch (error) {
      logger.error({ error, id }, 'Failed to create scenario conversation');
      throw error;
    }
  }

  /**
   * Updates the status and optional results of a scenario conversation
   * @param id - The scenario conversation ID
   * @param projectId - The project the conversation belongs to
   * @param status - The new status to set
   * @param results - Optional extraction and transformation results to persist
   */
  async updateScenarioConversationStatus(id: string, projectId: string, status: ScenarioRunStatus, results?: ScenarioConversationResults): Promise<void> {
    try {
      const updateData: Record<string, unknown> = { status, updatedAt: new Date() };
      if (results?.dataExtractionResults !== undefined) updateData.dataExtractionResults = results.dataExtractionResults;
      if (results?.dataTransformationResults !== undefined) updateData.dataTransformationResults = results.dataTransformationResults;
      if (results?.testRunStatus !== undefined) updateData.testRunStatus = results.testRunStatus;
      if (results?.testStatistics !== undefined) updateData.testStatistics = results.testStatistics;
      await db.update(scenarioConversations).set(updateData).where(and(eq(scenarioConversations.id, id), eq(scenarioConversations.projectId, projectId)));
      logger.info({ id, status }, 'Scenario conversation status updated');
    } catch (error) {
      logger.error({ error, id, status }, 'Failed to update scenario conversation status');
      throw error;
    }
  }

  /**
   * Links a conversation ID to a scenario conversation record
   * @param id - The scenario conversation ID
   * @param projectId - The project the conversation belongs to
   * @param conversationId - The conversation ID to link
   */
  async linkConversation(id: string, projectId: string, conversationId: string): Promise<void> {
    try {
      await db.update(scenarioConversations).set({ conversationId, updatedAt: new Date() }).where(and(eq(scenarioConversations.id, id), eq(scenarioConversations.projectId, projectId)));
    } catch (error) {
      logger.error({ error, id, conversationId }, 'Failed to link conversation to scenario conversation');
      throw error;
    }
  }

  /**
   * Retrieves all non-null conversation IDs linked to a scenario run.
   * Used by analytics to filter data to only conversations used during testing.
   * @param projectId - The project the scenario run belongs to
   * @param scenarioRunId - The scenario run ID to filter by
   * @returns Array of conversation IDs linked to the scenario run
   */
  async getConversationIdsByScenarioRun(projectId: string, scenarioRunId: string): Promise<string[]> {
    try {
      const results = await db.query.scenarioConversations.findMany({
        where: and(
          eq(scenarioConversations.projectId, projectId),
          eq(scenarioConversations.scenarioRunId, scenarioRunId),
          isNotNull(scenarioConversations.conversationId),
        ),
        columns: { conversationId: true },
      });
      return results.map((r) => r.conversationId!).filter(Boolean);
    } catch (error) {
      logger.error({ error, scenarioRunId }, 'Failed to fetch conversation IDs for scenario run');
      throw error;
    }
  }
}
