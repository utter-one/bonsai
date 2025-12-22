import 'reflect-metadata';
import { JsonController, Get, Post, Put, Delete, Param, Body, QueryParams, HttpCode, Req } from 'routing-controllers';
import { injectable, inject } from 'tsyringe';
import { Validated } from '../decorators/validation';
import { OpenAPI } from '../decorators/openapi';
import { RequirePermissions } from '../decorators/auth';
import { PERMISSIONS } from '../config/permissions';
import type { Request } from 'express';
import { ConversationStageService } from '../services/ConversationStageService';
import { createConversationStageSchema, updateConversationStageBodySchema, deleteConversationStageBodySchema, conversationStageResponseSchema, conversationStageListResponseSchema } from '../api/conversationStage';
import type { CreateConversationStageRequest, UpdateConversationStageRequest, DeleteConversationStageRequest } from '../api/conversationStage';
import { listParamsSchema } from '../api/common';
import type { ListParams } from '../api/common';

/**
 * Controller for conversation stage management with decorator-based routing
 * Manages conversation stages which define behavior, prompts, and actions for different conversation phases
 */
@injectable()
@JsonController('/api/conversation-stages')
export class ConversationStageController {
  constructor(@inject(ConversationStageService) private readonly conversationStageService: ConversationStageService) {}

  /**
   * POST /api/conversation-stages
   * Create a new conversation stage
   */
  @RequirePermissions([PERMISSIONS.CONVERSATION_STAGE_WRITE])
  @OpenAPI({
    tags: ['Conversation Stages'],
    summary: 'Create a new conversation stage',
    description: 'Creates a new conversation stage with specified behavior, prompts, and configuration',
    request: {
      body: {
        content: {
          'application/json': {
            schema: createConversationStageSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Conversation stage created successfully',
        content: {
          'application/json': {
            schema: conversationStageResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      409: { description: 'Conversation stage already exists' },
    },
  })
  @Post('/')
  @HttpCode(201)
  async createConversationStage(@Validated(createConversationStageSchema) @Body() body: CreateConversationStageRequest, @Req() req: Request) {
    const stage = await this.conversationStageService.createConversationStage(body, req.context);
    return stage;
  }

  /**
   * GET /api/conversation-stages/:stageId
   * Get a conversation stage by ID
   */
  @RequirePermissions([PERMISSIONS.CONVERSATION_STAGE_READ])
  @OpenAPI({
    tags: ['Conversation Stages'],
    summary: 'Get conversation stage by ID',
    description: 'Retrieves a single conversation stage by its unique identifier',
    responses: {
      200: {
        description: 'Conversation stage retrieved successfully',
        content: {
          'application/json': {
            schema: conversationStageResponseSchema,
          },
        },
      },
      404: { description: 'Conversation stage not found' },
    },
  })
  @Get('/:stageId')
  async getConversationStageById(@Param('stageId') stageId: string) {
    const stage = await this.conversationStageService.getConversationStageById(stageId);
    return stage;
  }

  /**
   * GET /api/conversation-stages
   * List conversation stages with optional filters
   */
  @RequirePermissions([PERMISSIONS.CONVERSATION_STAGE_READ])
  @OpenAPI({
    tags: ['Conversation Stages'],
    summary: 'List conversation stages',
    description: 'Retrieves a paginated list of conversation stages with optional filtering and sorting',
    request: {
      query: listParamsSchema,
    },
    responses: {
      200: {
        description: 'List of conversation stages retrieved successfully',
        content: {
          'application/json': {
            schema: conversationStageListResponseSchema,
          },
        },
      },
      400: { description: 'Invalid query parameters' },
    },
  })
  @Get('/')
  async listConversationStages(@Validated(listParamsSchema, 'query') @QueryParams() query: ListParams) {
    return await this.conversationStageService.listConversationStages(query);
  }

  /**
   * PUT /api/conversation-stages/:stageId
   * Update a conversation stage
   */
  @RequirePermissions([PERMISSIONS.CONVERSATION_STAGE_WRITE])
  @OpenAPI({
    tags: ['Conversation Stages'],
    summary: 'Update conversation stage',
    description: 'Updates an existing conversation stage with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: updateConversationStageBodySchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Conversation stage updated successfully',
        content: {
          'application/json': {
            schema: conversationStageResponseSchema,
          },
        },
      },
      400: { description: 'Invalid request body' },
      404: { description: 'Conversation stage not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Put('/:stageId')
  async updateConversationStage(@Param('stageId') stageId: string, @Validated(updateConversationStageBodySchema) @Body() body: UpdateConversationStageRequest, @Req() req: Request) {
    const { version, ...updateData } = body;
    const stage = await this.conversationStageService.updateConversationStage(stageId, updateData, version, req.context);
    return stage;
  }

  /**
   * DELETE /api/conversation-stages/:stageId
   * Delete a conversation stage
   */
  @RequirePermissions([PERMISSIONS.CONVERSATION_STAGE_DELETE])
  @OpenAPI({
    tags: ['Conversation Stages'],
    summary: 'Delete conversation stage',
    description: 'Deletes a conversation stage with optimistic locking',
    request: {
      body: {
        content: {
          'application/json': {
            schema: deleteConversationStageBodySchema,
          },
        },
      },
    },
    responses: {
      204: { description: 'Conversation stage deleted successfully' },
      400: { description: 'Invalid request body' },
      404: { description: 'Conversation stage not found' },
      409: { description: 'Version conflict - entity was modified' },
    },
  })
  @Delete('/:stageId')
  @HttpCode(204)
  async deleteConversationStage(@Param('stageId') stageId: string, @Validated(deleteConversationStageBodySchema) @Body() body: DeleteConversationStageRequest, @Req() req: Request) {
    await this.conversationStageService.deleteConversationStage(stageId, body.version, req.context);
  }

  /**
   * GET /api/conversation-stages/:stageId/audit-logs
   * Get audit logs for a conversation stage
   */
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @OpenAPI({
    tags: ['Conversation Stages'],
    summary: 'Get conversation stage audit logs',
    description: 'Retrieves audit logs for a specific conversation stage',
    responses: {
      200: {
        description: 'Audit logs retrieved successfully',
      },
      404: { description: 'Conversation stage not found' },
    },
  })
  @Get('/:stageId/audit-logs')
  async getConversationStageAuditLogs(@Param('stageId') stageId: string) {
    return await this.conversationStageService.getConversationStageAuditLogs(stageId);
  }
}
