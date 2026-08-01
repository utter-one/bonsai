import { inject, singleton } from 'tsyringe';
import { schedule } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { asc, and, eq, lte } from 'drizzle-orm';
import { db } from '../db/index';
import { deferredProcessing } from '../db/schema';
import { SessionManager } from '../channels/SessionManager';
import { ChannelHandlerDispatcher } from '../channels/ChannelHandlerDispatcher';
import type { CALInputMessage } from '../channels/messages';
import type { ClientMessageHandlerContext } from '../channels/ClientMessageHandlerContext';
import { DeferredProcessingService } from './DeferredProcessingService';
import { logger } from '../utils/logger';

/** Maximum deferred entries processed per poll cycle */
const POLL_BATCH_SIZE = 50;

/** Maximum retry attempts before marking as permanently failed */
const MAX_RETRIES = 3;

/** Exponential backoff intervals in milliseconds: 1m, 5m, 15m */
const RETRY_BACKOFF_MS = [60_000, 300_000, 900_000];

/**
 * Background service that polls the deferred_processing table and dispatches
 * messages whose processAt timestamp has elapsed.
 *
 * Runs every 15 seconds via node-cron. Handles session expiry detection,
 * retry with exponential backoff, and periodic cleanup of old records.
 */
@singleton()
export class ProcessingDeferralService {
  private scheduledTask: ScheduledTask | null = null;
  private isProcessing = false;

  constructor(
    @inject(DeferredProcessingService) private readonly deferredProcessingService: DeferredProcessingService,
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(ChannelHandlerDispatcher) private readonly dispatcher: ChannelHandlerDispatcher,
  ) {}

  /**
   * Starts the polling timer. Called during server startup.
   */
  start(): void {
    logger.info('Starting ProcessingDeferralService (polls every 15 seconds)');
    this.scheduledTask = schedule('*/15 * * * * *', () => {
      this.processQueue().catch((error) =>
        logger.error({ error }, 'ProcessingDeferralService unhandled error'));
    });
  }

  /**
   * Stops the polling timer. Called during graceful shutdown.
   */
  stop(): void {
    if (this.scheduledTask) {
      this.scheduledTask.destroy();
      this.scheduledTask = null;
    }
    logger.info('ProcessingDeferralService stopped');
  }

  /**
   * Main poll cycle: fetch due messages, process each, then cleanup old records.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      logger.debug('ProcessingDeferralService: previous run still in progress, skipping');
      return;
    }

    this.isProcessing = true;
    try {
      // 1. Fetch due messages
      const due = await db.select().from(deferredProcessing)
        .where(and(
          eq(deferredProcessing.status, 'pending'),
          lte(deferredProcessing.processAt, new Date()),
        ))
        .orderBy(asc(deferredProcessing.processAt))
        .limit(POLL_BATCH_SIZE);

      if (due.length === 0) {
        return;
      }

      logger.debug({ count: due.length }, 'Processing deferred messages');

      // 2. Process each message
      for (const entry of due) {
        await this.processEntry(entry);
      }

      // 3. Cleanup old records
      await this.deferredProcessingService.cleanupOldRecords();
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single deferred entry: verify session, dispatch message, update status.
   */
  private async processEntry(entry: typeof deferredProcessing.$inferSelect): Promise<void> {
    // Verify session still exists
    const session = this.sessionManager.getSession(entry.sessionId);
    if (!session) {
      await db.update(deferredProcessing)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(deferredProcessing.id, entry.id));
      logger.warn({
        messageId: entry.id,
        sessionId: entry.sessionId,
      }, 'Deferred message cancelled — session expired');
      return;
    }

    try {
      const message = entry.message as CALInputMessage;
      const context = this.buildContext(entry.sessionId);
      await this.dispatcher.dispatch(message, context);

      await db.update(deferredProcessing)
        .set({
          status: 'processed',
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deferredProcessing.id, entry.id));

      logger.info({
        messageId: entry.id,
        sessionId: entry.sessionId,
        conversationId: entry.conversationId,
        channelType: entry.channelType,
      }, 'Deferred message processed');
    } catch (error) {
      await this.handleRetryOrFail(entry, error);
    }
  }

  /**
   * Handle dispatch failure: retry with exponential backoff or mark as permanently failed.
   */
  private async handleRetryOrFail(
    entry: typeof deferredProcessing.$inferSelect,
    error: unknown,
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (entry.retryCount < MAX_RETRIES) {
      const backoffMs = RETRY_BACKOFF_MS[entry.retryCount] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
      const newProcessAt = new Date(Date.now() + backoffMs);

      await db.update(deferredProcessing)
        .set({
          status: 'pending',
          retryCount: entry.retryCount + 1,
          processAt: newProcessAt,
          lastError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(deferredProcessing.id, entry.id));

      logger.warn({
        messageId: entry.id,
        retryCount: entry.retryCount + 1,
        maxRetries: MAX_RETRIES,
        nextProcessAt: newProcessAt,
        error: errorMessage,
      }, 'Deferred message retry scheduled');
    } else {
      await db.update(deferredProcessing)
        .set({
          status: 'failed',
          lastError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(deferredProcessing.id, entry.id));

      logger.error({
        messageId: entry.id,
        sessionId: entry.sessionId,
        conversationId: entry.conversationId,
        channelType: entry.channelType,
        error: errorMessage,
      }, 'Deferred message permanently failed after max retries');
    }
  }

  /**
   * Build a minimal ClientMessageHandlerContext for a given session.
   */
  private buildContext(sessionId: string): ClientMessageHandlerContext {
    const session = this.sessionManager.getSession(sessionId);
    return {
      session,
      send: () => { /* outbound messages flow through connection.sendMessage */ },
      sendError: (error: string) => {
        logger.warn({ sessionId, error }, 'ProcessingDeferralService dispatcher error');
      },
    };
  }
}
