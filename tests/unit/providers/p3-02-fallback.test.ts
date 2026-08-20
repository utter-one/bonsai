import 'reflect-metadata';
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { validateFallbacks, type FallbackGraphNodes } from '../../../src/services/providers/fallbackValidation';
import { FallbackResolver, type FallbackStep, type ProviderRow } from '../../../src/services/providers/FallbackResolver';
import { ValidationError } from '../../../src/errors';
import { createProviderSchema, updateProviderBodySchema, providerResponseSchema } from '../../../src/http/contracts/provider';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fallback = (providerId: string, settings?: Record<string, unknown>) =>
  ({ providerId, settings }) as { providerId: string; settings?: Record<string, unknown> };

function graphOf(nodes: Record<string, { type?: string; fallbacks?: string[] }>): FallbackGraphNodes {
  const graph: FallbackGraphNodes = new Map();
  for (const [id, node] of Object.entries(nodes)) {
    graph.set(id, { providerType: node.type ?? 'llm', fallbackTargetIds: node.fallbacks ?? [] });
  }
  return graph;
}

let rowCounter = 0;
function providerRow(id: string, overrides: Partial<ProviderRow> = {}): ProviderRow {
  rowCounter += 1;
  return {
    id,
    name: `Provider ${id}`,
    description: null,
    providerType: 'llm',
    apiType: 'openai',
    config: { apiKey: `sk-${rowCounter}` },
    fallbacks: [],
    createdBy: null,
    tags: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProviderRow;
}

/** FallbackResolver with the DB fetch seams replaced by an in-memory map. */
class MemoryResolver extends FallbackResolver {
  readonly store: Map<string, ProviderRow>;

  constructor(rows: ProviderRow[]) {
    super();
    this.store = new Map(rows.map((r) => [r.id, r]));
  }

  protected async fetchProvider(id: string): Promise<ProviderRow | undefined> {
    return this.store.get(id);
  }

  protected async fetchProviders(ids: string[]): Promise<ProviderRow[]> {
    return ids.map((id) => this.store.get(id)).filter((r): r is ProviderRow => r !== undefined);
  }
}

// ---------------------------------------------------------------------------
// validateFallbacks — pure validation matrix
// ---------------------------------------------------------------------------

describe('fallbackValidation (P3-02, unit)', () => {
  it('accepts a valid chain (order preserved, transitive targets allowed)', () => {
    const graph = graphOf({ B: { fallbacks: ['C'] }, C: {} });
    expect(() => validateFallbacks('A', 'llm', [fallback('B'), fallback('C')], graph)).to.not.throw();
  });

  it('accepts a chain whose targets have fallbacks that do not loop back', () => {
    const graph = graphOf({ B: { fallbacks: ['C'] }, C: { fallbacks: ['D'] }, D: {} });
    expect(() => validateFallbacks('A', 'llm', [fallback('B')], graph)).to.not.throw();
  });

  it('rejects a missing target', () => {
    const graph = graphOf({ B: {} });
    expect(() => validateFallbacks('A', 'llm', [fallback('B'), fallback('GHOST')], graph))
      .to.throw(ValidationError, /GHOST does not exist/);
  });

  it('rejects a providerType mismatch', () => {
    const graph = graphOf({ B: { type: 'tts' } });
    expect(() => validateFallbacks('A', 'llm', [fallback('B')], graph))
      .to.throw(ValidationError, /type mismatch|has type tts/);
  });

  it('rejects a self-reference', () => {
    const graph = graphOf({});
    expect(() => validateFallbacks('A', 'llm', [fallback('A')], graph))
      .to.throw(ValidationError, /cannot reference itself/);
  });

  it('rejects duplicates in the list', () => {
    const graph = graphOf({ B: {} });
    expect(() => validateFallbacks('A', 'llm', [fallback('B'), fallback('B')], graph))
      .to.throw(ValidationError, /Duplicate fallback provider B/);
  });

  it('rejects a 2-cycle (A→B while B→A)', () => {
    const graph = graphOf({ B: { fallbacks: ['A'] } });
    expect(() => validateFallbacks('A', 'llm', [fallback('B')], graph))
      .to.throw(ValidationError, /Cycle in fallback chain/);
  });

  it('rejects a 3-cycle (A→B while B→C→A)', () => {
    const graph = graphOf({ B: { fallbacks: ['C'] }, C: { fallbacks: ['A'] } });
    expect(() => validateFallbacks('A', 'llm', [fallback('B')], graph))
      .to.throw(ValidationError, /Cycle in fallback chain/);
  });

  it('does not flag a pre-existing cycle that the new list does not reach', () => {
    // B→C→B exists already (legacy/other primary); A→D is unrelated.
    const graph = graphOf({ B: { fallbacks: ['C'] }, C: { fallbacks: ['B'] }, D: {} });
    expect(() => validateFallbacks('A', 'llm', [fallback('D')], graph)).to.not.throw();
  });

  it('reports validation errors with the Zod-compatible details shape', () => {
    const graph = graphOf({});
    try {
      validateFallbacks('A', 'llm', [fallback('GHOST')], graph);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).to.be.instanceOf(ValidationError);
      const details = (error as ValidationError).details;
      expect(details).to.have.length(1);
      expect(details[0].code).to.equal('custom');
      expect(details[0].path).to.deep.equal(['fallbacks']);
      expect(details[0].message).to.match(/GHOST/);
    }
  });
});

// ---------------------------------------------------------------------------
// FallbackResolver — chain shape, cache, deleted targets
// ---------------------------------------------------------------------------

describe('FallbackResolver (P3-02, unit)', () => {
  it('returns [primary, ...fallbacks] in order with per-fallback settings', async () => {
    const b = providerRow('B');
    const c = providerRow('C');
    const a = providerRow('A', { fallbacks: [fallback('B', { model: 'm-1' }), fallback('C')] });
    const resolver = new MemoryResolver([a, b, c]);

    const chain = await resolver.resolveChain('A');
    expect(chain).to.have.length(3);
    expect(chain.map((s: FallbackStep) => s.provider.id)).to.deep.equal(['A', 'B', 'C']);
    expect(chain[0].settings).to.equal(undefined);
    expect(chain[1].settings).to.deep.equal({ model: 'm-1' });
    expect(chain[2].settings).to.equal(undefined);
  });

  it('returns [primary] alone when fallbacks is empty', async () => {
    const a = providerRow('A');
    const chain = await new MemoryResolver([a]).resolveChain('A');
    expect(chain).to.have.length(1);
    expect(chain[0].provider.id).to.equal('A');
  });

  it('returns [] when the primary does not exist', async () => {
    const chain = await new MemoryResolver([providerRow('B')]).resolveChain('GHOST');
    expect(chain).to.deep.equal([]);
  });

  it('drops a deleted fallback target with the remaining chain intact', async () => {
    const c = providerRow('C');
    const a = providerRow('A', { fallbacks: [fallback('B'), fallback('C')] });
    const resolver = new MemoryResolver([a, c]); // B was deleted
    const chain = await resolver.resolveChain('A');
    expect(chain.map((s: FallbackStep) => s.provider.id)).to.deep.equal(['A', 'C']);
  });

  it('serves the cached chain while the primary version is unchanged', async () => {
    const b = providerRow('B', { version: 7 });
    const a = providerRow('A', { fallbacks: [fallback('B')] });
    const resolver = new MemoryResolver([a, b]);

    const first = await resolver.resolveChain('A');
    // Replace the target row behind the cache — a cache hit must not see it.
    resolver.store.set('B', providerRow('B', { name: 'Renamed B', version: 7 }));
    const second = await resolver.resolveChain('A');
    expect(second[1].provider.name).to.equal('Provider B');
    expect(second[1].provider.id).to.equal(first[1].provider.id);
  });

  it('re-resolves after the primary version changes', async () => {
    const b = providerRow('B');
    const c = providerRow('C');
    const a = providerRow('A', { fallbacks: [fallback('B')], version: 1 });
    const resolver = new MemoryResolver([a, b, c]);
    await resolver.resolveChain('A');

    a.version = 2;
    a.fallbacks = [fallback('C')];
    const chain = await resolver.resolveChain('A');
    expect(chain.map((s: FallbackStep) => s.provider.id)).to.deep.equal(['A', 'C']);
  });

  it('invalidate() forces a re-resolution even with the same version', async () => {
    const b = providerRow('B');
    const c = providerRow('C');
    const a = providerRow('A', { fallbacks: [fallback('B')] });
    const resolver = new MemoryResolver([a, b, c]);
    await resolver.resolveChain('A');

    a.fallbacks = [fallback('C')]; // same version — cache would be stale
    resolver.invalidate('A');
    const chain = await resolver.resolveChain('A');
    expect(chain.map((s: FallbackStep) => s.provider.id)).to.deep.equal(['A', 'C']);
  });
});

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

describe('provider contracts fallbacks (P3-02, unit)', () => {
  const baseCreate = {
    name: 'P',
    providerType: 'storage' as const,
    apiType: 'local' as const,
    config: { basePath: '/tmp/x' },
  };

  it('create: fallbacks defaults to [] and preserves order + settings', () => {
    const parsed = createProviderSchema.parse({ ...baseCreate, fallbacks: [{ providerId: 'p2', settings: { model: 'm' } }, { providerId: 'p3' }] });
    expect(parsed.fallbacks).to.have.length(2);
    expect(parsed.fallbacks[0].providerId).to.equal('p2');
    expect(parsed.fallbacks[0].settings).to.deep.equal({ model: 'm' });

    const defaulted = createProviderSchema.parse(baseCreate);
    expect(defaulted.fallbacks).to.deep.equal([]);
  });

  it('create: rejects more than 3 fallbacks', () => {
    const res = createProviderSchema.safeParse({
      ...baseCreate,
      fallbacks: [{ providerId: 'a' }, { providerId: 'b' }, { providerId: 'c' }, { providerId: 'd' }],
    });
    expect(res.success).to.equal(false);
  });

  it('create: rejects a fallback entry without providerId', () => {
    const res = createProviderSchema.safeParse({ ...baseCreate, fallbacks: [{ settings: {} }] });
    expect(res.success).to.equal(false);
  });

  it('update: omitted fallbacks stay undefined (no change); [] clears', () => {
    const omitted = updateProviderBodySchema.parse({ version: 1 });
    expect(omitted.fallbacks).to.equal(undefined);
    const cleared = updateProviderBodySchema.parse({ version: 1, fallbacks: [] });
    expect(cleared.fallbacks).to.deep.equal([]);
    const set = updateProviderBodySchema.parse({ version: 1, fallbacks: [{ providerId: 'p2' }] });
    expect(set.fallbacks).to.have.length(1);
  });

  it('update: rejects more than 3 fallbacks', () => {
    const res = updateProviderBodySchema.safeParse({
      version: 1,
      fallbacks: [{ providerId: 'a' }, { providerId: 'b' }, { providerId: 'c' }, { providerId: 'd' }],
    });
    expect(res.success).to.equal(false);
  });

  it('response schema carries fallbacks', () => {
    const row = providerRow('A', { fallbacks: [fallback('B')], providerType: 'storage', apiType: 'local', config: { basePath: '/tmp/x' } });
    const parsed = providerResponseSchema.parse(row);
    expect(parsed.fallbacks).to.have.length(1);
    expect(parsed.fallbacks[0].providerId).to.equal('B');
  });
});
