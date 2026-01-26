import 'reflect-metadata';
import { JsonController, Get, Delete, Param, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../../permissions';
import type { Request } from 'express';
import { ConversationService } from '../../services/ConversationService';
import { conversationResponseSchema, conversationListResponseSchema, conversationEventResponseSchema, conversationEventListResponseSchema } from '../contracts/conversation';
import { listParamsSchema } from '../contracts/common';
import type { ListParams } from '../contracts/common';

/**
 * Controller for conversation management with decorator-based routing
 * Note: Create operation is not exposed as it is reserved for other modules
 */
@injectable()
@JsonController('/api/conversations')
export class ConversationController {
  constructor(@inject(ConversationService) private readonly conversationService: ConversationService) {}

  /**
   * GET /api/conversations/:id
   * Get a conversation by ID
   */
  @OpenAPI({
    tags: ['Conversations'],
    summary: 'Get conversation by ID',
    description: 'Retrieves a single conversation by its unique identifier',
    responses: {
      200: {
        description: 'Conversation retrieved successfully',
        content: {
          'application/json': {
            schema: conversationResponseSchema,
          },
        },
      },
      404: { description: 'Conversation not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.CONVERSATION_READ])
  @Get('/:id')
  async getConversationById(@Param('id') id: string) {
    return await this.conversationService.getConversationById(id);
  }

  /**
   * GET /api/conversations
   * List conversations with optional filters
   */
  @OpenAPI({
    tags: ['Conversations'],
    summary: 'List conversations',
    description: 'Retrieves a paginated list of conversations with optional filtering, sorting, and search. Supports filtering by userId, clientId, stageId, status, and timestamps.',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of conversations retrieved successfully',
        content: {
          'application/json': {
            schema: conversationListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @RequirePermissions([PERMISSIONS.CONVERSATION_READ])
  @Get('/')
  async listConversations(@Validated(listParamsSchema, 'query') @Req() req: Request) {
    return await this.conversationService.listConversations(req.query as unknown as ListParams);
  }

  /**
   * DELETE /api/conversations/:id
   * Delete a conversation
   */
  @OpenAPI({
    tags: ['Conversations'],
    summary: 'Delete conversation',
    description: 'Deletes a conversation and all its associated events (via cascade delete)',
    responses: {
      204: { description: 'Conversation deleted successfully' },
      404: { description: 'Conversation not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.CONVERSATION_DELETE])
  @Delete('/:id')
  @HttpCode(204)
  async deleteConversation(@Param('id') id: string, @Req() req: Request) {
    await this.conversationService.deleteConversation(id, req.context);
  }

  /**
   * GET /api/conversations/:id/events
   * List all events for a specific conversation
   */
  @OpenAPI({
    tags: ['Conversations'],
    summary: 'List conversation events',
    description: 'Retrieves a paginated list of events for a specific conversation with optional filtering and sorting',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of conversation events retrieved successfully',
        content: {
          'application/json': {
            schema: conversationEventListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
      404: { description: 'Conversation not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.CONVERSATION_READ])
  @Get('/:id/events')
  async getConversationEvents(@Param('id') id: string, @Validated(listParamsSchema, 'query') @Req() req: Request) {
    return await this.conversationService.getConversationEvents(id, req.query as unknown as ListParams);
  }

  /**
   * GET /api/conversations/:id/events/:eventId
   * Get a specific event by ID
   */
  @OpenAPI({
    tags: ['Conversations'],
    summary: 'Get conversation event by ID',
    description: 'Retrieves a specific event for a conversation by its unique identifier',
    responses: {
      200: {
        description: 'Conversation event retrieved successfully',
        content: {
          'application/json': {
            schema: conversationEventResponseSchema,
          },
        },
      },
      404: { description: 'Conversation or event not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.CONVERSATION_READ])
  @Get('/:id/events/:eventId')
  async getConversationEventById(@Param('id') id: string, @Param('eventId') eventId: string) {
    return await this.conversationService.getConversationEventById(id, eventId);
  }

  /**
   * GET /api/conversations/:id/audit-logs
   * Get audit logs for a conversation
   */
  @OpenAPI({
    tags: ['Conversations'],
    summary: 'Get conversation audit logs',
    description: 'Retrieves audit logs for a specific conversation',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Conversation not found' },
    },
  })
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @Get('/:id/audit-logs')
  async getConversationAuditLogs(@Param('id') id: string) {
    return await this.conversationService.getConversationAuditLogs(id);
  }
}
