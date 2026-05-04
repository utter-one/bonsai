import { describe, it, expect } from 'vitest';
import type { CostManagementConfig, ProviderModelLimits } from '../../src/http/contracts/costManagement';
import { resolveProviderModelLimits, resolveOutputCap } from '../../src/utils/costManagement';

describe('resolveProviderModelLimits', () => {
  const makeConfig = (limits: CostManagementConfig['limits']): CostManagementConfig => ({ limits });

  it('returns undefined when config is null', () => {
    expect(resolveProviderModelLimits(null, 'prov1', 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined when config is undefined', () => {
    expect(resolveProviderModelLimits(undefined, 'prov1', 'gpt-4o')).toBeUndefined();
  });

  it('returns undefined when config has no limits', () => {
    expect(resolveProviderModelLimits({}, 'prov1', 'gpt-4o')).toBeUndefined();
  });

  it('returns exact provider+model match (highest priority)', () => {
    const limits = {
      prov1: { 'gpt-4o': { outputTokensLimits: { completion: 100 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', 'gpt-4o');
    expect(result).toEqual({ outputTokensLimits: { completion: 100 } });
  });

  it('falls back to provider wildcard when model not found', () => {
    const limits = {
      prov1: { '*': { outputTokensLimits: { completion: 200 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', 'gpt-4o');
    expect(result).toEqual({ outputTokensLimits: { completion: 200 } });
  });

  it('exact model match takes priority over provider wildcard', () => {
    const limits = {
      prov1: {
        'gpt-4o': { outputTokensLimits: { completion: 100 } },
        '*': { outputTokensLimits: { completion: 200 } },
      },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', 'gpt-4o');
    expect(result).toEqual({ outputTokensLimits: { completion: 100 } });
  });

  it('falls back to global wildcard when provider not found', () => {
    const limits = {
      '*': { '*': { outputTokensLimits: { completion: 300 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', 'gpt-4o');
    expect(result).toEqual({ outputTokensLimits: { completion: 300 } });
  });

  it('provider wildcard takes priority over global wildcard', () => {
    const limits = {
      prov1: { '*': { outputTokensLimits: { completion: 200 } } },
      '*': { '*': { outputTokensLimits: { completion: 300 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', 'gpt-4o');
    expect(result).toEqual({ outputTokensLimits: { completion: 200 } });
  });

  it('returns undefined when model is undefined and no provider wildcard', () => {
    const limits = {
      prov1: { 'gpt-4o': { outputTokensLimits: { completion: 100 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', undefined);
    expect(result).toBeUndefined();
  });

  it('provider wildcard matches when model is undefined', () => {
    const limits = {
      prov1: { '*': { outputTokensLimits: { completion: 200 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', undefined);
    expect(result).toEqual({ outputTokensLimits: { completion: 200 } });
  });

  it('returns undefined when no match exists at any level', () => {
    const limits = {
      prov2: { 'gpt-4o': { outputTokensLimits: { completion: 100 } } },
    };
    const result = resolveProviderModelLimits(makeConfig(limits), 'prov1', 'gpt-4o');
    expect(result).toBeUndefined();
  });
});

describe('resolveOutputCap', () => {
  const makeLimits = (completion?: number): ProviderModelLimits => ({
    outputTokensLimits: completion ? { completion } : undefined,
  });

  it('returns entity default when no project cap', () => {
    expect(resolveOutputCap(500, undefined, 'completion')).toBe(500);
  });

  it('returns project cap when no entity default', () => {
    expect(resolveOutputCap(undefined, makeLimits(300), 'completion')).toBe(300);
  });

  it('returns undefined when neither is set', () => {
    expect(resolveOutputCap(undefined, undefined, 'completion')).toBeUndefined();
  });

  it('returns the minimum of entity default and project cap', () => {
    expect(resolveOutputCap(500, makeLimits(300), 'completion')).toBe(300);
  });

  it('returns entity default when it is more restrictive', () => {
    expect(resolveOutputCap(100, makeLimits(300), 'completion')).toBe(100);
  });

  it('returns undefined for a request type with no configured cap', () => {
    expect(resolveOutputCap(undefined, {}, 'classification')).toBeUndefined();
  });

  it('returns entity default when project cap exists but not for the given request type', () => {
    const limits: ProviderModelLimits = {
      outputTokensLimits: { classification: 200 },
    };
    expect(resolveOutputCap(500, limits, 'completion')).toBe(500);
  });

  it('handles different request types independently', () => {
    const limits: ProviderModelLimits = {
      outputTokensLimits: { completion: 300, tool: 150 },
    };
    expect(resolveOutputCap(500, limits, 'completion')).toBe(300);
    expect(resolveOutputCap(500, limits, 'tool')).toBe(150);
    expect(resolveOutputCap(500, limits, 'classification')).toBe(500);
  });
});
