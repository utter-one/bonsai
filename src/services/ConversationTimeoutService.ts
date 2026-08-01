import { inject, singleton } from 'tsyringe';
import { schedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { conversations, projects } from '../db/schema';
import { ConversationService } from './ConversationService';
import { DeferredProcessingService } from './DeferredProcessingService';
import { SessionManager } from '../channels/SessionManager';
import type { ConversationAbortedEventData } from '../types/conversationEvents';
import logger from '../utils/logger';

/** Conversation statuses that are considered active and eligible for timeout */
const ACTIVE_STATUSES = ['initialized', 'awaiting_user_input', 'receiving_user_voice', 'processing_user_input', 'generating_response'] as const;

const TIMEOUT_REASON = 'Conversation timed out due to inactivity';

/**
 * Background service that periodically checks for conversations that have exceeded
 * their project-configured inactivity timeout and aborts them.
 * Runs every minute via an in-process timer.
 */
@singleton()
export class ConversationTimeoutService {
  private scheduledTask: ScheduledTask | null = null;
  private isProcessing = false;

  constructor(
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
    @inject(SessionManager) private readonly sessionManager: SessionManager,
  ) { }

  /**
   * Starts the timer that runs conversation timeout checks every minute.
   */
  start(): void {
    logger.info('Starting ConversationTimeoutService (runs every 1 minute)');
    this.scheduledTask = schedule('* * * * *', () => {
      this.processTimeouts().catch((error) => logger.error({ error }, 'Unhandled error in ConversationTimeoutService.processTimeouts'));
    });
  }

  /**
   * Stops the timer. Call this during graceful shutdown.
   */
  stop(): void {
    if (this.scheduledTask) {
      this.scheduledTask.destroy();
      this.scheduledTask = null;
    }
    logger.info('ConversationTimeoutService stopped');
  }

  /**
   * Finds all active conversations that have exceeded their project's inactivity timeout
   * and aborts each one, saving a conversation_aborted event and notifying connected clients.
   */
  async processTimeouts(): Promise<void> {
    if (this.isProcessing) {
      logger.debug('ConversationTimeoutService: previous run still in progress, skipping');
      return;
    }

    this.isProcessing = true;
    try {
      logger.debug('Running conversation timeout check');

      let timedOut: { id: string; projectId: string; stageId: string }[];

      try {
        timedOut = await db
          .select({ id: conversations.id, projectId: conversations.projectId, stageId: conversations.stageId })
          .from(conversations)
          .innerJoin(projects, and(
            sql`${conversations.projectId} = ${projects.id}`,
          ))
          .where(
            and(
              inArray(conversations.status, [...ACTIVE_STATUSES]),
              isNull(projects.archivedAt),
              sql`${projects.conversationTimeoutSeconds} > 0`,
              sql`COALESCE(${conversations.lastActivityAt}, ${conversations.updatedAt}) < NOW() - (${projects.conversationTimeoutSeconds} * INTERVAL '1 second')`,
            ),
          );
      } catch (error) {
        logger.error({ error }, 'Failed to query timed-out conversations');
        return;
      }

      if (timedOut.length === 0) {
        logger.debug('No conversations to time out');
        return;
      }

      logger.info({ count: timedOut.length }, 'Aborting timed-out conversations');

      for (const conversation of timedOut) {
        await this.abortTimedOutConversation(conversation);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async abortTimedOutConversation(conversation: { id: string; projectId: string; stageId: string }): Promise<void> {
    const { id, projectId, stageId } = conversation;
    try {
      await this.conversationService.abortConversation(projectId, id, TIMEOUT_REASON);

      const eventData: ConversationAbortedEventData = { stageId, reason: TIMEOUT_REASON };
      await this.conversationService.saveConversationEvent(projectId, id, 'conversation_aborted', eventData, stageId);

      for (const session of this.sessionManager.getSessionsForConversation(id)) {
        await session.clientConnection?.sendMessage({ type: 'conversation_event', conversationId: session.conversationId, eventType: 'conversation_aborted', eventData });
        try {
          await session.clientConnection?.close();
        } catch { /* best effort */ }
      }

      // Cancel any pending deferred messages for this conversation
      try {
        await this.deferredProcessingService.cancelByConversationId(id);
      } catch (error) {
        logger.warn({ error, conversationId: id }, 'Failed to cancel deferred messages for timed-out conversation, continuing');
      }

      logger.info({ conversationId: id, projectId }, 'Conversation aborted due to inactivity timeout');
    } catch (error) {
      logger.error({ error, conversationId: id, projectId }, 'Failed to abort timed-out conversation');
    }
  }
}
