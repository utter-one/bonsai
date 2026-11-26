import { inject, singleton } from 'tsyringe';
import { schedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import { conversations, projects } from '../db/schema';
import { ConversationService } from './ConversationService';
import { DeferredProcessingService } from './DeferredProcessingService';
import { ConversationLifecycleActionService } from './live/ConversationLifecycleActionService';
import type { ConversationRunner } from './live/ConversationRunner';
import { SessionManager } from '../channels/SessionManager';
import { HeartbeatRegistry } from './monitoring/HeartbeatRegistry';
import type { ConversationAbortedEventData } from '../types/conversationEvents';
import logger from '../utils/logger';

/** Conversation statuses that are considered active and eligible for timeout */
const ACTIVE_STATUSES = ['initialized', 'awaiting_user_input', 'receiving_user_voice', 'processing_user_input', 'generating_response'] as const;

const TIMEOUT_REASON = 'Conversation timed out due to inactivity';

/**
 * Upper bound on how long one conversation's abort work (lifecycle action, recording flush) may hold
 * the sweep. The abandoned work keeps running in the background; the sweep moves on and logs honestly.
 */
const ABORT_STEP_TIMEOUT_MS = 15_000;

/**
 * Background service that periodically checks for conversations that have exceeded their
 * project-configured inactivity timeout and aborts them.
 * Runs every minute via an in-process timer.
 *
 * The sweep is DB-driven rather than runner-driven on purpose: a runner only exists while a client
 * connection is attached (`SessionManager.unregisterSession()` drops it on disconnect without ending
 * the conversation), so most timed-out conversations are orphans with no runner in memory. When a
 * runner does exist it is used — it carries the real channel type and reaches the client — but it is
 * never a precondition for the abort.
 */
@singleton()
export class ConversationTimeoutService {
  private scheduledTask: ScheduledTask | null = null;
  private isProcessing = false;

  constructor(
    @inject(ConversationService) private readonly conversationService: ConversationService,
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
    @inject(ConversationLifecycleActionService) private readonly lifecycleActionService: ConversationLifecycleActionService,
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(HeartbeatRegistry) private readonly heartbeatRegistry: HeartbeatRegistry,
  ) { }

  /**
   * Starts the timer that runs conversation timeout checks every minute.
   */
  start(): void {
    logger.info('Starting ConversationTimeoutService (runs every 1 minute)');
    this.scheduledTask = schedule('* * * * *', () => {
      this.heartbeatRegistry.tick('conversation-timeout', 60_000);
      this.processTimeouts().catch((error) => {
        this.heartbeatRegistry.recordError('conversation-timeout');
        logger.error({ error }, 'Unhandled error in ConversationTimeoutService.processTimeouts');
      });
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
      const sessions = this.sessionManager.getSessionsForConversation(id);
      const runner = sessions.find((session) => session.runner)?.runner ?? null;

      // The project's __conversation_abort lifecycle action runs while the conversation is still
      // active and — for conversations that still have a connection — while the runner can still
      // deliver the events the action emits.
      await this.runAbortLifecycleAction(projectId, id, runner);

      const aborted = await this.conversationService.abortConversation(projectId, id, TIMEOUT_REASON);
      if (!aborted) {
        logger.debug({ conversationId: id, projectId }, 'Conversation was already terminal, skipping timeout notification');
        await this.releaseConversationSessions(id);
        return;
      }

      const eventData: ConversationAbortedEventData = { stageId, reason: TIMEOUT_REASON };
      await this.conversationService.saveConversationEvent(projectId, id, 'conversation_aborted', eventData, stageId);

      for (const session of sessions) {
        await session.clientConnection?.sendMessage({ type: 'conversation_event', conversationId: session.conversationId, eventType: 'conversation_aborted', eventData });
        try {
          await session.clientConnection?.close();
        } catch { /* best effort */ }
      }

      // Must precede session release: cleanup() discards an unflushed recording buffer.
      await this.flushRecording(runner, id);

      await this.releaseConversationSessions(id);

      logger.info({ conversationId: id, projectId, hadLiveRunner: runner !== null }, 'Conversation aborted due to inactivity timeout');
    } catch (error) {
      logger.error({ error, conversationId: id, projectId }, 'Failed to abort timed-out conversation');
    }
  }

  /**
   * Executes the project's `__conversation_abort` global action, preferring the live runner (real
   * channel type, events streamed to the client) and falling back to runner-independent execution for
   * orphaned conversations. Failures and timeouts are logged only — they never block the abort.
   */
  private async runAbortLifecycleAction(projectId: string, conversationId: string, runner: ConversationRunner | null): Promise<void> {
    try {
      const executed = runner
        ? await this.runBounded(runner.executeAbortLifecycleAction(TIMEOUT_REASON), 'lifecycle action')
        : await this.runBounded(this.lifecycleActionService.executeAbortAction({
          projectId,
          conversationId,
          emitEvent: async (eventType, eventData) => {
            await this.conversationService.saveConversationEvent(projectId, conversationId, eventType, eventData);
          },
        }), 'lifecycle action');

      if (executed === true) {
        logger.info({ conversationId, projectId, via: runner ? 'runner' : 'standalone' }, 'Ran __conversation_abort lifecycle action for timed-out conversation');
      }
    } catch (error) {
      logger.warn({ error, conversationId, projectId }, 'Failed to run __conversation_abort lifecycle action for timed-out conversation, continuing with abort');
    }
  }

  /** Flushes buffered recordings of a still-attached runner so a timeout does not silently drop call audio. */
  private async flushRecording(runner: ConversationRunner | null, conversationId: string): Promise<void> {
    if (!runner) return;
    try {
      await this.runBounded(runner.flushRecording(), 'recording flush');
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to flush recordings of timed-out conversation');
    }
  }

  /**
   * Releases runners/providers bound to the conversation and cancels its pending deferred messages
   * (a terminal conversation must never deliver a scheduled message, whoever terminalised it).
   */
  private async releaseConversationSessions(conversationId: string): Promise<void> {
    try {
      await this.sessionManager.detachConversationFromSessions(conversationId);
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to detach sessions of timed-out conversation, continuing');
    }

    try {
      await this.deferredProcessingService.cancelByConversationId(conversationId);
    } catch (error) {
      logger.warn({ error, conversationId }, 'Failed to cancel deferred messages for timed-out conversation, continuing');
    }
  }

  /** Awaits a step for at most ABORT_STEP_TIMEOUT_MS. The underlying promise is not cancellable and keeps running. */
  private async runBounded<T>(work: Promise<T>, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${ABORT_STEP_TIMEOUT_MS}ms`)), ABORT_STEP_TIMEOUT_MS);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
