import { inject, injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import type { AuthRequest, AuthResponse } from '../websocket/contracts/auth';
import { SessionManager } from '../SessionManager';
import { ApiKeyService } from '../../services/ApiKeyService';
import { ProjectService } from '../../services/ProjectService';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

/**
 * Handles WebSocket authentication requests.
 * Validates API key and creates a session on successful authentication.
 */
@ChannelMessageHandler('auth', false)
@injectable()
export class AuthHandler implements ClientMessageHandler<AuthRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(
    @inject(SessionManager) private sessionManager: SessionManager,
    @inject(ApiKeyService) private apiKeyService: ApiKeyService,
    @inject(ProjectService) private projectService: ProjectService,
  ) {}

  /**
   * Handles authentication requests.
   * Validates API key against the database and creates a session on successful authentication.
   */
  async handle(context: ClientMessageHandlerContext, message: AuthRequest): Promise<void> {
    // Reject re-authentication on an already-authenticated session
    if (context.session?.projectId) {
      logger.warn({ requestId: message.requestId, sessionId: context.session.id }, 'Auth message received on already-authenticated session');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Already authenticated', requestId: message.requestId };
      context.send(response);
      return;
    }

    try {
      const apiKey = await this.apiKeyService.getApiKeyByKey(message.apiKey);
      logger.info({ session: context.session, requestId: message.requestId, apiKeyId: apiKey.id, projectId: apiKey.projectId }, 'API key validated successfully');

      if (!apiKey || !apiKey.isActive) {
        logger.warn({ requestId: message.requestId }, 'Authentication failed: invalid or inactive API key');
        const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid or inactive API key', requestId: message.requestId };
        context.send(response);
        return;
      }

      this.sessionManager.setSessionProjectAndSettings(context.session!.id, apiKey.projectId, message.sessionSettings);
      logger.info({ sessionId: context.session!.id, projectId: apiKey.projectId, requestId: message.requestId }, 'WebSocket authentication successful, session created');

      const project = await this.projectService.getProjectById(apiKey.projectId);
      const projectSettings = {
        projectId: project.id,
        acceptVoice: project.acceptVoice,
        generateVoice: project.generateVoice,
        asrConfig: project.asrConfig ?? null,
      };

      const response: AuthResponse = { type: 'auth', success: true, sessionId: context.session!.id, projectSettings, requestId: message.requestId };
      context.send(response);
    } catch (error) {
      logger.error({ error, requestId: message.requestId }, 'Authentication failed: error validating API key');
      const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid API key', requestId: message.requestId };
      context.send(response);
    }
  }
}
