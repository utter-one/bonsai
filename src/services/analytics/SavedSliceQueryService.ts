import { injectable, inject } from 'tsyringe';
import { eq, and, or } from 'drizzle-orm';
import { db } from '../../db/index';
import { savedSliceQueries } from '../../db/schema';
import { AuditService } from '../AuditService';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { NotFoundError, OptimisticLockError, ConflictError, ForbiddenError } from '../../errors';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import { logger } from '../../utils/logger';
import type { CreateSavedSliceQueryRequest, UpdateSavedSliceQueryRequest, SavedSliceQueryResponse } from '../../http/contracts/savedSliceQuery';
import { savedSliceQueryResponseSchema } from '../../http/contracts/savedSliceQuery';

/**
 * Service for managing saved slice queries.
 * Operators can save named SliceQuery configurations per project for later reuse.
 * Queries are personal by default and can be shared with all operators via the isShared flag.
 */
@injectable()
export class SavedSliceQueryService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Lists saved slice queries visible to the current operator.
   * Returns the operator's own queries plus any queries shared by other operators.
   * @param projectId - Project to list queries for
   * @param context - Request context for authorization
   */
  async list(projectId: string, context: RequestContext): Promise<SavedSliceQueryResponse[]> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    logger.debug({ projectId, operatorId: context.operatorId }, 'Listing saved slice queries');

    const rows = await db.query.savedSliceQueries.findMany({
      where: and(
        eq(savedSliceQueries.projectId, projectId),
        or(
          eq(savedSliceQueries.operatorId, context.operatorId),
          eq(savedSliceQueries.isShared, true),
        ),
      ),
    });

    return rows.map((row) => savedSliceQueryResponseSchema.parse(row));
  }

  /**
   * Creates a new saved slice query for the current operator.
   * @param projectId - Project to create the query in
   * @param input - Query data including name, query config, and sharing flag
   * @param context - Request context for authorization and auditing
   * @throws {ConflictError} When a query with the same name already exists in the project
   */
  async create(projectId: string, input: CreateSavedSliceQueryRequest, context: RequestContext): Promise<SavedSliceQueryResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    const id = generateId(ID_PREFIXES.SAVED_SLICE_QUERY);
    logger.info({ id, projectId, name: input.name, operatorId: context.operatorId }, 'Creating saved slice query');

    try {
      const rows = await db.insert(savedSliceQueries).values({
        id,
        projectId,
        operatorId: context.operatorId,
        name: input.name,
        query: input.query as Record<string, any>,
        isShared: input.isShared ?? false,
        version: 1,
      }).returning();

      const created = rows[0];
      await this.auditService.logCreate('saved_slice_query', created.id, created, context.operatorId, projectId);
      logger.info({ id: created.id }, 'Saved slice query created successfully');
      return savedSliceQueryResponseSchema.parse(created);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictError(`A saved query named '${input.name}' already exists in this project`);
      }
      logger.error({ error, id, projectId }, 'Failed to create saved slice query');
      throw error;
    }
  }

  /**
   * Updates an existing saved slice query with optimistic locking.
   * Only the owning operator or a super_admin may update a query.
   * @param id - Saved query identifier
   * @param projectId - Project the query belongs to
   * @param input - Fields to update plus the current version for optimistic locking
   * @param context - Request context for authorization and auditing
   * @throws {NotFoundError} When the query is not found or not visible to the caller
   * @throws {ForbiddenError} When the caller is not the owner or a super_admin
   * @throws {OptimisticLockError} When the provided version does not match
   * @throws {ConflictError} When the new name conflicts with an existing query in the project
   */
  async update(id: string, projectId: string, input: UpdateSavedSliceQueryRequest, context: RequestContext): Promise<SavedSliceQueryResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ id, projectId, expectedVersion, operatorId: context.operatorId }, 'Updating saved slice query');

    try {
      const existing = await this.findVisible(id, projectId, context);
      this.checkOwnership(existing, context);

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Saved slice query version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: Record<string, any> = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.query !== undefined) updatePayload.query = updateData.query;
      if (updateData.isShared !== undefined) updatePayload.isShared = updateData.isShared;

      const updated = await db.update(savedSliceQueries).set(updatePayload).where(and(eq(savedSliceQueries.projectId, projectId), eq(savedSliceQueries.id, id), eq(savedSliceQueries.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update saved slice query due to version conflict`);
      }

      const row = updated[0];
      await this.auditService.logUpdate('saved_slice_query', row.id, existing, row, context.operatorId, projectId);
      logger.info({ id: row.id, newVersion: row.version }, 'Saved slice query updated successfully');
      return savedSliceQueryResponseSchema.parse(row);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictError(`A saved query named '${updateData.name}' already exists in this project`);
      }
      logger.error({ error, id, projectId }, 'Failed to update saved slice query');
      throw error;
    }
  }

  /**
   * Deletes a saved slice query with optimistic locking.
   * Only the owning operator or a super_admin may delete a query.
   * @param id - Saved query identifier
   * @param projectId - Project the query belongs to
   * @param expectedVersion - Expected version for optimistic locking
   * @param context - Request context for authorization and auditing
   * @throws {NotFoundError} When the query is not found or not visible to the caller
   * @throws {ForbiddenError} When the caller is not the owner or a super_admin
   * @throws {OptimisticLockError} When the provided version does not match
   */
  async delete(id: string, projectId: string, expectedVersion: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    logger.info({ id, projectId, expectedVersion, operatorId: context.operatorId }, 'Deleting saved slice query');

    try {
      const existing = await this.findVisible(id, projectId, context);
      this.checkOwnership(existing, context);

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Saved slice query version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const deleted = await db.delete(savedSliceQueries).where(and(eq(savedSliceQueries.projectId, projectId), eq(savedSliceQueries.id, id), eq(savedSliceQueries.version, expectedVersion))).returning();

      if (deleted.length === 0) {
        throw new OptimisticLockError(`Failed to delete saved slice query due to version conflict`);
      }

      await this.auditService.logDelete('saved_slice_query', id, existing, context.operatorId, projectId);
      logger.info({ id }, 'Saved slice query deleted successfully');
    } catch (error) {
      logger.error({ error, id, projectId }, 'Failed to delete saved slice query');
      throw error;
    }
  }

  /**
   * Fetches a query that is either owned by the operator or shared, scoped to the project.
   * @throws {NotFoundError} When not found or not visible to the caller
   */
  private async findVisible(id: string, projectId: string, context: RequestContext) {
    const row = await db.query.savedSliceQueries.findFirst({
      where: and(
        eq(savedSliceQueries.id, id),
        eq(savedSliceQueries.projectId, projectId),
        or(
          eq(savedSliceQueries.operatorId, context.operatorId),
          eq(savedSliceQueries.isShared, true),
        ),
      ),
    });

    if (!row) {
      throw new NotFoundError(`Saved slice query with id ${id} not found`);
    }

    return row;
  }

  /**
   * Asserts that the context operator owns the query or is a super_admin.
   * @throws {ForbiddenError} When neither condition is met
   */
  private checkOwnership(row: { operatorId: string | null }, context: RequestContext): void {
    const isSuperAdmin = context.roles.includes('super_admin');
    const isOwner = row.operatorId === context.operatorId;
    if (!isOwner && !isSuperAdmin) {
      throw new ForbiddenError('You do not have permission to modify this saved query');
    }
  }
}
