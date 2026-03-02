import { injectable, inject } from 'tsyringe';
import { eq, and, like, SQL, desc } from 'drizzle-orm';
import { db } from '../db/index';
import { issues } from '../db/schema';
import type { CreateIssueRequest, UpdateIssueRequest, IssueResponse, IssueListResponse } from '../http/contracts/issue';
import type { ListParams } from '../http/contracts/common';
import { issueResponseSchema, issueListResponseSchema } from '../http/contracts/issue';
import { AuditService } from './AuditService';
import { NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { logger } from '../utils/logger';
import { BaseService } from './BaseService';
import type { RequestContext } from './RequestContext';
import { PERMISSIONS } from '../permissions';

/**
 * Service for managing issues with full CRUD operations and audit logging
 */
@injectable()
export class IssueService extends BaseService {
  constructor(@inject(AuditService) private readonly auditService: AuditService) {
    super();
  }

  /**
   * Creates a new issue and logs the creation in the audit trail
   * @param input - Issue creation data including environment, buildVersion, severity, etc.
   * @param context - Request context for auditing and authorization
   * @returns The created issue
   */
  async createIssue(projectId: string, input: CreateIssueRequest, context: RequestContext): Promise<IssueResponse> {
    this.requirePermission(context, PERMISSIONS.ISSUE_WRITE);
    logger.info({ projectId, environment: input.environment, severity: input.severity, adminId: context?.adminId }, 'Creating issue');

    try {
      const issue = await db.insert(issues).values({ projectId, environment: input.environment, buildVersion: input.buildVersion, beat: input.beat, sessionId: input.sessionId, eventIndex: input.eventIndex, userId: input.userId, severity: input.severity, category: input.category, bugDescription: input.bugDescription, expectedBehaviour: input.expectedBehaviour, comments: input.comments ?? '', status: input.status }).returning();

      const createdIssue = issue[0];

      await this.auditService.logCreate('issue', String(createdIssue.id), { id: createdIssue.id, projectId: createdIssue.projectId, environment: createdIssue.environment, buildVersion: createdIssue.buildVersion, severity: createdIssue.severity, category: createdIssue.category, status: createdIssue.status }, context?.adminId);

      logger.info({ issueId: createdIssue.id }, 'Issue created successfully');

      return issueResponseSchema.parse(createdIssue);
    } catch (error) {
      logger.error({ error, input }, 'Failed to create issue');
      throw error;
    }
  }

  /**
   * Retrieves an issue by its unique identifier
   * @param id - The unique identifier of the issue
   * @returns The issue if found
   * @throws {NotFoundError} When issue is not found
   */
  async getIssueById(projectId: string, id: number): Promise<IssueResponse> {
    logger.debug({ issueId: id }, 'Fetching issue by ID');

    try {
      const issue = await db.query.issues.findFirst({ where: and(eq(issues.projectId, projectId), eq(issues.id, id)) });

      if (!issue) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      return issueResponseSchema.parse(issue);
    } catch (error) {
      logger.error({ error, issueId: id }, 'Failed to fetch issue');
      throw error;
    }
  }

  /**
   * Lists issues with flexible filtering, sorting, and pagination
   * @param params - List parameters including filters, sorting, pagination, and text search
   * @returns Paginated array of issues matching the criteria
   */
  async listIssues(projectId: string, params?: ListParams): Promise<IssueListResponse> {
    logger.debug({ params }, 'Listing issues');

    try {
      const conditions: SQL[] = [eq(issues.projectId, projectId)];
      const offset = params?.offset ?? 0;
      const limit = params?.limit ?? null;

      // Column map for filter and order by operations
      const columnMap = {
        id: issues.id,
        projectId: issues.projectId,
        environment: issues.environment,
        buildVersion: issues.buildVersion,
        beat: issues.beat,
        sessionId: issues.sessionId,
        eventIndex: issues.eventIndex,
        userId: issues.userId,
        severity: issues.severity,
        category: issues.category,
        status: issues.status,
        createdAt: issues.createdAt,
        updatedAt: issues.updatedAt,
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

      // Apply text search (searches bugDescription, expectedBehaviour, comments, category)
      if (params?.textSearch) {
        const searchTerm = `%${params.textSearch}%`;
        conditions.push(like(issues.bugDescription, searchTerm));
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);

      // Get total count
      const totalResult = await db.query.issues.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
      });
      const total = totalResult.length;

      // Get paginated results
      const issueList = await db.query.issues.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(issues.createdAt)],
        limit: limit ?? undefined,
        offset,
      });

      return issueListResponseSchema.parse({
        items: issueList,
        total,
        offset,
        limit,
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to list issues');
      throw error;
    }
  }

  /**
   * Updates an issue
   * @param id - The unique identifier of the issue to update
   * @param input - Issue update data
   * @param context - Request context for auditing and authorization
   * @returns The updated issue
   * @throws {NotFoundError} When issue is not found
   */
  async updateIssue(projectId: string, id: number, input: UpdateIssueRequest, context: RequestContext): Promise<IssueResponse> {
    this.requirePermission(context, PERMISSIONS.ISSUE_WRITE);
    logger.info({ issueId: id, adminId: context?.adminId }, 'Updating issue');

    try {
      const existingIssue = await db.query.issues.findFirst({ where: and(eq(issues.projectId, projectId), eq(issues.id, id)) });

      if (!existingIssue) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      const updatedIssue = await db.update(issues).set({ ...input, updatedAt: new Date() }).where(and(eq(issues.projectId, projectId), eq(issues.id, id))).returning();

      if (updatedIssue.length === 0) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      const issue = updatedIssue[0];

      await this.auditService.logUpdate('issue', String(issue.id), { id: existingIssue.id, environment: existingIssue.environment, severity: existingIssue.severity, status: existingIssue.status }, { id: issue.id, environment: issue.environment, severity: issue.severity, status: issue.status }, context?.adminId, projectId);

      logger.info({ issueId: issue.id }, 'Issue updated successfully');

      return issueResponseSchema.parse(issue);
    } catch (error) {
      logger.error({ error, issueId: id }, 'Failed to update issue');
      throw error;
    }
  }

  /**
   * Deletes an issue
   * @param id - The unique identifier of the issue to delete
   * @param context - Request context for auditing and authorization
   */
  async deleteIssue(projectId: string, id: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.ISSUE_DELETE);
    logger.info({ issueId: id, adminId: context?.adminId }, 'Deleting issue');

    try {
      const existingIssue = await db.query.issues.findFirst({ where: and(eq(issues.projectId, projectId), eq(issues.id, id)) });

      if (!existingIssue) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      const deleted = await db.delete(issues).where(and(eq(issues.projectId, projectId), eq(issues.id, id))).returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      await this.auditService.logDelete('issue', String(id), { id: existingIssue.id, environment: existingIssue.environment, severity: existingIssue.severity, status: existingIssue.status }, context?.adminId);

      logger.info({ issueId: id }, 'Issue deleted successfully');
    } catch (error) {
      logger.error({ error, issueId: id }, 'Failed to delete issue');
      throw error;
    }
  }

  /**
   * Retrieves all audit log entries for a specific issue
   * @param issueId - The unique identifier of the issue
   * @returns Array of audit log entries for the issue
   */
  async getIssueAuditLogs(issueId: number): Promise<any[]> {
    logger.debug({ issueId }, 'Fetching audit logs for issue');

    try {
      return await this.auditService.getEntityAuditLogs('issue', String(issueId));
    } catch (error) {
      logger.error({ error, issueId }, 'Failed to fetch issue audit logs');
      throw error;
    }
  }
}
