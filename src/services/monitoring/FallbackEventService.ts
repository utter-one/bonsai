import { singleton } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { fallbackEvents } from '../../db/schema';
import { generateId, ID_PREFIXES } from '../../utils/idGenerator';
import { logger } from '../../utils/logger';

/**
 * Input for one fallback_events row (one failover transition).
 * `reason` is the failed primary attempt's error code.
 */
export interface FallbackEventInput {
  providerId: string;
  fallbackProviderId: string;
  providerType: string;
  operation: string;
  reason: string;
  projectId?: string | null;
  conversationId?: string | null;
  /** Whether the fallback ultimately served the request. Defaults to false — flipped later via markSucceeded. */
  success?: boolean;
}

/**
 * The single write path for fallback_events rows (P1-01 table) — used by the
 * P3-03/P3-04/P3-05 failover wrappers so the event shape can never drift
 * between them. Standard monitoring failure policy: never throws; failures
 * are logged and the caller proceeds (returns null instead of a row id).
 */
@singleton()
export class FallbackEventService {
  /**
   * Inserts one fallback_events row (success defaults to false) and returns
   * its id so the caller can mark it succeeded later. Returns null when the
   * insert fails — never throws.
   */
  async record(input: FallbackEventInput): Promise<{ id: string } | null> {
    try {
      const id = generateId(ID_PREFIXES.FALLBACK_EVENT);
      const rows = await db
        .insert(fallbackEvents)
        .values({
          id,
          providerId: input.providerId,
          fallbackProviderId: input.fallbackProviderId,
          providerType: input.providerType,
          operation: input.operation,
          reason: input.reason,
          projectId: input.projectId ?? null,
          conversationId: input.conversationId ?? null,
          success: input.success ?? false,
        })
        .returning();
      return { id: rows[0].id };
    } catch (error) {
      logger.error({ error, providerId: input.providerId, fallbackProviderId: input.fallbackProviderId }, 'Failed to record fallback event');
      return null;
    }
  }

  /**
   * Flips a previously recorded event to success=true (one UPDATE).
   * Fire-and-forget semantics: never throws.
   */
  async markSucceeded(rowId: string): Promise<void> {
    try {
      await db.update(fallbackEvents).set({ success: true }).where(eq(fallbackEvents.id, rowId));
    } catch (error) {
      logger.error({ error, rowId }, 'Failed to mark fallback event as succeeded');
    }
  }
}
