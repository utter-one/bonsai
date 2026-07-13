import { injectable, inject } from 'tsyringe';
import { eq, and, lt } from 'drizzle-orm';
import { db } from '../db/index';
import { pendingToolReplies, tools } from '../db/schema';
import type { RequestContext } from './RequestContext';
import type { ToolReplyBody } from '../http/contracts/tool';
import type { Effect } from '../types/actions';
import { ToolReplyError, NotFoundError } from '../errors';
import { logger } from '../utils/logger';
import { SessionManager } from '../channels/SessionManager';

@injectable()
export class ToolReplyService {
  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
  ) { }

  /**
   * Submit a reply for a deferred webhook tool call.
   * This method validates the request, stores the reply data, and updates the status.
   */
   public async submitReply(
    requestId: string,
    body: ToolReplyBody,
    secret: string | undefined,
    _context: RequestContext,
  ): Promise<{ success: boolean; requestId: string; message: string }> {
    logger.info({ requestId }, 'Received tool reply');

    // Find the pending reply record
    const [pendingReply] = await db
      .select()
      .from(pendingToolReplies)
      .where(eq(pendingToolReplies.requestId, requestId))
      .limit(1);

    if (!pendingReply) {
      logger.warn({ requestId }, 'Tool reply not found');
      throw new NotFoundError(`No pending tool reply found for request ID: ${requestId}`);
    }

    // Check if already replied or expired
    if (pendingReply.status !== 'pending') {
      logger.warn({ requestId, status: pendingReply.status }, 'Tool reply already processed');
      throw new ToolReplyError(`Tool reply already processed (status: ${pendingReply.status})`);
    }

    if (new Date() > pendingReply.expiresAt) {
      logger.warn({ requestId, expiresAt: pendingReply.expiresAt }, 'Tool reply expired');
      await db
        .update(pendingToolReplies)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(eq(pendingToolReplies.id, pendingReply.id));
      throw new ToolReplyError('Tool reply has expired');
    }

    // Verify secret if configured on the tool
    const [tool] = await db
      .select()
      .from(tools)
      .where(and(
        eq(tools.id, pendingReply.toolId),
        eq(tools.projectId, pendingReply.projectId),
      ))
      .limit(1);

    if (tool?.asyncReply?.secret) {
      const providedSecret = secret;
      if (!providedSecret || providedSecret !== tool.asyncReply.secret) {
        logger.warn({ requestId, projectId: pendingReply.projectId, toolId: pendingReply.toolId }, 'Tool reply secret mismatch');
        throw new ToolReplyError('Invalid secret');
      }
    }

    // Update the pending reply with the data and effects
    // Use conditional WHERE to prevent TOCTOU race: only update if still pending
    const updated = await db
      .update(pendingToolReplies)
      .set({
        status: 'replied',
        replyData: body.data || null,
        replyEffects: (body.effects as any) || null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(pendingToolReplies.id, pendingReply.id),
        eq(pendingToolReplies.status, 'pending'),
      ))
      .returning({ id: pendingToolReplies.id });

    if (updated.length === 0) {
      throw new ToolReplyError('Tool reply was already processed by another request');
    }

    logger.info(
      {
        requestId,
        conversationId: pendingReply.conversationId,
        hasEffects: !!body.effects,
        effectsCount: body.effects?.length || 0,
      },
      'Tool reply stored successfully',
    );

    // Notify the ConversationRunner to process the reply
    await this.notifyConversationRunner(pendingReply.conversationId, requestId, body.data || null, body.effects || null);

    return {
      success: true,
      requestId,
      message: 'Reply accepted and queued for processing',
    };
  }

  /**
   * Notify the active ConversationRunner that a tool reply has been received.
   * This allows the runner to process the reply and resume the conversation.
   * When errorMessage is provided, the runner will emit a failed tool_reply event.
   */
  private async notifyConversationRunner(
    conversationId: string,
    requestId: string,
    replyData: Record<string, unknown> | null,
    replyEffects: Effect[] | null,
    errorMessage?: string,
  ): Promise<void> {
    try {
      const sessions = this.sessionManager.getSessionsForConversation(conversationId);
      if (sessions.length === 0) {
        logger.warn(
          { conversationId, requestId },
          'No active session found for conversation — reply stored but runner not notified',
        );
        return;
      }

      for (const session of sessions) {
        if (session.runner) {
          logger.info(
            { conversationId, requestId, sessionId: session.id },
            errorMessage ? 'Enqueueing failed tool reply for notification' : 'Enqueueing tool reply for processing',
          );
          await session.runner.enqueueOperation('tool_reply', async () => {
            await session.runner!.handleToolReplyReceived(requestId, replyData, replyEffects, errorMessage);
          });
        }
      }
    } catch (error) {
      logger.error(
        { conversationId, requestId, error: error instanceof Error ? error.message : String(error) },
        'Failed to enqueue tool reply',
      );
    }
  }

  /**
   * Create a new pending tool reply record.
   * Called by ToolExecutor when a webhook returns a deferred response.
   */
  public async createPendingReply(
    projectId: string,
    conversationId: string,
    toolId: string,
    requestId: string,
    timeoutMs: number,
  ): Promise<typeof pendingToolReplies.$inferSelect> {
    const expiresAt = new Date(Date.now() + timeoutMs);

    const [record] = await db
      .insert(pendingToolReplies)
      .values({
        id: crypto.randomUUID(),
        projectId,
        conversationId,
        toolId,
        requestId,
        status: 'pending',
        expiresAt,
      })
      .returning();

    logger.info(
      {
        requestId,
        conversationId,
        toolId,
        expiresAt,
      },
      'Created pending tool reply',
    );

    return record;
  }

  /**
   * Get a pending reply by request ID.
   */
  public async getPendingReply(requestId: string): Promise<typeof pendingToolReplies.$inferSelect | undefined> {
    const [record] = await db
      .select()
      .from(pendingToolReplies)
      .where(eq(pendingToolReplies.requestId, requestId))
      .limit(1);

    return record;
  }

  /**
   * Get all pending replies for a conversation.
   * Used by ConversationRunner to check for pending tool replies.
   */
  public async getPendingRepliesForConversation(
    conversationId: string,
  ): Promise<typeof pendingToolReplies.$inferSelect[]> {
    return db
      .select()
      .from(pendingToolReplies)
      .where(
        and(
          eq(pendingToolReplies.conversationId, conversationId),
          eq(pendingToolReplies.status, 'pending'),
        ),
      );
  }

  /**
   * Get all replied but not yet processed replies for a conversation.
   * Used by ConversationRunner to pick up replies and process them.
   */
  public async getRepliedRepliesForConversation(
    conversationId: string,
  ): Promise<typeof pendingToolReplies.$inferSelect[]> {
    return db
      .select()
      .from(pendingToolReplies)
      .where(
        and(
          eq(pendingToolReplies.conversationId, conversationId),
          eq(pendingToolReplies.status, 'replied'),
        ),
      );
  }

  /**
   * Reject a reply that failed validation.
   * Marks the pending reply as failed_validation and notifies the runner so the client gets an event.
   */
  public async rejectInvalidReply(
    requestId: string,
    errorMessage: string,
  ): Promise<void> {
    const [pendingReply] = await db
      .select()
      .from(pendingToolReplies)
      .where(eq(pendingToolReplies.requestId, requestId))
      .limit(1);

    if (!pendingReply) {
      logger.warn({ requestId, error: errorMessage }, 'Validation failed but no pending reply found to mark');
      return;
    }

    if (pendingReply.status !== 'pending') {
      logger.warn({ requestId, status: pendingReply.status }, 'Reply already processed — skipping validation rejection');
      return;
    }

    const updated = await db
      .update(pendingToolReplies)
      .set({ status: 'failed_validation', updatedAt: new Date() })
      .where(and(
        eq(pendingToolReplies.id, pendingReply.id),
        eq(pendingToolReplies.status, 'pending'),
      ))
      .returning({ id: pendingToolReplies.id });

    if (updated.length === 0) {
      logger.warn({ requestId }, 'Reply was processed concurrently — skipping validation rejection');
      return;
    }

    logger.info({ requestId, conversationId: pendingReply.conversationId, error: errorMessage }, 'Tool reply rejected — invalid payload');

    await this.notifyConversationRunner(
      pendingReply.conversationId,
      requestId,
      null,
      null,
      errorMessage,
    );
  }

  /**
    * Check and expire any timed-out pending replies for a conversation.
    * Returns the request IDs of expired entries so the caller can clean up local state.
    */
  public async expireTimedOutReplies(
    conversationId: string,
  ): Promise<string[]> {
    const now = new Date();
    const result = await db
      .update(pendingToolReplies)
      .set({
        status: 'timed_out',
        updatedAt: now,
      })
      .where(
        and(
          eq(pendingToolReplies.conversationId, conversationId),
          eq(pendingToolReplies.status, 'pending'),
          lt(pendingToolReplies.expiresAt, now),
        ),
      )
      .returning({ requestId: pendingToolReplies.requestId });

    const expiredIds = result.map(r => r.requestId);
    logger.info(
      { conversationId, count: expiredIds.length, requestIds: expiredIds },
      'Expired timed out tool replies',
    );

    return expiredIds;
  }

  /**
   * Discard a pending reply. Used when the tool effect has `asynchronous: true` —
   * the deferred reply should be ignored, matching the fire-and-forget semantics.
   */
  public async discardPendingReply(requestId: string): Promise<void> {
    const updated = await db
      .update(pendingToolReplies)
      .set({ status: 'discarded', updatedAt: new Date() })
      .where(and(
        eq(pendingToolReplies.requestId, requestId),
        eq(pendingToolReplies.status, 'pending'),
      ))
      .returning({ id: pendingToolReplies.id });

    if (updated.length === 0) {
      logger.warn({ requestId }, 'Pending reply already processed — cannot discard');
    } else {
      logger.info({ requestId }, 'Discarded pending tool reply (asynchronous effect)');
    }
  }
}
