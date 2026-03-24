import { singleton, inject } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { providers } from '../db/schema';
import { LlmProviderFactory } from './providers/llm/LlmProviderFactory';
import { logger } from '../utils/logger';

export type ModerationConfig = {
  enabled: boolean;
  llmProviderId: string;
  /** Provider-specific category names that should cause blocking. Empty/undefined = block on any flag. */
  blockedCategories?: string[];
};

export type ModerationResult = {
  flagged: boolean;
  blockingCategories: string[];
  detectedCategories: string[];
  durationMs: number;
  /** Unix timestamp (ms) when the moderation API call started; 0 when moderation was not performed */
  startMs: number;
};

/**
 * Service for moderating user input using the configured LLM provider moderation API.
 * Returns a non-flagged result if moderation is disabled, the provider is not found,
 * or the provider does not support moderation (fail-open policy).
 */
@singleton()
export class ModerationService {
  constructor(@inject(LlmProviderFactory) private readonly llmProviderFactory: LlmProviderFactory) {}

  /**
   * Moderates user input against the configured LLM provider's moderation API.
   * Fails open: if moderation is disabled, the provider is missing, or the provider
   * does not support moderation, the message is allowed through without blocking.
   * @param input - User input text to moderate
   * @param config - Moderation configuration from the project, or null/undefined if not configured
   * @param projectId - Project ID used for logging context
   * @returns Moderation result with flagged status, violated categories, and call duration
   */
  async moderate(input: string, config: ModerationConfig | null | undefined, projectId: string): Promise<ModerationResult> {
    if (!config || !config.enabled) {
      return { flagged: false, blockingCategories: [], detectedCategories: [], durationMs: 0, startMs: 0 };
    }

    const providerEntity = await db.query.providers.findFirst({ where: eq(providers.id, config.llmProviderId) });
    if (!providerEntity) {
      logger.warn({ projectId, llmProviderId: config.llmProviderId }, 'Moderation provider not found, allowing message through');
      return { flagged: false, blockingCategories: [], detectedCategories: [], durationMs: 0, startMs: 0 };
    }

    const provider = this.llmProviderFactory.createProviderForEnumeration(providerEntity);
    await provider.init();

    const startMs = Date.now();
    try {
      const result = await provider.moderateUserInput(input);
      const effectiveCategories = this.applyBlocklist(result.categories, config.blockedCategories);
      return { flagged: effectiveCategories.length > 0, blockingCategories: effectiveCategories, detectedCategories: result.categories, durationMs: Date.now() - startMs, startMs };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('not supported')) {
        logger.warn({ projectId, llmProviderId: config.llmProviderId }, 'Provider does not support moderation, allowing message through');
      } else {
        logger.error({ projectId, llmProviderId: config.llmProviderId, error: message }, 'Moderation check failed, allowing message through');
      }
      return { flagged: false, blockingCategories: [], detectedCategories: [], durationMs: Date.now() - startMs, startMs };
    }
  }

  /**
   * Filters flagged categories against an optional blocklist.
   * If `blockedCategories` is empty or undefined, all flagged categories are returned as-is.
   * Otherwise, only categories present in the blocklist are returned; blocking occurs only when this set is non-empty.
   */
  private applyBlocklist(flaggedCategories: string[], blockedCategories?: string[]): string[] {
    if (!blockedCategories || blockedCategories.length === 0) {
      return flaggedCategories;
    }
    const blockSet = new Set(blockedCategories);
    return flaggedCategories.filter(c => blockSet.has(c));
  }
}
