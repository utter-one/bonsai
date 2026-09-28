import { singleton } from 'tsyringe';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index';
import { providers, type ProviderFallback } from '../../db/schema';
import { logger } from '../../utils/logger';

/** Full row of the providers table (as selected by Drizzle). */
export type ProviderRow = typeof providers.$inferSelect;

/**
 * One step in a resolved fallback chain. The primary step has
 * `settings` undefined; fallback steps carry their per-fallback settings
 * override when one was configured.
 */
export interface FallbackStep {
  provider: ProviderRow;
  settings?: Record<string, unknown>;
}

interface CachedChain {
  version: number;
  steps: FallbackStep[];
}

/**
 * Resolves a provider's full fallback chain ([primary, ...fallbacks]).
 * Single source of chain semantics for the Phase-3 failover wrappers
 * (P3-03/P3-04) — P3-05's single-hop outbound fallback does not use it.
 *
 * Chains are cached keyed by provider id and validated against the
 * primary's current `version`; ProviderService invalidates entries on
 * provider create/update/delete (including reverse invalidation when a
 * fallback target is deleted). A deleted fallback target is dropped from
 * the chain with a warning — a dangling fallback must not 500 a call.
 */
@singleton()
export class FallbackResolver {
  private readonly cache = new Map<string, CachedChain>();

  /**
   * Resolves the ordered chain for a provider. Returns [] when the primary
   * does not exist (the caller decides how to surface that).
   */
  async resolveChain(providerId: string): Promise<FallbackStep[]> {
    const primary = await this.fetchProvider(providerId);
    if (!primary) {
      return [];
    }

    const cached = this.cache.get(providerId);
    if (cached && cached.version === primary.version) {
      return cached.steps;
    }

    const steps: FallbackStep[] = [{ provider: primary }];
    const fallbacks: ProviderFallback[] = primary.fallbacks ?? [];
    if (fallbacks.length > 0) {
      const targets = await this.fetchProviders(fallbacks.map((f) => f.providerId));
      const byId = new Map(targets.map((t) => [t.id, t] as const));
      for (const fallback of fallbacks) {
        const target = byId.get(fallback.providerId);
        if (!target) {
          logger.warn({ providerId, fallbackProviderId: fallback.providerId }, 'Fallback target no longer exists — dropping it from the chain');
          continue;
        }
        steps.push({ provider: target, settings: fallback.settings ?? undefined });
      }
    }

    this.cache.set(providerId, { version: primary.version, steps });
    return steps;
  }

  /** Drops the cached chain for a provider (call after create/update). */
  invalidate(providerId: string): void {
    this.cache.delete(providerId);
  }

  /**
   * Drops cached chains of every provider whose fallbacks reference
   * `targetId` (call after a provider delete).
   */
  async invalidateReferences(targetId: string): Promise<void> {
    const referencing = await db
      .select({ id: providers.id })
      .from(providers)
      .where(sql`${providers.fallbacks} @> ${JSON.stringify([{ providerId: targetId }])}::jsonb`);
    for (const row of referencing) {
      this.cache.delete(row.id);
    }
  }

  protected async fetchProvider(id: string): Promise<ProviderRow | undefined> {
    const rows = await db.select().from(providers).where(eq(providers.id, id));
    return rows[0];
  }

  protected async fetchProviders(ids: string[]): Promise<ProviderRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return await db.select().from(providers).where(inArray(providers.id, ids));
  }
}
