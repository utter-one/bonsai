import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../permissions';
import type { Request } from 'express';
import { IssueService } from '../services/IssueService';
import { createIssueSchema, updateIssueBodySchema, issueResponseSchema, issueListResponseSchema } from '../contracts/rest/issue';
import type { CreateIssueRequest, UpdateIssueRequest } from '../contracts/rest/issue';
import { listParamsSchema } from '../contracts/rest/common';
import type { ListParams } from '../contracts/rest/common';

/**
 * Controller for issue management with decorator-based routing
 */
@injectable()
@JsonController('/api/issues')
export class IssueController {
  constructor(@inject(IssueService) private readonly issueService: IssueService) {}

  /**
   * POST /api/issues
   * Create a new issue
   */
  @OpenAPI({
    tags: ['Issues'],
    summary: 'Create a new issue',
    description: 'Creates a new issue report with bug details, environment, and severity information',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createIssueSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Issue created successfully',
        content: {
          'application/json': {
            schema: issueResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
    },
  })
  @RequirePermissions([PERMISSIONS.ISSUE_WRITE])
  @Post('/')
  @HttpCode(201)
  async createIssue(@Validated(createIssueSchema) @Body() body: CreateIssueRequest, @Req() req: Request) {
    const issue = await this.issueService.createIssue(body, req.context);
    return issue;
  }

  /**
   * GET /api/issues/:id
   * Get an issue by ID
   */
  @OpenAPI({
    tags: ['Issues'],
    summary: 'Get issue by ID',
    description: 'Retrieves a single issue by its unique identifier',
    responses: {
      200: {
        description: 'Issue retrieved successfully',
        content: {
          'application/json': {
            schema: issueResponseSchema,
          },
        },
      },
      404: { description: 'Issue not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.ISSUE_READ])
  @Get('/:id')
  async getIssueById(@Param('id') id: string) {
    const issue = await this.issueService.getIssueById(parseInt(id, 10));
    return issue;
  }

  /**
   * GET /api/issues
   * List issues with optional filters
   */
  @OpenAPI({
    tags: ['Issues'],
    summary: 'List issues',
    description: 'Retrieves a paginated list of issues with optional filtering by status, severity, environment, and text search in bug descriptions',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of issues retrieved successfully',
        content: {
          'application/json': {
            schema: issueListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @RequirePermissions([PERMISSIONS.ISSUE_READ])
  @Get('/')
  async listIssues(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.issueService.listIssues(query);
  }

  /**
   * PUT /api/issues/:id
   * Update an issue
   */
  @OpenAPI({
    tags: ['Issues'],
    summary: 'Update issue',
    description: 'Updates an existing issue with new information, typically used to change status, add comments, or update severity',
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateIssueBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Issue updated successfully',
        content: {
          'application/json': {
            schema: issueResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Issue not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.ISSUE_WRITE])
  @Put('/:id')
  async updateIssue(@Param('id') id: string, @Validated(updateIssueBodySchema) @Body() body: UpdateIssueRequest, @Req() req: Request) {
    const issue = await this.issueService.updateIssue(parseInt(id, 10), body, req.context);
    return issue;
  }

  /**
   * DELETE /api/issues/:id
   * Delete an issue
   */
  @OpenAPI({
    tags: ['Issues'],
    summary: 'Delete issue',
    description: 'Deletes an issue from the system',
    responses: {
      204: { description: 'Issue deleted successfully' },
      404: { description: 'Issue not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.ISSUE_DELETE])
  @Delete('/:id')
  @HttpCode(204)
  async deleteIssue(@Param('id') id: string, @Req() req: Request) {
    await this.issueService.deleteIssue(parseInt(id, 10), req.context);
  }

  /**
   * GET /api/issues/:id/audit-logs
   * Get audit logs for an issue
   */
  @OpenAPI({
    tags: ['Issues'],
    summary: 'Get issue audit logs',
    description: 'Retrieves audit logs for a specific issue showing its change history',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Issue not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @Get('/:id/audit-logs')
  async getIssueAuditLogs(@Param('id') id: string) {
    return await this.issueService.getIssueAuditLogs(parseInt(id, 10));
  }
}
