import { ValidationError } from '../../errors';
import type { ProviderFallback } from '../../db/schema';

/**
 * A node in the fallback graph as loaded from the providers table.
 * `fallbackTargetIds` are the provider ids in the node's stored `fallbacks`
 * column, in order.
 */
export type FallbackGraphNodes = Map<string, { providerType: string; fallbackTargetIds: string[] }>;

/**
 * Validates a fallback chain being written for `primaryId` (pure — no I/O).
 *
 * Rules (all violations are 400 ValidationError — the chain is data integrity
 * of the payload being written, not a resource lookup):
 * - duplicate entries
 * - self-reference
 * - missing target
 * - providerType mismatch between primary and target
 * - cycle reachable from the primary's NEW outgoing edges (e.g. A→B while B→A)
 *
 * `graph` must contain every provider reachable from `newFallbacks` (the
 * caller loads it transitively); the primary's own stored outgoing edges are
 * irrelevant because they are being replaced.
 */
export function validateFallbacks(
  primaryId: string,
  primaryType: string,
  newFallbacks: ProviderFallback[],
  graph: FallbackGraphNodes,
): void {
  const seen = new Set<string>();
  for (const fallback of newFallbacks) {
    if (seen.has(fallback.providerId)) {
      throw new ValidationError(`Duplicate fallback provider ${fallback.providerId} in fallbacks list`, [
        { code: 'custom', path: ['fallbacks'], message: `Duplicate fallback provider ${fallback.providerId}` },
      ]);
    }
    seen.add(fallback.providerId);

    // Checked before existence: on create the primary's own id is not in the
    // graph yet, and this must still report as a self-reference.
    if (fallback.providerId === primaryId) {
      throw new ValidationError(`Fallback chain of provider ${primaryId} cannot reference itself`, [
        { code: 'custom', path: ['fallbacks'], message: `Fallback chain of provider ${primaryId} cannot reference itself` },
      ]);
    }

    const target = graph.get(fallback.providerId);
    if (!target) {
      throw new ValidationError(`Fallback target provider ${fallback.providerId} does not exist`, [
        { code: 'custom', path: ['fallbacks'], message: `Fallback target provider ${fallback.providerId} does not exist` },
      ]);
    }
    if (target.providerType !== primaryType) {
      throw new ValidationError(
        `Fallback target provider ${fallback.providerId} has type ${target.providerType}, expected ${primaryType} (fallbacks must match the primary's providerType)`,
        [{ code: 'custom', path: ['fallbacks'], message: `Fallback target ${fallback.providerId} type mismatch: ${target.providerType} !== ${primaryType}` }],
      );
    }
  }

  // Cycle check: walk the existing graph from the primary's NEW outgoing
  // edges; reaching the primary again means the write would create a cycle.
  const visited = new Set<string>([primaryId, ...newFallbacks.map((f) => f.providerId)]);
  let frontier = newFallbacks.map((f) => f.providerId);
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = graph.get(id);
      for (const targetId of node?.fallbackTargetIds ?? []) {
        if (targetId === primaryId) {
          throw new ValidationError(`Cycle in fallback chain: following existing fallbacks from the new targets reaches ${primaryId}`, [
            { code: 'custom', path: ['fallbacks'], message: `Cycle in fallback chain involving ${primaryId}` },
          ]);
        }
        if (!visited.has(targetId)) {
          visited.add(targetId);
          next.push(targetId);
        }
      }
    }
    frontier = next;
  }
}
