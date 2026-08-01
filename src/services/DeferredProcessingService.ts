import { injectable } from 'tsyringe';
import { and, count, desc, eq, lt, ne } from 'drizzle-orm';
import { db } from '../db/index';
import { deferredProcessing } from '../db/schema';
import type { DeferredProcessingStatus } from '../db/schema';
import type { CALInputMessage } from '../channels/messages';

/** Maximum delay window in milliseconds (30 days) */
const MAX_RESCHEDULE_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

export interface DeferredProcessingListFilters {
  projectId: string;
  status?: DeferredProcessingStatus;
  conversationId?: string;
  channelType?: string;
  offset?: number;
  limit?: number;
}

export interface DeferredProcessingListResult {
  items: typeof deferredProcessing.$inferSelect[];
  total: number;
}

/** Entry passed to the queue method */
export interface DeferredProcessingEntry {
  sessionId: string;
  providerId: string;
  projectId: string;
  conversationId: string | null;
  channelType: string;
  processAt: Date;
  message: CALInputMessage;
}

/**
 * Service for queuing and managing deferred processing entries.
 * Injected by channel hosts to queue incoming messages for delayed processing.
 */
@injectable()
export class DeferredProcessingService {
  /**
   * Queue a message for deferred processing.
   * If a `pending` entry already exists for the same conversation, the new text is
   * appended to the existing entry's message (coalescing) instead of creating a new row.
   * The message will be processed by ProcessingDeferralService when `processAt` elapses.
   */
  public async queue(entry: DeferredProcessingEntry): Promise<void> {
    // Coalesce: check for existing pending entry for the same conversation
    if (entry.conversationId) {
      const [existing] = await db.select().from(deferredProcessing)
        .where(and(
          eq(deferredProcessing.conversationId, entry.conversationId),
          eq(deferredProcessing.status, 'pending'),
        ));

      if (existing) {
        // Coalesce: append new text to existing message
        // Only send_user_text_input messages are deferred, so text is always present
        const existingMessage = existing.message as Record<string, unknown>;
        const existingText = typeof existingMessage.text === 'string' ? existingMessage.text : '';
        const newMessage = entry.message as Record<string, unknown>;
        const newText = typeof newMessage.text === 'string' ? newMessage.text : '';
        const coalescedText = existingText + '\n\n' + newText;

        await db.update(deferredProcessing)
          .set({ message: { ...existingMessage, text: coalescedText } })
          .where(eq(deferredProcessing.id, existing.id));

        return;
      }
    }

    // No existing entry — insert new
    await db.insert(deferredProcessing).values({
      id: `deferred_${crypto.randomUUID()}`,
      sessionId: entry.sessionId,
      providerId: entry.providerId,
      projectId: entry.projectId,
      conversationId: entry.conversationId,
      channelType: entry.channelType,
      processAt: entry.processAt,
      message: entry.message as Record<string, unknown>,
    });
  }

  /**
   * Cancel all pending messages for a given session.
   * Called when a session times out or is terminated.
   */
  public async cancelBySessionId(sessionId: string): Promise<void> {
    await db.update(deferredProcessing)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(deferredProcessing.sessionId, sessionId),
        eq(deferredProcessing.status, 'pending'),
      ));
  }

  /**
   * Cancel all pending messages for a given conversation.
   * Called when a conversation is ended.
   */
  public async cancelByConversationId(conversationId: string): Promise<void> {
    await db.update(deferredProcessing)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(deferredProcessing.conversationId, conversationId),
        eq(deferredProcessing.status, 'pending'),
      ));
  }

  /**
   * Cancel all pending messages for a given provider.
   * Called when a provider is deleted.
   */
  public async cancelByProviderId(providerId: string): Promise<void> {
    await db.update(deferredProcessing)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(deferredProcessing.providerId, providerId),
        eq(deferredProcessing.status, 'pending'),
      ));
  }

  /**
   * Clean up old processed/failed/cancelled records older than 7 days.
   * Called by ProcessingDeferralService during each poll cycle.
   */
  public async cleanupOldRecords(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await db.delete(deferredProcessing)
      .where(
        and(
          ne(deferredProcessing.status, 'pending'),
          lt(deferredProcessing.updatedAt, cutoff),
        ),
      )
      .returning({ id: deferredProcessing.id });

    if (result.length > 0) {
      const { logger } = await import('../utils/logger');
      logger.debug({ count: result.length }, 'Cleaned up old deferred processing records');
    }
  }

  /**
   * List deferred processing entries for a project with optional filters.
   */
  public async list(filters: DeferredProcessingListFilters): Promise<DeferredProcessingListResult> {
    const { projectId, status, conversationId, channelType, offset = 0, limit = 50 } = filters;

    const whereClause = and(
      eq(deferredProcessing.projectId, projectId),
      status ? eq(deferredProcessing.status, status) : undefined,
      conversationId ? eq(deferredProcessing.conversationId, conversationId) : undefined,
      channelType ? eq(deferredProcessing.channelType, channelType) : undefined,
    );

    // Count total matching rows
    const [{ total }] = await db.select({ total: count() }).from(deferredProcessing).where(whereClause);

    // Fetch page
    const items = await db.select().from(deferredProcessing)
      .where(whereClause)
      .orderBy(desc(deferredProcessing.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, total };
  }

  /**
   * Get a single deferred processing entry by ID.
   */
  public async getById(id: string): Promise<typeof deferredProcessing.$inferSelect | null> {
    const [row] = await db.select().from(deferredProcessing).where(eq(deferredProcessing.id, id));
    return row ?? null;
  }

  /**
   * Reschedule a pending entry to a new processAt timestamp.
   * Use a past date to trigger immediate processing (next poll cycle).
   */
  public async reschedule(id: string, newProcessAt: Date): Promise<void> {
    // Clamp to reasonable bounds
    const now = new Date();
    const maxFuture = new Date(Date.now() + MAX_RESCHEDULE_DELAY_MS);
    const clampedProcessAt = newProcessAt < now ? now : newProcessAt > maxFuture ? maxFuture : newProcessAt;

    const result = await db.update(deferredProcessing)
      .set({ processAt: clampedProcessAt, updatedAt: new Date() })
      .where(and(
        eq(deferredProcessing.id, id),
        eq(deferredProcessing.status, 'pending'),
      ))
      .returning();

    if (result.length === 0) {
      const { NotFoundError } = await import('../errors');
      throw new NotFoundError(`Deferred processing entry ${id} not found or not in pending status`);
    }
  }

  /**
   * Cancel a single pending entry by ID.
   */
  public async cancel(id: string): Promise<void> {
    const result = await db.update(deferredProcessing)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(
        eq(deferredProcessing.id, id),
        eq(deferredProcessing.status, 'pending'),
      ))
      .returning();

    if (result.length === 0) {
      const { NotFoundError } = await import('../errors');
      throw new NotFoundError(`Deferred processing entry ${id} not found or not in pending status`);
    }
  }
}
