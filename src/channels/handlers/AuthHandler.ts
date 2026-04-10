import { inject, injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { authRequestSchema } from '../websocket/contracts/auth';
import type { AuthRequest, AuthResponse } from '../websocket/contracts/auth';
import { SessionManager } from '../SessionManager';
import { ApiKeyService } from '../../services/ApiKeyService';
import { ProjectService } from '../../services/ProjectService';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';
import type { ApiKeySettings } from '../../apiKeyFeatures';

/**
 * Handles WebSocket authentication requests.
 * Validates API key and creates a session on successful authentication.
 */
@ChannelMessageHandler('auth', false, authRequestSchema)
@injectable()
export class AuthHandler implements ClientMessageHandler<AuthRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  constructor(
    @inject(SessionManager) private sessionManager: SessionManager,
    @inject(ApiKeyService) private apiKeyService: ApiKeyService,
    @inject(ProjectService) private projectService: ProjectService,
  ) { }

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

      if (!apiKey || !apiKey.isActive) {
        logger.warn({ requestId: message.requestId }, 'Authentication failed: invalid or inactive API key');
        const response: AuthResponse = { type: 'auth', success: false, error: 'Invalid or inactive API key', requestId: message.requestId };
        context.send(response);
        return;
      }

      const keySettings: ApiKeySettings | null = apiKey.keySettings ?? null;

      // Check channel permission (websocket vs webrtc)
      if (keySettings?.allowedChannels) {
        const connectionType = context.session!.clientConnection.connectionType;
        if (!keySettings.allowedChannels.includes(connectionType)) {
          logger.warn({ requestId: message.requestId, connectionType, allowedChannels: keySettings.allowedChannels }, 'Authentication failed: channel type not permitted by API key');
          const response: AuthResponse = { type: 'auth', success: false, error: `Connection type '${connectionType}' is not permitted by this API key`, requestId: message.requestId };
          context.send(response);
          return;
        }
      }

      // Check output feature permissions against explicitly requested session settings
      if (keySettings?.allowedFeatures && message.sessionSettings) {
        const { receiveVoiceOutput, receiveTranscriptionUpdates, receiveEvents } = message.sessionSettings;
        if (receiveVoiceOutput === true && !keySettings.allowedFeatures.includes('voice_output')) {
          logger.warn({ requestId: message.requestId }, 'Authentication failed: voice_output not permitted by API key');
          const response: AuthResponse = { type: 'auth', success: false, error: 'API key does not permit voice output', requestId: message.requestId };
          context.send(response);
          return;
        }
        if (receiveTranscriptionUpdates === true && !keySettings.allowedFeatures.includes('text_output')) {
          logger.warn({ requestId: message.requestId }, 'Authentication failed: text_output not permitted by API key');
          const response: AuthResponse = { type: 'auth', success: false, error: 'API key does not permit text output', requestId: message.requestId };
          context.send(response);
          return;
        }
        if (receiveEvents === true && !keySettings.allowedFeatures.includes('events')) {
          logger.warn({ requestId: message.requestId }, 'Authentication failed: events not permitted by API key');
          const response: AuthResponse = { type: 'auth', success: false, error: 'API key does not permit conversation events', requestId: message.requestId };
          context.send(response);
          return;
        }
      }

      this.sessionManager.setSessionProjectAndSettings(context.session!.id, apiKey.projectId, message.sessionSettings, keySettings);
      logger.info({ sessionId: context.session!.id, projectId: apiKey.projectId, requestId: message.requestId }, 'WebSocket authentication successful, session created');

      const project = await this.projectService.getProjectById(apiKey.projectId);
      const sendVoiceInput = message.sessionSettings?.sendVoiceInput !== false;
      const projectSettings = {
        projectId: project.id,
        acceptVoice: project.acceptVoice && sendVoiceInput,
        generateVoice: project.generateVoice,
        asrConfig: project.asrConfig && sendVoiceInput ? project.asrConfig : null,
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
