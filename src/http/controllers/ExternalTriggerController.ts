import { Router, Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { logger } from '../../utils/logger';
import { asyncHandler } from '../../utils/asyncHandler';
import { NotFoundError, UnauthorizedError, ForbiddenError, InvalidOperationError, TooManyRequestsError } from '../../errors';
import { externalTriggerRequestSchema, externalTriggerResponseSchema } from '../contracts/externalTrigger';
import { SessionManager } from '../../channels/SessionManager';
import type { ConversationRunner } from '../../services/live/ConversationRunner';
import { ApiKeyService } from '../../services/ApiKeyService';
import type { ApiKeySettings } from '../../apiKeyFeatures';

const EXTERNAL_TRIGGER_TIMEOUT_MS = parseInt(process.env.EXTERNAL_TRIGGER_TIMEOUT_MS || '30000', 10);

@singleton()
export class ExternalTriggerController {
  constructor(
    @inject(SessionManager) private sessionManager: SessionManager,
    @inject(ApiKeyService) private apiKeyService: ApiKeyService,
  ) {}

  public static getOpenAPIPaths(): RouteConfig[] {
    return [
      {
        path: '/api/conversations/trigger',
        method: 'post',
        summary: 'Trigger an external action in an active conversation',
        description: 'Triggers an action with triggerOnExternal enabled in an active conversation. Requires API key authentication with run_action feature.',
        tags: ['External Trigger'],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ExternalTriggerRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Action triggered successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExternalTriggerResponse' },
              },
            },
          },
          401: { description: 'Invalid or missing API key' },
          403: { description: 'API key lacks run_action feature or project mismatch' },
          404: { description: 'Conversation, session, or action not found' },
          408: { description: 'Request timed out waiting for runner' },
          409: { description: 'Conversation is not in awaiting_user_input state' },
          429: { description: 'Runner is busy, request timed out' },
        },
      },
    ];
  }

  public registerRoutes(router: Router): void {
    router.post('/api/conversations/trigger', asyncHandler(this.handleTrigger.bind(this)));
  }

  private async handleTrigger(req: Request, res: Response): Promise<void> {
    const apiKey = await this.extractApiKey(req);

    if (!apiKey) {
      logger.warn({ ip: req.ip, userAgent: req.headers['user-agent'], keyPrefix: req.headers.authorization?.slice(0, 20), conversationId: req.body.conversationId, sessionId: req.body.sessionId, actionName: req.body.actionName }, 'External trigger rejected: missing or invalid API key');
      throw new UnauthorizedError('Missing or invalid API key');
    }

    const { projectId, keySettings } = apiKey;

    if (keySettings?.allowedFeatures && !keySettings.allowedFeatures.includes('run_action')) {
      logger.warn({ ip: req.ip, keyPrefix: req.headers.authorization?.slice(0, 20), projectId }, 'External trigger rejected: API key lacks run_action feature');
      throw new ForbiddenError('API key does not have run_action feature enabled');
    }

    const body = externalTriggerRequestSchema.parse(req.body);
    const { conversationId, sessionId, actionName, parameters } = body;

    const sessions = this.sessionManager.getSessionsForConversation(conversationId);

    if (sessions.length === 0) {
      throw new NotFoundError(`No active sessions found for conversation ${conversationId}`);
    }

    const session = sessionId
      ? sessions.find(s => s.id === sessionId)
      : sessions.length === 1
        ? sessions[0]
        : null;

    if (!session) {
      throw new NotFoundError(sessionId
        ? `Session ${sessionId} not found for conversation ${conversationId}`
        : `Multiple sessions exist for conversation ${conversationId}. Please specify a sessionId.`);
    }

    if (session.projectId !== projectId) {
      logger.warn({ ip: req.ip, keyPrefix: req.headers.authorization?.slice(0, 20), projectId, sessionProjectId: session.projectId, conversationId }, 'External trigger rejected: API key project mismatch');
      throw new ForbiddenError('API key does not have access to this conversation');
    }

    const runner = session.runner as ConversationRunner;

    const stageData = (runner as any).stageData;
    const globalAction = stageData.globalActions.find((a: any) => (a.id === actionName || a.name === actionName) && a.triggerOnExternal);

    const stageAction = stageData.stage.actions[actionName];
    const stageActionAllowed = stageAction?.triggerOnExternal === true;

    if (!globalAction && !stageActionAllowed) {
      throw new NotFoundError(`Action ${actionName} not found or not enabled for external triggering`);
    }

    // Ignore triggers for terminal conversations — log and return success with ignored flag
    if (runner.isConversationTerminal()) {
      logger.warn({ conversationId, sessionId: session.id, actionName, status: runner['conversation'].status }, 'External trigger ignored: conversation is in terminal state');
      res.json({ success: true, ignored: true, conversationId, sessionId: session.id, actionName });
      return;
    }

    try {
      const runResult = await runner.runAction(actionName, parameters);

      // Mutex-level check: conversation became terminal while waiting in queue
      if (runResult?.status === 'ignored') {
        logger.warn({ conversationId, sessionId: session.id, actionName }, 'External trigger ignored: conversation became terminal while queued');
        res.json({ success: true, ignored: true, conversationId, sessionId: session.id, actionName });
        return;
      }

      // Execute any pending terminal action (end/abort) after the response is sent
      try {
        await runner.executePendingTerminalAction();
      } catch (terminalError) {
        logger.error({ error: terminalError instanceof Error ? terminalError.message : String(terminalError), sessionId: session.id, conversationId }, 'Failed to execute pending terminal action after external trigger');
      }

      const outcome = runner.getLastActionOutcome();

      const response = externalTriggerResponseSchema.parse({
        success: true,
        conversationId,
        sessionId: session.id,
        actionName,
        outcome: {
          hasModifiedUserInput: outcome?.hasModifiedUserInput ?? false,
          hasModifiedVars: outcome?.hasModifiedVars ?? false,
          shouldGenerateResponse: outcome?.shouldGenerateResponse ?? false,
          shouldAbortConversation: outcome?.shouldAbortConversation ?? false,
          shouldEndConversation: outcome?.shouldEndConversation ?? false,
        },
      });

      logger.info({ conversationId, sessionId: session.id, actionName, projectId }, 'External trigger executed successfully');
      res.json(response);
    } catch (error) {
      if (error instanceof TooManyRequestsError || (error as any)?.message?.includes('timed out')) {
        logger.warn({ conversationId, sessionId: session.id, actionName, error: error instanceof Error ? error.message : String(error) }, 'External trigger timed out');
        res.status(408).json({ success: false, error: 'Request timed out, runner is busy', code: 'TIMEOUT' });
      } else if (error instanceof InvalidOperationError) {
        logger.warn({ conversationId, sessionId: session.id, actionName, error: error.message }, 'External trigger failed: invalid operation');
        res.status(409).json({ success: false, error: error.message, code: 'INVALID_OPERATION' });
      } else {
        logger.error({ conversationId, sessionId: session.id, actionName, error: error instanceof Error ? error.message : String(error) }, 'External trigger failed');
        res.status(500).json({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' });
      }
    }
  }

  private async extractApiKey(req: Request): Promise<{ projectId: string; keySettings: ApiKeySettings | null } | null> {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.slice(7);

    if (!token || token.length < 32) {
      return null;
    }

    try {
      const apiKey = await this.apiKeyService.getApiKeyByKey(token);

      if (!apiKey || !apiKey.isActive) {
        return null;
      }

      return {
        projectId: apiKey.projectId,
        keySettings: apiKey.keySettings ?? null,
      };
    } catch {
      return null;
    }
  }
}
