import { injectable, inject } from 'tsyringe';
import { eq, and, or } from 'drizzle-orm';
import { db } from '../../db/index';
import { savedFunnelQueries } from '../../db/schema';
import { AuditService } from '../AuditService';
import { BaseService } from '../BaseService';
import type { RequestContext } from '../RequestContext';
import { PERMISSIONS } from '../../permissions';
import { NotFoundError, OptimisticLockError, ConflictError, ForbiddenError } from '../../errors';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import { logger } from '../../utils/logger';
import type { CreateSavedFunnelQueryRequest, UpdateSavedFunnelQueryRequest, SavedFunnelQueryResponse } from '../../http/contracts/funnels';
import { savedFunnelQueryResponseSchema } from '../../http/contracts/funnels';

/**
 * Service for managing saved funnel queries.
 * Operators can save named FunnelQuery configurations per project for later reuse.
 * Queries are personal by default and can be shared with all operators via the isShared flag.
 */
@injectable()
export class SavedFunnelQueryService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Lists saved funnel queries visible to the current operator.
   * Returns the operator's own queries plus any queries shared by other operators, sorted by updatedAt descending.
   * @param projectId - Project to list queries for
   * @param context - Request context for authorization
   */
  async list(projectId: string, context: RequestContext): Promise<SavedFunnelQueryResponse[]> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    logger.debug({ projectId, operatorId: context.operatorId }, 'Listing saved funnel queries');

    const rows = await db.query.savedFunnelQueries.findMany({
      where: and(
        eq(savedFunnelQueries.projectId, projectId),
        or(
          eq(savedFunnelQueries.operatorId, context.operatorId),
          eq(savedFunnelQueries.isShared, true),
        ),
      ),
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    return rows.map((row) => savedFunnelQueryResponseSchema.parse(row));
  }

  /**
   * Creates a new saved funnel query for the current operator.
   * @param projectId - Project to create the query in
   * @param input - Query data including name, query config, and sharing flag
   * @param context - Request context for authorization and auditing
   * @throws {ConflictError} When a query with the same name already exists in the project
   */
  async create(projectId: string, input: CreateSavedFunnelQueryRequest, context: RequestContext): Promise<SavedFunnelQueryResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    const id = generateId(ID_PREFIXES.SAVED_FUNNEL_QUERY);
    logger.info({ id, projectId, name: input.name, operatorId: context.operatorId }, 'Creating saved funnel query');

    try {
      const rows = await db.insert(savedFunnelQueries).values({
        id,
        projectId,
        operatorId: context.operatorId,
        name: input.name,
        query: input.query as Record<string, any>,
        isShared: input.isShared ?? false,
        version: 1,
      }).returning();

      const created = rows[0];
      await this.auditService.logCreate('saved_funnel_query', created.id, created, context.operatorId, projectId);
      logger.info({ id: created.id }, 'Saved funnel query created successfully');
      return savedFunnelQueryResponseSchema.parse(created);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictError(`A saved funnel query named '${input.name}' already exists in this project`);
      }
      logger.error({ error, id, projectId }, 'Failed to create saved funnel query');
      throw error;
    }
  }

  /**
   * Updates an existing saved funnel query with optimistic locking.
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
  async update(id: string, projectId: string, input: UpdateSavedFunnelQueryRequest, context: RequestContext): Promise<SavedFunnelQueryResponse> {
    this.requirePermission(context, PERMISSIONS.ANALYTICS_READ);
    const { version: expectedVersion, ...updateData } = input;
    logger.info({ id, projectId, expectedVersion, operatorId: context.operatorId }, 'Updating saved funnel query');

    try {
      const existing = await this.findVisible(id, projectId, context);
      this.checkOwnership(existing, context);

      if (existing.version !== expectedVersion) {
        throw new OptimisticLockError(`Saved funnel query version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
      }

      const updatePayload: Record<string, any> = { version: existing.version + 1, updatedAt: new Date() };
      if (updateData.name !== undefined) updatePayload.name = updateData.name;
      if (updateData.query !== undefined) updatePayload.query = updateData.query;
      if (updateData.isShared !== undefined) updatePayload.isShared = updateData.isShared;

      const updated = await db.update(savedFunnelQueries).set(updatePayload).where(and(eq(savedFunnelQueries.projectId, projectId), eq(savedFunnelQueries.id, id), eq(savedFunnelQueries.version, expectedVersion))).returning();

      if (updated.length === 0) {
        throw new OptimisticLockError(`Failed to update saved funnel query due to version conflict`);
      }

      const row = updated[0];
      await this.auditService.logUpdate('saved_funnel_query', row.id, existing, row, context.operatorId, projectId);
      logger.info({ id: row.id, newVersion: row.version }, 'Saved funnel query updated successfully');
      return savedFunnelQueryResponseSchema.parse(row);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new ConflictError(`A saved funnel query named '${updateData.name}' already exists in this project`);
      }
      logger.error({ error, id, projectId }, 'Failed to update saved funnel query');
      throw error;
    }
  }

  /**
   * Deletes a saved funnel query with optimistic locking.
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
    logger.info({ id, projectId, expectedVersion, operatorId: context.operatorId }, 'Deleting saved funnel query');

    const existing = await this.findVisible(id, projectId, context);
    this.checkOwnership(existing, context);

    if (existing.version !== expectedVersion) {
      throw new OptimisticLockError(`Saved funnel query version mismatch. Expected ${expectedVersion}, got ${existing.version}`);
    }

    const deleted = await db.delete(savedFunnelQueries).where(and(eq(savedFunnelQueries.projectId, projectId), eq(savedFunnelQueries.id, id), eq(savedFunnelQueries.version, expectedVersion))).returning({ id: savedFunnelQueries.id });

    if (deleted.length === 0) {
      throw new OptimisticLockError(`Failed to delete saved funnel query due to version conflict`);
    }

    await this.auditService.logDelete('saved_funnel_query', id, existing, context.operatorId, projectId);
    logger.info({ id }, 'Saved funnel query deleted successfully');
  }

  private async findVisible(id: string, projectId: string, context: RequestContext): Promise<any> {
    const row = await db.query.savedFunnelQueries.findFirst({
      where: and(
        eq(savedFunnelQueries.id, id),
        eq(savedFunnelQueries.projectId, projectId),
        or(
          eq(savedFunnelQueries.operatorId, context.operatorId),
          eq(savedFunnelQueries.isShared, true),
        ),
      ),
    });

    if (!row) {
      throw new NotFoundError(`Saved funnel query '${id}' not found`);
    }
    return row;
  }

  private checkOwnership(row: any, context: RequestContext): void {
    const isSuperAdmin = context.roles.includes('super_admin');
    if (row.operatorId !== context.operatorId && !isSuperAdmin) {
      throw new ForbiddenError('Only the owner or a super_admin can modify this saved funnel query');
    }
  }
}
