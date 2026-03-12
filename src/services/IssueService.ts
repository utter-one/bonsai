import { injectable, inject } from 'tsyringe';
import { eq, ilike, or, inArray, and, SQL, desc, sql, notInArray } from 'drizzle-orm';
import { parseTextSearch } from '../utils/textSearch';
import { db } from '../db/index';
import { issues, projects, activeProjects, archivedProjects } from '../db/schema';
import type { CreateIssueRequest, UpdateIssueRequest, IssueResponse, IssueListResponse } from '../http/contracts/issue';
import type { ListParams } from '../http/contracts/common';
import { issueResponseSchema, issueListResponseSchema } from '../http/contracts/issue';
import { AuditService } from './AuditService';
import { NotFoundError } from '../errors';
import { buildFilterCondition, buildOrderBy } from '../utils/queryBuilder';
import { countRows, normalizeListLimit } from '../utils/pagination';
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
   * @param input - Issue creation data including projectId, environment, buildVersion, severity, etc.
   * @param context - Request context for auditing and authorization
   * @returns The created issue
   */
  async createIssue(input: CreateIssueRequest, context: RequestContext): Promise<IssueResponse> {
    this.requirePermission(context, PERMISSIONS.ISSUE_WRITE);
    await this.requireProjectNotArchived(input.projectId);
    logger.info({ projectId: input.projectId, environment: input.environment, severity: input.severity, operatorId: context?.operatorId }, 'Creating issue');

    try {
      const issue = await db.insert(issues).values({ projectId: input.projectId, environment: input.environment, buildVersion: input.buildVersion, stage: input.stage, sessionId: input.sessionId, eventIndex: input.eventIndex, userId: input.userId, severity: input.severity, category: input.category, bugDescription: input.bugDescription, expectedBehaviour: input.expectedBehaviour, comments: input.comments ?? '', status: input.status }).returning();

      const createdIssue = issue[0];

      await this.auditService.logCreate('issue', String(createdIssue.id), createdIssue, context?.operatorId);

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
  async getIssueById(id: number): Promise<IssueResponse> {
    logger.debug({ issueId: id }, 'Fetching issue by ID');

    try {
      const issue = await db.query.issues.findFirst({ where: eq(issues.id, id) });

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
   * @param params - List parameters including filters, sorting, pagination, and text search. Use filters.projectId to filter by project.
   *   Special filter: `filters.projectStatus` accepts `"active"` or `"archived"` to restrict issues to projects of that status.
   * @returns Paginated array of issues matching the criteria
   */
  async listIssues(params?: ListParams): Promise<IssueListResponse> {
    logger.debug({ params }, 'Listing issues');

    try {
      const conditions: SQL[] = [];
      const offset = params?.offset ?? 0;
      const limit = normalizeListLimit(params?.limit);

      // Column map for filter and order by operations
      const columnMap = {
        id: issues.id,
        projectId: issues.projectId,
        environment: issues.environment,
        buildVersion: issues.buildVersion,
        stage: issues.stage,
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
          if (field === 'projectStatus') {
            // Special virtual filter: restrict issues to projects of a given status
            const status = typeof filter === 'string' ? filter : null;
            if (status === 'active') {
              conditions.push(inArray(issues.projectId, db.select({ id: activeProjects.id }).from(activeProjects)));
            } else if (status === 'archived') {
              conditions.push(inArray(issues.projectId, db.select({ id: archivedProjects.id }).from(archivedProjects)));
            }
            continue;
          }
          const condition = buildFilterCondition(field, filter, columnMap, logger);
          if (condition) {
            conditions.push(condition);
          }
        }
      }

      // Apply text search (searches id, bugDescription, severity, category, status by ilike; project name via subquery)
      if (params?.textSearch) {
        const parsed = parseTextSearch(params.textSearch);
        if (parsed.type === 'text') {
          const searchTerm = `%${parsed.value}%`;
          const projectSubQuery = db.select({ id: projects.id }).from(projects).where(ilike(projects.name, searchTerm));
          conditions.push(or(sql`${issues.id}::text ilike ${searchTerm}`, ilike(issues.bugDescription, searchTerm), ilike(issues.severity, searchTerm), ilike(issues.category, searchTerm), ilike(issues.status, searchTerm), inArray(issues.projectId, projectSubQuery))!);
        }
      }

      // Build order by clause
      const orderByClause = buildOrderBy(params?.orderBy, columnMap);
      const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

      const total = await countRows(issues, whereCondition);

      // Get paginated results
      const issueList = await db.query.issues.findMany({
        where: whereCondition,
        orderBy: orderByClause.length > 0 ? orderByClause : [desc(issues.createdAt)],
        limit,
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
  async updateIssue(id: number, input: UpdateIssueRequest, context: RequestContext): Promise<IssueResponse> {
    this.requirePermission(context, PERMISSIONS.ISSUE_WRITE);
    logger.info({ issueId: id, operatorId: context?.operatorId }, 'Updating issue');

    try {
      const existingIssue = await db.query.issues.findFirst({ where: eq(issues.id, id) });

      if (!existingIssue) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      await this.requireProjectNotArchived(existingIssue.projectId);

      const updatedIssue = await db.update(issues).set({ ...input, updatedAt: new Date() }).where(eq(issues.id, id)).returning();

      if (updatedIssue.length === 0) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      const issue = updatedIssue[0];

      await this.auditService.logUpdate('issue', String(issue.id), existingIssue, issue, context?.operatorId, existingIssue.projectId);

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
  async deleteIssue(id: number, context: RequestContext): Promise<void> {
    this.requirePermission(context, PERMISSIONS.ISSUE_DELETE);
    logger.info({ issueId: id, operatorId: context?.operatorId }, 'Deleting issue');

    try {
      const existingIssue = await db.query.issues.findFirst({ where: eq(issues.id, id) });

      if (!existingIssue) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      const deleted = await db.delete(issues).where(eq(issues.id, id)).returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`Issue with id ${id} not found`);
      }

      await this.auditService.logDelete('issue', String(id), existingIssue, context?.operatorId, existingIssue.projectId);

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
