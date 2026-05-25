import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc } from 'drizzle-orm';
import { buildTextSearchCondition } from '../../utils/textSearch';
import { db } from '../../db/index';
import { scenarios } from '../../db/schema';
import type { CreateScenarioRequest, UpdateScenarioRequest, ScenarioResponse, ScenarioListResponse } from '../../http/contracts/scenario';
import type { ListParams } from '../../http/contracts/common';
import { scenarioResponseSchema, scenarioListResponseSchema } from '../../http/contracts/scenario';
import { AuditService } from '../AuditService';
import { OptimisticLockError, NotFoundError } from '../../errors';
import { buildFilterCondition, buildOrderBy } from '../../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../../utils/pagination';
import { logger } from '../../utils/logger';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';

/**
 * Service for managing test scenarios with full CRUD operations and audit logging.
 * Scenarios define automated conversation flows for testing agents.
 */
@injectable()
export class ScenarioService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new scenario and logs the creation in the audit trail
   * @param projectId - The project to create the scenario in
   * @param input - Scenario creation data
   * @param context - Request context for auditing and authorization
   * @returns The created scenario
   */
  async createScenario(projectId: string, input: CreateScenarioRequest, context: RequestContext): Promise<ScenarioResponse> {
    this.requirePermission(context, PERMISSIONS.SCENARIO_WRITE);
    await this.requireProjectNotArchived(projectId);
    const scenarioId = input.id ?? generateId(ID_PREFIXES.SCENARIO);
    logger.info({ scenarioId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating scenario');

    try {
      const scenario = await db.insert(scenarios).values({ id: scenarioId, projectId, name: input.name, description: input.description ?? null, language: input.language, startingStageId: input.startingStageId, maxTurns: input.maxTurns, endingStageIds: input.endingStageIds ?? [], personaCanHangUp: input.personaCanHangUp ?? false, conversationOpener: input.conversationOpener ?? null, dataExtraction: input.dataExtraction ?? null, contextTransformerId: input.contextTransformerId ?? null, dataPostProcessingExpected: input.dataPostProcessingExpected ?? null, tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const created = scenario[0];

      await this.auditService.logCreate('scenario', created.id, created, context?.operatorId);

      logger.info({ scenarioId: created.id }, 'Scenario created successfully');

      return scenarioResponseSchema.parse(created);
    } catch (error) {
      logger.error({ error, scenarioId: input.id }, 'Failed to create scenario');
      throw error;
    }
  }

  /**
   * Retrieves a scenario by its unique identifier
   * @param projectId - The project the scenario belongs to
   * @param id - The unique identifier of the scenario
   * @returns The scenario if found
   * @throws {NotFoundError} When scenario is not found
   */
  async getScenarioById(projectId: string, id: string): Promise<ScenarioResponse> {
    logger.debug({ scenarioId: id }, 'Fetching scenario by ID');

    try {
      const scenario = await db.query.scenarios.findFirst({ where: and(eq(scenarios.projectId, projectId), eq(scenarios.id, id)) });

      if (!scenario) {
        throw new NotFoundError(`Scenario with id ${id} not found`);
      }

      return scenarioResponseSchema.parse(scenario);
    } catch (error) {
      logger.error({ error, scenarioId: id }, 'Failed to fetch scenario');
      throw error;
    }
  }

  /**
   * Lists scenarios with flexible filtering, sorting, and pagination
   * @param projectId - The project to list scenarios for
   * @param params - List parameters including filters, sorting, and pagination
   * @returns Paginated array of scenarios
   */
  async listScenarios(projectId: string, params?: ListParams): Promise<ScenarioListResponse> {
    logger.debug({ params }, 'Listing scenarios');

    try {
      const conditions: SQL[] = [eq(scenarios.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: scenarios.id,
        projectId: scenarios.projectId,
        name: scenarios.name,
        language: scenarios.language,
        startingStageId: scenarios.startingStageId,
        version: scenarios.version,
        createdAt: scenarios.createdAt,
        updatedAt: scenarios.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) conditions.push(condition);
        }
      }

      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [scenarios.name], scenarios.tags);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(scenarios, whereCondition);

      const scenarioList = await db.query.scenarios.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(scenarios.createdAt)],
        limit,
        offset,
      });

      return scenarioListResponseSchema.parse({ items: scenarioList, total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list scenarios');
      throw error;
    }
  }

  /**
   * Updates a scenario using optimistic locking to prevent concurrent modifications
   * @param projectId - The project the scenario belongs to
   * @param id - The unique identifier of the scenario to update
   * @param input - Scenario update data including version
   * @param context - Request context for auditing and authorization
   * @returns The updated scenario
   * @throws {NotFoundError} When scenario is not found
   * @throws {OptimisticLockError} When the version doesn't match
   */
  async updateScenario(projectId: string, id: string, input: UpdateScenarioRequest, context: RequestContext): Promise<ScenarioResponse> {
    this.requirePermission(context, PERMISSIONS.SCENARIO_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ scenarioId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating scenario');

    try {
      const existing = await db.query.scenarios.findFirst({ where: and(eq(scenarios.projectId, projectId), eq(scenarios.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Scenario with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Scenario version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: any = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.language !== undefined) updatePayload.language = updateData.language;
      if (updateData.startingStageId !== undefined) updatePayload.startingStageId = updateData.startingStageId;
      if (updateData.maxTurns !== undefined) updatePayload.maxTurns = updateData.maxTurns;
      if (updateData.endingStageIds !== undefined) updatePayload.endingStageIds = updateData.endingStageIds;
      if (updateData.personaCanHangUp !== undefined) updatePayload.personaCanHangUp = updateData.personaCanHangUp;
      if (updateData.conversationOpener !== undefined) updatePayload.conversationOpener = updateData.conversationOpener;
      if (updateData.dataExtraction !== undefined) updatePayload.dataExtraction = updateData.dataExtraction;
      if (updateData.contextTransformerId !== undefined) updatePayload.contextTransformerId = updateData.contextTransformerId;
      if (updateData.dataPostProcessingExpected !== undefined) updatePayload.dataPostProcessingExpected = updateData.dataPostProcessingExpected;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updated = await db.update(scenarios).set(updatePayload).where(and(eq(scenarios.projectId, projectId), eq(scenarios.id, id), eq(scenarios.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update scenario due to version conflict`);
      }

      const scenario = updated[0];

      await this.auditService.logUpdate('scenario', scenario.id, existing, scenario, context?.operatorId);

      logger.info({ scenarioId: scenario.id, newVersion: scenario.version }, 'Scenario updated successfully');

      return scenarioResponseSchema.parse(scenario);
    } catch (error) {
      logger.error({ error, scenarioId: id }, 'Failed to update scenario');
      throw error;
    }
  }

  /**
   * Deletes a scenario using optimistic locking
   * @param projectId - The project the scenario belongs to
   * @param id - The unique identifier of the scenario to delete
   * @param expectedVersion - The expected version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When scenario is not found
   * @throws {OptimisticLockError} When the version doesn't match
   */
  async deleteScenario(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.SCENARIO_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ scenarioId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting scenario');

    try {
      const existing = await db.query.scenarios.findFirst({ where: and(eq(scenarios.projectId, projectId), eq(scenarios.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Scenario with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Scenario version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(scenarios).where(and(eq(scenarios.projectId, projectId), eq(scenarios.id, id), eq(scenarios.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete scenario due to version conflict`);
      }

      await this.auditService.logDelete('scenario', id, existing, context?.operatorId, projectId);

      logger.info({ scenarioId: id }, 'Scenario deleted successfully');
    } catch (error) {
      logger.error({ error, scenarioId: id }, 'Failed to delete scenario');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific scenario
   * @param id - The unique identifier of the scenario
   * @param projectId - The project ID the scenario belongs to
   * @returns Array of audit log entries for the scenario
   */
  async getScenarioAuditLogs(id: string, projectId: string): Promise<any[]> {
    logger.debug({ id, projectId }, 'Fetching audit logs for scenario');

    try {
      return await this.auditService.getEntityAuditLogs('scenario', id, projectId);
    } catch (error) {
      logger.error({ error, id, projectId }, 'Failed to fetch scenario audit logs');
      throw error;
    }
  }
}
