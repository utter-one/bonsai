import type { CostManagementConfig, ProviderModelLimits } from '../http/contracts/costManagement';

/**
 * The type of LLM request being made. Used to look up the appropriate token cap from the config.
 */
export type RequestType = 'completion' | 'classification' | 'tool' | 'transformation' | 'filler';

/**
 * Resolves the most specific token limits for a given provider+model combination.
 *
 * Lookup order (most specific wins, no merging):
 * 1. `[providerId][model]` — exact match
 * 2. `[providerId]["*"]` — any model for the given provider
 * 3. `["*"]["*"]` — global fallback
 *
 * @param config - The project cost management config, or null/undefined if not set
 * @param providerId - The provider entity ID (database primary key)
 * @param model - The model name (e.g. "gpt-4o"), or undefined if unknown
 * @returns The most specific matching limits, or undefined if no match
 */
export function resolveProviderModelLimits(config: CostManagementConfig | null | undefined, providerId: string, model: string | undefined): ProviderModelLimits | undefined {
  if (!config?.limits) return undefined;
  const providerLimits = config.limits[providerId];
  if (providerLimits) {
    if (model && providerLimits[model] !== undefined) return providerLimits[model];
    if (providerLimits['*'] !== undefined) return providerLimits['*'];
  }
  return config.limits['*']?.['*'];
}

/**
 * Resolves the effective maximum output token count for a given request, applying the
 * project cap as a hard ceiling over the entity-level default.
 *
 * When both are defined, the minimum (most restrictive) wins.
 *
 * @param entityDefaultMaxTokens - The entity-level defaultMaxTokens from llmSettings, or undefined
 * @param limits - The resolved provider+model limits, or undefined
 * @param requestType - The type of request being made
 * @returns The effective max tokens to pass to the LLM, or undefined if no cap applies
 */
export function resolveOutputCap(entityDefaultMaxTokens: number | undefined, limits: ProviderModelLimits | undefined, requestType: RequestType): number | undefined {
  const projectCap = limits?.outputTokensLimits?.[requestType];
  if (entityDefaultMaxTokens !== undefined && projectCap !== undefined) {
    return Math.min(entityDefaultMaxTokens, projectCap);
  }
  return projectCap ?? entityDefaultMaxTokens;
}
