import { inject, singleton } from 'tsyringe';
import type { Request, Response, Router } from 'express';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { ToolReplyService } from '../../services/ToolReplyService';
import { ToolReplyBody, toolReplyBodySchema, toolReplyResponseSchema } from '../contracts/tool';
import { asyncHandler } from '../../utils/asyncHandler';
import { ToolReplyError } from '../../errors';
import { logger } from '../../utils/logger';

/**
 * Controller for async tool replies
 * External services use this endpoint to submit deferred responses to webhook tool calls
 * This endpoint is unauthenticated — security is handled via request ID and optional secret
 */
@singleton()
export class ToolReplyController {
  constructor(@inject(ToolReplyService) private readonly toolReplyService: ToolReplyService) { }

  /**
   * Get OpenAPI path definitions for this controller
   */
  static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        method: 'post',
        path: '/api/reply',
        tags: ['Tool Replies'],
        summary: 'Submit a deferred tool reply',
        description: 'External services use this endpoint to submit their response to a deferred webhook tool call. Requires headers: x-bonsai-request-id (mandatory), x-bonsai-reply-secret (mandatory). The request ID was provided in the x-bonsai-request-id header during the original webhook call.',
        request: {
          body: {
            content: {
              'application/json': {
                schema: toolReplyBodySchema,
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Reply accepted successfully',
            content: {
              'application/json': {
                schema: toolReplyResponseSchema,
              },
            },
          },
          404: { description: 'No pending tool reply found for the request ID' },
          409: { description: 'Tool reply already processed or expired' },
          422: { description: 'Invalid secret or reply data' },
        },
      },
    ];
  }

  /**
   * Register all routes for this controller
   * These routes must be registered BEFORE the optionalAuthMiddleware
   */
  registerRoutes(router: Router): void {
    router.post('/api/reply', asyncHandler(this.submitReply.bind(this)));
  }

  /**
   * POST /api/reply
   * Submit a deferred tool reply
   */
  private async submitReply(req: Request, res: Response): Promise<void> {
    const headerRequestId = req.headers['x-bonsai-request-id'] as string | undefined;
    const headerSecret = req.headers['x-bonsai-reply-secret'] as string | undefined;

    // Both headers are mandatory
    if (!headerRequestId || !headerRequestId.trim()) {
      throw new ToolReplyError('Missing required header: x-bonsai-request-id');
    }
    if (!headerSecret) {
      throw new ToolReplyError('Missing required header: x-bonsai-reply-secret');
    }

    let body: ToolReplyBody;
    try {
      body = toolReplyBodySchema.parse(req.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.issues
          .map(i => `${i.path.join('.')}: ${i.message}`)
          .join('; ') || 'Invalid input';
        logger.error(
          { ip: req.ip, userAgent: req.get('user-agent'), requestId: headerRequestId, issues: error.issues },
          'Tool reply validation failed',
        );

        // Mark the pending reply as failed so it doesn't hang
        await this.toolReplyService.rejectInvalidReply(headerRequestId, errorMessage);

        throw error;
      }
      throw error;
    }

    // Use body requestId if provided, otherwise fall back to header
    const requestId = body.requestId?.trim() ? body.requestId : headerRequestId;

    logger.info(
      {
        requestId,
        ip: req.ip,
        userAgent: req.get('user-agent'),
      },
      'Incoming tool reply',
    );

    // Create a minimal context for the service call
    const context = {
      operatorId: 'external_service',
      roles: [] as string[],
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      requestId: headerRequestId,
      timestamp: new Date(),
    };

    const result = await this.toolReplyService.submitReply(requestId, body, headerSecret, context);

    logger.info(
      {
        requestId,
        success: result.success,
      },
      'Tool reply processed',
    );

    res.status(200).json(result);
  }
}
