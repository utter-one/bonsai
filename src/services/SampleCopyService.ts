import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc, sql } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { sampleCopies } from '../db/schema';
import type { CreateSampleCopyRequest, UpdateSampleCopyRequest, SampleCopyResponse, SampleCopyListResponse, CloneSampleCopyRequest } from '../http/contracts/sampleCopy';
import type { ListParams } from '../http/contracts/common';
import { sampleCopyResponseSchema, sampleCopyListResponseSchema } from '../http/contracts/sampleCopy';
import { AuditService } from './AuditService';
import { OptimisticLockError, NotFoundError, ConflictError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';
import { generateId, ID_PREFIXES } from '../utils/idGenerator';

/**
 * Service for managing sample copies with full CRUD operations and audit logging.
 * Sample copies hold a set of variant answers that the system can select from at runtime
 * based on a prompt trigger and configurable sampling method.
 */
@injectable()
export class SampleCopyService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new sample copy and logs the creation in the audit trail.
   * @param projectId - The project this sample copy belongs to
   * @param input - Sample copy creation data
   * @param context - Request context for auditing and authorization
   * @returns The created sample copy
   */
  async createSampleCopy(projectId: string, input: CreateSampleCopyRequest, context: RequestContext): Promise<SampleCopyResponse> {
    this.requirePermission(context, PERMISSIONS.SAMPLE_COPY_WRITE);
    await this.requireProjectNotArchived(projectId);
    const sampleCopyId = input.id ?? generateId(ID_PREFIXES.SAMPLE_COPY);
    logger.info({ sampleCopyId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating sample copy');

    try {
      const result = await db.insert(sampleCopies).values({ id: sampleCopyId, projectId, name: input.name, stages: input.stages ?? null, agents: input.agents ?? null, promptTrigger: input.promptTrigger, classifierOverrideId: input.classifierOverrideId ?? null, content: input.content, amount: input.amount ?? 1, samplingMethod: input.samplingMethod ?? 'random', mode: input.mode ?? 'regular', decoratorId: input.decoratorId ?? null, version: 1 }).returning();

      const created = result[0];

      await this.auditService.logCreate('sample_copy', created.id, created, context?.operatorId);

      logger.info({ sampleCopyId: created.id }, 'Sample copy created successfully');

      return sampleCopyResponseSchema.parse(created);
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') {
        throw new ConflictError(`A sample copy named '${input.name}' already exists in this project`);
      }
      logger.error({ error, sampleCopyId: input.id }, 'Failed to create sample copy');
      throw error;
    }
  }

  /**
   * Retrieves a sample copy by its unique identifier.
   * @param projectId - The project this sample copy belongs to
   * @param id - The unique identifier of the sample copy
   * @returns The sample copy if found
   * @throws {NotFoundError} When sample copy is not found
   */
  async getSampleCopyById(projectId: string, id: string): Promise<SampleCopyResponse> {
    logger.debug({ sampleCopyId: id, projectId }, 'Fetching sample copy by ID');

    try {
      const sampleCopy = await db.query.sampleCopies.findFirst({ where: and(eq(sampleCopies.projectId, projectId), eq(sampleCopies.id, id)) });

      if (!sampleCopy) {
        throw new NotFoundError(`Sample copy with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return sampleCopyResponseSchema.parse({ ...sampleCopy, archived });
    } catch (error) {
      logger.error({ error, sampleCopyId: id }, 'Failed to fetch sample copy');
      throw error;
    }
  }

  /**
   * Lists sample copies with flexible filtering, sorting, and pagination.
   * @param projectId - The project to list sample copies for
   * @param params - List parameters including filters, sorting, and pagination
   * @returns Paginated array of sample copies matching the criteria
   */
  async listSampleCopies(projectId: string, params?: ListParams): Promise<SampleCopyListResponse> {
    logger.debug({ projectId, params }, 'Listing sample copies');

    try {
      const conditions: SQL[] = [eq(sampleCopies.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: sampleCopies.id,
        projectId: sampleCopies.projectId,
        name: sampleCopies.name,
        samplingMethod: sampleCopies.samplingMethod,
        amount: sampleCopies.amount,
        version: sampleCopies.version,
        createdAt: sampleCopies.createdAt,
        updatedAt: sampleCopies.updatedAt,
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
        const searchCondition = buildTextSearchCondition(params.textSearch, [sampleCopies.name, sampleCopies.promptTrigger], undefined);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(sampleCopies, whereCondition);

      const list = await db.query.sampleCopies.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(sampleCopies.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return sampleCopyListResponseSchema.parse({
        items: list.map(s => ({ ...s, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, projectId, params }, 'Failed to list sample copies');
      throw error;
    }
  }

  /**
   * Updates a sample copy using optimistic locking to prevent concurrent modifications.
   * @param projectId - The project this sample copy belongs to
   * @param id - The unique identifier of the sample copy to update
   * @param input - Sample copy update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated sample copy
   * @throws {NotFoundError} When sample copy is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateSampleCopy(projectId: string, id: string, input: UpdateSampleCopyRequest, context: RequestContext): Promise<SampleCopyResponse> {
    this.requirePermission(context, PERMISSIONS.SAMPLE_COPY_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ sampleCopyId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating sample copy');

    try {
      const existing = await db.query.sampleCopies.findFirst({ where: and(eq(sampleCopies.projectId, projectId), eq(sampleCopies.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Sample copy with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Sample copy version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: any = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.stages !== undefined) updatePayload.stages = updateData.stages;
      if (updateData.agents !== undefined) updatePayload.agents = updateData.agents;
      if (updateData.promptTrigger !== undefined) updatePayload.promptTrigger = updateData.promptTrigger;
      if (updateData.classifierOverrideId !== undefined) updatePayload.classifierOverrideId = updateData.classifierOverrideId;
      if (updateData.content !== undefined) updatePayload.content = updateData.content;
      if (updateData.amount !== undefined) updatePayload.amount = updateData.amount;
      if (updateData.samplingMethod !== undefined) updatePayload.samplingMethod = updateData.samplingMethod;
      if (updateData.mode !== undefined) updatePayload.mode = updateData.mode;
      if (updateData.decoratorId !== undefined) updatePayload.decoratorId = updateData.decoratorId;

      const updated = await db.update(sampleCopies).set(updatePayload).where(and(eq(sampleCopies.projectId, projectId), eq(sampleCopies.id, id), eq(sampleCopies.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update sample copy due to version conflict`);
      }

      const sampleCopy = updated[0];

      await this.auditService.logUpdate('sample_copy', sampleCopy.id, existing, sampleCopy, context?.operatorId, projectId);

      logger.info({ sampleCopyId: sampleCopy.id, newVersion: sampleCopy.version }, 'Sample copy updated successfully');

      return sampleCopyResponseSchema.parse(sampleCopy);
    } catch (error: any) {
      if (error?.code === '23505' || error?.cause?.code === '23505') {
        throw new ConflictError(`A sample copy named '${updateData.name}' already exists in this project`);
      }
      logger.error({ error, sampleCopyId: id }, 'Failed to update sample copy');
      throw error;
    }
  }

  /**
   * Deletes a sample copy using optimistic locking to prevent concurrent modifications.
   * @param projectId - The project this sample copy belongs to
   * @param id - The unique identifier of the sample copy to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When sample copy is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteSampleCopy(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.SAMPLE_COPY_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ sampleCopyId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting sample copy');

    try {
      const existing = await db.query.sampleCopies.findFirst({ where: and(eq(sampleCopies.projectId, projectId), eq(sampleCopies.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Sample copy with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Sample copy version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(sampleCopies).where(and(eq(sampleCopies.projectId, projectId), eq(sampleCopies.id, id), eq(sampleCopies.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete sample copy due to version conflict`);
      }

      await this.auditService.logDelete('sample_copy', id, existing, context?.operatorId, projectId);

      logger.info({ sampleCopyId: id }, 'Sample copy deleted successfully');
    } catch (error) {
      logger.error({ error, sampleCopyId: id }, 'Failed to delete sample copy');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing sample copy with a new ID and optional name override.
   * @param projectId - The project this sample copy belongs to
   * @param id - The unique identifier of the sample copy to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned sample copy
   * @throws {NotFoundError} When the source sample copy is not found
   */
  async cloneSampleCopy(projectId: string, id: string, input: CloneSampleCopyRequest, context: RequestContext): Promise<SampleCopyResponse> {
    this.requirePermission(context, PERMISSIONS.SAMPLE_COPY_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ sampleCopyId: id, operatorId: context?.operatorId }, 'Cloning sample copy');

    try {
      const existing = await db.query.sampleCopies.findFirst({ where: and(eq(sampleCopies.projectId, projectId), eq(sampleCopies.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Sample copy with id ${id} not found`);
      }

      return await this.createSampleCopy(projectId, { id: input.id, name: input.name ?? `${existing.name} (Clone)`, stages: existing.stages as string[] ?? undefined, agents: existing.agents as string[] ?? undefined, promptTrigger: existing.promptTrigger, classifierOverrideId: existing.classifierOverrideId ?? undefined, content: existing.content as string[], amount: existing.amount, samplingMethod: existing.samplingMethod as 'random' | 'round_robin', mode: existing.mode as 'regular' | 'forced', decoratorId: existing.decoratorId ?? undefined }, context);
    } catch (error) {
      logger.error({ error, sampleCopyId: id }, 'Failed to clone sample copy');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific sample copy.
   * @param sampleCopyId - The unique identifier of the sample copy
   * @param projectId - The project ID the sample copy belongs to
   * @returns Array of audit log entries for the sample copy
   */
  async getSampleCopyAuditLogs(sampleCopyId: string, projectId: string): Promise<any[]> {
    logger.debug({ sampleCopyId, projectId }, 'Fetching audit logs for sample copy');

    try {
      return await this.auditService.getEntityAuditLogs('sample_copy', sampleCopyId, projectId);
    } catch (error) {
      logger.error({ error, sampleCopyId, projectId }, 'Failed to fetch sample copy audit logs');
      throw error;
    }
  }
}
