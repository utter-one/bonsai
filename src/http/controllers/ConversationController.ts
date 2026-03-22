import { inject, singleton } from 'tsyringe';
import type { Request, Response, NextFunction, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { PERMISSIONS } from '../../permissions';
import { ConversationService } from '../../services/ConversationService';
import { conversationResponseSchema, conversationListResponseSchema, conversationEventResponseSchema, conversationEventListResponseSchema, conversationRouteParamsSchema, conversationEventRouteParamsSchema } from '../contracts/conversation';
import { listParamsSchema, projectScopedParamsSchema } from '../contracts/common';
import { checkPermissions } from '../../utils/permissions';
import { asyncHandler } from '../../utils/asyncHandler';

/**
 * Controller for conversation management with explicit routing
 * Note: Create operation is not exposed as it is reserved for other modules
 */
@singleton()
export class ConversationController {
  constructor(@inject(ConversationService) private readonly conversationService: ConversationService) {}

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'get',
        path: '/api/projects/{projectId}/conversations/{id}',
        tags: ['Conversations'],
        summary: 'Get conversation by ID',
        description: 'Retrieves a single conversation by its unique identifier',
        request: {
          params: conversationRouteParamsSchema,
        },
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
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/conversations',
        tags: ['Conversations'],
        summary: 'List conversations',
        description: 'Retrieves a paginated list of conversations with optional filtering, sorting, and search. Supports filtering by userId, sessionId, stageId, status, and timestamps.',
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
      },
      {
        method: 'delete',
        path: '/api/projects/{projectId}/conversations/{id}',
        tags: ['Conversations'],
        summary: 'Delete conversation',
        description: 'Deletes a conversation and all its associated events (via cascade delete)',
        request: {
          params: conversationRouteParamsSchema,
        },
        responses: {
          204: { description: 'Conversation deleted successfully' },
          404: { description: 'Conversation not found' },
        },
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/conversations/{id}/events',
        tags: ['Conversations'],
        summary: 'List conversation events',
        description: 'Retrieves a paginated list of events for a specific conversation with optional filtering and sorting',
        request: {
          params: conversationRouteParamsSchema,
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
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/conversations/{id}/events/{eventId}',
        tags: ['Conversations'],
        summary: 'Get conversation event by ID',
        description: 'Retrieves a specific event for a conversation by its unique identifier',
        request: {
          params: conversationEventRouteParamsSchema,
        },
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
      },
      {
        method: 'get',
        path: '/api/projects/{projectId}/conversations/{id}/audit-logs',
        tags: ['Conversations'],
        summary: 'Get conversation audit logs',
        description: 'Retrieves audit logs for a specific conversation',
        request: {
          params: conversationRouteParamsSchema,
        },
        responses: {
          200: {
            description: 'Audit logs retrieved successfully',
          },
          404: { description: 'Conversation not found' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   */
  registerRoutes(router: Router): void {
    router.get('/api/projects/:projectId/conversations/:id', asyncHandler(this.getConversationById.bind(this)));
    router.get('/api/projects/:projectId/conversations', asyncHandler(this.listConversations.bind(this)));
    router.delete('/api/projects/:projectId/conversations/:id', asyncHandler(this.deleteConversation.bind(this)));
    router.get('/api/projects/:projectId/conversations/:id/events', asyncHandler(this.getConversationEvents.bind(this)));
    router.get('/api/projects/:projectId/conversations/:id/events/:eventId', asyncHandler(this.getConversationEventById.bind(this)));
    router.get('/api/projects/:projectId/conversations/:id/audit-logs', asyncHandler(this.getConversationAuditLogs.bind(this)));
  }

  /**
   * GET /api/conversations/:id
   * Get a conversation by ID
   */
  private async getConversationById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONVERSATION_READ]);
    const params = conversationRouteParamsSchema.parse(req.params);
    const conversation = await this.conversationService.getConversationById(params.projectId, params.id);
    res.status(200).json(conversation);
  }

  /**
   * GET /api/conversations
   * List conversations with optional filters
   */
  private async listConversations(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONVERSATION_READ]);
    const { projectId } = projectScopedParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const conversations = await this.conversationService.listConversations(projectId, query);
    res.status(200).json(conversations);
  }

  /**
   * DELETE /api/conversations/:id
   * Delete a conversation
   */
  private async deleteConversation(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONVERSATION_DELETE]);
    const params = conversationRouteParamsSchema.parse(req.params);
    await this.conversationService.deleteConversation(params.projectId, params.id, req.context);
    res.status(204).send();
  }

  /**
   * GET /api/conversations/:id/events
   * List all events for a specific conversation
   */
  private async getConversationEvents(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONVERSATION_READ]);
    const params = conversationRouteParamsSchema.parse(req.params);
    const query = listParamsSchema.parse(req.query);
    const events = await this.conversationService.getConversationEvents(params.projectId, params.id, query);
    res.status(200).json(events);
  }

  /**
   * GET /api/conversations/:id/events/:eventId
   * Get a specific event by ID
   */
  private async getConversationEventById(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.CONVERSATION_READ]);
    const params = conversationEventRouteParamsSchema.parse(req.params);
    const event = await this.conversationService.getConversationEventById(params.projectId, params.id, params.eventId);
    res.status(200).json(event);
  }

  /**
   * GET /api/conversations/:id/audit-logs
   * Get audit logs for a conversation
   */
  private async getConversationAuditLogs(req: Request, res: Response): Promise<void> {
    checkPermissions(req, [PERMISSIONS.AUDIT_READ]);
    const params = conversationRouteParamsSchema.parse(req.params);
    const auditLogs = await this.conversationService.getConversationAuditLogs(params.id);
    res.status(200).json(auditLogs);
  }
}
