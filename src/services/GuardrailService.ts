import { injectable, inject } from 'tsyringe';
import { eq, and, SQL, desc, sql } from 'drizzle-orm';
import { buildTextSearchCondition } from '../utils/textSearch';
import { db } from '../db/index';
import { guardrails } from '../db/schema';
import type { CreateGuardrailRequest, UpdateGuardrailRequest, GuardrailResponse, GuardrailListResponse, CloneGuardrailRequest } from '../http/contracts/guardrail';
import type { ListParams } from '../http/contracts/common';
import { guardrailResponseSchema, guardrailListResponseSchema } from '../http/contracts/guardrail';
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
 * Service for managing guardrails with full CRUD operations and audit logging.
 * Guardrails are always-on behavior control actions that fire globally on every stage,
 * evaluated by the project-level guardrail classifier on every user input turn.
 */
@injectable()
export class GuardrailService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new guardrail and logs the creation in the audit trail.
   * @param projectId - The project to create the guardrail in
   * @param input - Guardrail creation data
   * @param context - Request context for auditing and authorization
   * @returns The created guardrail
   */
  async createGuardrail(projectId: string, input: CreateGuardrailRequest, context: RequestContext): Promise<GuardrailResponse> {
    this.requirePermission(context, PERMISSIONS.GUARDRAIL_WRITE);
    await this.requireProjectNotArchived(projectId);
    const guardrailId = input.id ?? generateId(ID_PREFIXES.GUARDRAIL);
    logger.info({ guardrailId, projectId, name: input.name, operatorId: context?.operatorId }, 'Creating guardrail');

    try {
      const guardrail = await db.insert(guardrails).values({ id: guardrailId, projectId, name: input.name, condition: input.condition ?? null, classificationTrigger: input.classificationTrigger ?? null, effects: input.effects ?? [], examples: input.examples ?? null, tags: input.tags ?? [], metadata: input.metadata ?? null, version: 1 }).returning();

      const created = guardrail[0];

      await this.auditService.logCreate('guardrail', created.id, { id: created.id, projectId: created.projectId, name: created.name, condition: created.condition, classificationTrigger: created.classificationTrigger, effects: created.effects, examples: created.examples, tags: created.tags, metadata: created.metadata }, context?.operatorId);

      logger.info({ guardrailId: created.id }, 'Guardrail created successfully');

      return guardrailResponseSchema.parse(created);
    } catch (error) {
      logger.error({ error, guardrailId: input.id }, 'Failed to create guardrail');
      throw error;
    }
  }

  /**
   * Retrieves a guardrail by its unique identifier.
   * @param projectId - The project the guardrail belongs to
   * @param id - The unique identifier of the guardrail
   * @returns The guardrail if found
   * @throws {NotFoundError} When guardrail is not found
   */
  async getGuardrailById(projectId: string, id: string): Promise<GuardrailResponse> {
    logger.debug({ guardrailId: id }, 'Fetching guardrail by ID');

    try {
      const guardrail = await db.query.guardrails.findFirst({ where: and(eq(guardrails.projectId, projectId), eq(guardrails.id, id)) });

      if (!guardrail) {
        throw new NotFoundError(`Guardrail with id ${id} not found`);
      }

      const archived = !(await this.isProjectActive(projectId));
      return guardrailResponseSchema.parse({ ...guardrail, archived });
    } catch (error) {
      logger.error({ error, guardrailId: id }, 'Failed to fetch guardrail');
      throw error;
    }
  }

  /**
   * Lists guardrails with flexible filtering, sorting, and pagination.
   * @param projectId - The project to list guardrails for
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of guardrails matching the criteria
   */
  async listGuardrails(projectId: string, params?: ListParams): Promise<GuardrailListResponse> {
    logger.debug({ params }, 'Listing guardrails');

    try {
      const conditions: SQL[] = [eq(guardrails.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      const columnMap = {
        id: guardrails.id,
        projectId: guardrails.projectId,
        name: guardrails.name,
        version: guardrails.version,
        createdAt: guardrails.createdAt,
        updatedAt: guardrails.updatedAt,
      };

      if (params?.filters) {
        for (const [field, filter] of Object.entries(params.filters)) {
          if (field === 'tags') {
            const tagsArray = Array.isArray(filter) ? filter as string[] : [filter as string];
            conditions.push(sql`${guardrails.tags} @> ${JSON.stringify(tagsArray)}::jsonb`);
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      if (params?.textSearch) {
        const searchCondition = buildTextSearchCondition(params.textSearch, [guardrails.name, guardrails.classificationTrigger, guardrails.condition], guardrails.tags);
        if (searchCondition) conditions.push(searchCondition);
      }

      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(guardrails, whereCondition);

      const guardrailList = await db.query.guardrails.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(guardrails.createdAt)],
        limit,
        offset,
      });

      const archived = !(await this.isProjectActive(projectId));
      return guardrailListResponseSchema.parse({
        items: guardrailList.map(g => ({ ...g, archived })),
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list guardrails');
      throw error;
    }
  }

  /**
   * Updates a guardrail using optimistic locking to prevent concurrent modifications.
   * @param projectId - The project the guardrail belongs to
   * @param id - The unique identifier of the guardrail to update
   * @param input - Guardrail update data (with version)
   * @param context - Request context for auditing and authorization
   * @returns The updated guardrail
   * @throws {NotFoundError} When guardrail is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async updateGuardrail(projectId: string, id: string, input: UpdateGuardrailRequest, context: RequestContext): Promise<GuardrailResponse> {
    this.requirePermission(context, PERMISSIONS.GUARDRAIL_WRITE);
    await this.requireProjectNotArchived(projectId);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ guardrailId: id, expectedVersion, operatorId: context?.operatorId }, 'Updating guardrail');

    try {
      const existing = await db.query.guardrails.findFirst({ where: and(eq(guardrails.projectId, projectId), eq(guardrails.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Guardrail with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Guardrail version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: any = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.condition !== undefined) updatePayload.condition = updateData.condition;
      if (updateData.classificationTrigger !== undefined) updatePayload.classificationTrigger = updateData.classificationTrigger;
      if (updateData.effects !== undefined) updatePayload.effects = updateData.effects;
      if (updateData.examples !== undefined) updatePayload.examples = updateData.examples;
      if (updateData.tags !== undefined) updatePayload.tags = updateData.tags;
      if (updateData.metadata !== undefined) updatePayload.metadata = updateData.metadata;

      const updated = await db.update(guardrails).set(updatePayload).where(and(eq(guardrails.projectId, projectId), eq(guardrails.id, id), eq(guardrails.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update guardrail due to version conflict`);
      }

      const guardrail = updated[0];

      await this.auditService.logUpdate('guardrail', guardrail.id, { id: existing.id, name: existing.name, condition: existing.condition, classificationTrigger: existing.classificationTrigger, effects: existing.effects, examples: existing.examples, tags: existing.tags, metadata: existing.metadata }, { id: guardrail.id, name: guardrail.name, condition: guardrail.condition, classificationTrigger: guardrail.classificationTrigger, effects: guardrail.effects, examples: guardrail.examples, tags: guardrail.tags, metadata: guardrail.metadata }, context?.operatorId, projectId);

      logger.info({ guardrailId: guardrail.id, newVersion: guardrail.version }, 'Guardrail updated successfully');

      return guardrailResponseSchema.parse(guardrail);
    } catch (error) {
      logger.error({ error, guardrailId: id }, 'Failed to update guardrail');
      throw error;
    }
  }

  /**
   * Deletes a guardrail using optimistic locking to prevent concurrent modifications.
   * @param projectId - The project the guardrail belongs to
   * @param id - The unique identifier of the guardrail to delete
   * @param expectedVersion - The expected version number for optimistic locking
   * @param context - Request context for auditing and authorization
   * @throws {NotFoundError} When guardrail is not found
   * @throws {OptimisticLockError} When the version doesn't match (concurrent modification detected)
   */
  async deleteGuardrail(projectId: string, id: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.GUARDRAIL_DELETE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ guardrailId: id, expectedVersion, operatorId: context?.operatorId }, 'Deleting guardrail');

    try {
      const existing = await db.query.guardrails.findFirst({ where: and(eq(guardrails.projectId, projectId), eq(guardrails.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Guardrail with id ${id} not found`);
      }

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Guardrail version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(guardrails).where(and(eq(guardrails.projectId, projectId), eq(guardrails.id, id), eq(guardrails.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete guardrail due to version conflict`);
      }

      await this.auditService.logDelete('guardrail', id, { id: existing.id, name: existing.name, condition: existing.condition, classificationTrigger: existing.classificationTrigger, effects: existing.effects, examples: existing.examples, tags: existing.tags, metadata: existing.metadata }, context?.operatorId, projectId);

      logger.info({ guardrailId: id }, 'Guardrail deleted successfully');
    } catch (error) {
      logger.error({ error, guardrailId: id }, 'Failed to delete guardrail');
      throw error;
    }
  }

  /**
   * Creates a copy of an existing guardrail with a new ID and optional name override.
   * @param projectId - The project the guardrail belongs to
   * @param id - The unique identifier of the guardrail to clone
   * @param input - Clone options including optional new id and name
   * @param context - Request context for auditing and authorization
   * @returns The newly created cloned guardrail
   * @throws {NotFoundError} When the source guardrail is not found
   */
  async cloneGuardrail(projectId: string, id: string, input: CloneGuardrailRequest, context: RequestContext): Promise<GuardrailResponse> {
    this.requirePermission(context, PERMISSIONS.GUARDRAIL_WRITE);
    await this.requireProjectNotArchived(projectId);
    logger.info({ id, operatorId: context?.operatorId }, 'Cloning guardrail');

    try {
      const existing = await db.query.guardrails.findFirst({ where: and(eq(guardrails.projectId, projectId), eq(guardrails.id, id)) });

      if (!existing) {
        throw new NotFoundError(`Guardrail with id ${id} not found`);
      }

      return await this.createGuardrail(projectId, { id: input.id, name: input.name ?? `${existing.name} (Clone)`, condition: existing.condition, classificationTrigger: existing.classificationTrigger, effects: existing.effects as any, examples: existing.examples as string[] ?? undefined, tags: existing.tags as string[], metadata: existing.metadata ?? undefined }, context);
    } catch (error) {
      logger.error({ error, id }, 'Failed to clone guardrail');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific guardrail.
   * @param guardrailId - The unique identifier of the guardrail
   * @returns Array of audit log entries for the guardrail
   */
  async getGuardrailAuditLogs(guardrailId: string): Promise<any[]> {
    logger.debug({ guardrailId }, 'Fetching audit logs for guardrail');

    try {
      return await this.auditService.getEntityAuditLogs('guardrail', guardrailId);
    } catch (error) {
      logger.error({ error, guardrailId }, 'Failed to fetch guardrail audit logs');
      throw error;
    }
  }
}
