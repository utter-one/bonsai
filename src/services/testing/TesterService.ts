import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc } from 'drizzle-orm';
import { buildTextSearchCondition } from '../../utils/textSearch';
import { db } from '../../db/index';
import { testers } from '../../db/schema';
import type { CreateTesterRequest, UpdateTesterRequest, TesterResponse, TesterListResponse } from '../../http/contracts/tester';
import type { ListParams } from '../../http/contracts/common';
import { testerResponseSchema, testerListResponseSchema } from '../../http/contracts/tester';
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
 * Service for managing tester personas with full CRUD operations and audit logging.
 * Testers act as user personas in automated scenario testing.
 */
@injectable()
export class TesterService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new tester persona and logs the creation in the audit trail
   * @param projectId - The project to create the tester in
   * @param input - Tester creation data
   * @param context - Request context for auditing and authorization
   * @returns The created tester
   */
  async createTester(projectId: string, input: CreateTesterRequest, context: RequestContext): Promise<TesterResponse> {
    this.requirePermission(context, PERMISSIONS.TESTER_WRITE);
    await this.requireProjectNotArchived(projectId);
    const testerId = input.id ?? generateId(ID_PREFIXES.TESTER);
    logger.info({ testerId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating tester');

    try {
      const tester = await db.insert(testers).values({ id: testerId, projectId, name: input.name, description: input.description ?? null, prompt: input.prompt, hangUpPrompt: input.hangUpPrompt ?? null, llmProviderId: input.llmProviderId ?? null, llmSettings: input.llmSettings ?? null, userProfile: input.userProfile ?? null, tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const created = tester[0];

      await this.auditService.logCreate('tester', created.id, created, context?.operatorId);

      logger.info({ testerId: created.id }, 'Tester created successfully');

      return testerResponseSchema.parse(created);
    } catch (error) {
      logger.error({ error, testerId: input.id }, 'Failed to create tester');
      throw error;
    }
  }

  /**
   * Retrieves a tester by its unique identifier
   * @param projectId - The project the tester belongs to
   * @param id - The unique identifier of the tester
   * @returns The tester if found
   * @throws {NotFoundError} When tester is not found
   */
  async getTesterById(projectId: string, id: string): Promise<TesterResponse> {
    logger.debug({ testerId: id }, 'Fetching tester by ID');

    try {
      const tester = await db.query.testers.findFirst({ where: and(eq(testers.projectId, projectId), eq(testers.id, id)) });

      if (!tester) {
        throw new NotFoundError(`Tester with id ${id} not found`);
      }

      return testerResponseSchema.parse(tester);
    } catch (error) {
      logger.error({ error, testerId: id }, 'Failed to fetch tester');
      throw error;
    }
  }

  /**
   * Lists testers with flexible filtering, sorting, and pagination
   * @param projectId - The project to list testers for
   * @param params - List parameters including filters, sorting, and pagination
   * @returns Paginated array of testers
   */
  async listTesters(projectId: string, params?: ListParams): Promise<TesterListResponse> {
    logger.debug({ params }, 'Listing testers');

    try {
      const conditions: SQL[] = [eq(testers.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: testers.id,
        projectId: testers.projectId,
        name: testers.name,
        llmProviderId: testers.llmProviderId,
        version: testers.version,
        createdAt: testers.createdAt,
        updatedAt: testers.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) conditions.push(condition);
        }
      }

      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [testers.name], testers.tags);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(testers, whereCondition);

      const testerList = await db.query.testers.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(testers.createdAt)],
        limit,
        offset,
      });

      return testerListResponseSchema.parse({ items: testerList, total, offset, limit });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list testers');
      throw error;
    }
  }

  /**
   * Updates a tester using optimistic locking to prevent concurrent modifications
   * @param projectId - The project the tester belongs to
   * @param id - The unique identifier of the tester to update
   * @param input - Tester update data including version
   * @param context - Request context for auditing and authorization
   * @returns The updated tester
   * @throws {NotFoundError} When tester is not found
   * @throws {OptimisticLockError} When the version doesn't match
   */
  async updateTester(projectId: string, id: string, input: UpdateTesterRequest, context: RequestContext): Promise<TesterResponse> {
    this.requirePermission(context, PERMISSIONS.TESTER_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ testerId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating tester');

    try {
      const existing = await db.query.testers.findFirst({ where: and(eq(testers.projectId, projectId), eq(testers.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Tester with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Tester version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: any = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.description !== undefined) updatePayload.description = updateData.description;
      if (updateData.prompt !== undefined) updatePayload.prompt = updateData.prompt;
      if (updateData.hangUpPrompt !== undefined) updatePayload.hangUpPrompt = updateData.hangUpPrompt;
      if (updateData.llmProviderId !== undefined) updatePayload.llmProviderId = updateData.llmProviderId;
      if (updateData.llmSettings !== undefined) updatePayload.llmSettings = updateData.llmSettings;
      if (updateData.userProfile !== undefined) updatePayload.userProfile = updateData.userProfile;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updated = await db.update(testers).set(updatePayload).where(and(eq(testers.projectId, projectId), eq(testers.id, id), eq(testers.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update tester due to version conflict`);
      }

      const tester = updated[0];

      await this.auditService.logUpdate('tester', tester.id, existing, tester, context?.operatorId);

      logger.info({ testerId: tester.id, newVersion: tester.version }, 'Tester updated successfully');

      return testerResponseSchema.parse(tester);
    } catch (error) {
      logger.error({ error, testerId: id }, 'Failed to update tester');
      throw error;
    }
  }

  /**
   * Deletes a tester using optimistic locking
   * @param projectId - The project the tester belongs to
   * @param id - The unique identifier of the tester to delete
   * @param expectedVersion - The expected version for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When tester is not found
   * @throws {OptimisticLockError} When the version doesn't match
   */
  async deleteTester(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.TESTER_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ testerId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting tester');

    try {
      const existing = await db.query.testers.findFirst({ where: and(eq(testers.projectId, projectId), eq(testers.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Tester with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Tester version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(testers).where(and(eq(testers.projectId, projectId), eq(testers.id, id), eq(testers.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete tester due to version conflict`);
      }

      await this.auditService.logDelete('tester', id, existing, context?.operatorId, projectId);

      logger.info({ testerId: id }, 'Tester deleted successfully');
    } catch (error) {
      logger.error({ error, testerId: id }, 'Failed to delete tester');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific tester
   * @param id - The unique identifier of the tester
   * @param projectId - The project ID the tester belongs to
   * @returns Array of audit log entries for the tester
   */
  async getTesterAuditLogs(id: string, projectId: string): Promise<any[]> {
    logger.debug({ id, projectId }, 'Fetching audit logs for tester');

    try {
      return await this.auditService.getEntityAuditLogs('tester', id, projectId);
    } catch (error) {
      logger.error({ error, id, projectId }, 'Failed to fetch tester audit logs');
      throw error;
    }
  }
}
