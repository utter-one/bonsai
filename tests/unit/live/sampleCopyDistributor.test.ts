import { describe, it } from 'mocha';
import { expect } from 'chai';
import { SampleCopyDistributor } from '../../../src/services/live/SampleCopyDistributor';
import type { SampleCopy } from '../../../src/types/models';

function makeSampleCopy(name: string, method: 'random' | 'round_robin' | 'forced', content: string[], amount: number = 1): SampleCopy {
  return {
    id: `sc_${name}`,
    projectId: 'proj_test',
    name,
    samplingMethod: method,
    amount,
    content,
    forcedStageId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: null,
  } as any;
}

describe('SampleCopyDistributor', () => {
  describe('constructor', () => {
    it('initializes state for each copy', () => {
      const copies = [makeSampleCopy('a', 'round_robin', ['Hello', 'Hi']), makeSampleCopy('b', 'random', ['Bye', 'See ya'])];
      const distributor = new SampleCopyDistributor(copies);
      expect(distributor.hasName('a')).to.equal(true);
      expect(distributor.hasName('b')).to.equal(true);
      expect(distributor.hasName('c')).to.equal(false);
    });

    it('handles empty array', () => {
      const distributor = new SampleCopyDistributor([]);
      expect(distributor.hasName('anything')).to.equal(false);
    });
  });

  describe('getOriginalCopies', () => {
    it('returns the original copies array', () => {
      const copies = [makeSampleCopy('a', 'round_robin', ['Hello'])];
      const distributor = new SampleCopyDistributor(copies);
      expect(distributor.getOriginalCopies()).to.deep.equal(copies);
    });
  });

  describe('distributeCopies with round_robin', () => {
    it('returns copies in sequential order', () => {
      const copies = [makeSampleCopy('greetings', 'round_robin', ['Hello', 'Hi', 'Hey'], 1)];
      const distributor = new SampleCopyDistributor(copies);

      const first = distributor.distributeCopies('greetings');
      expect(first).to.deep.equal(['Hello']);

      const second = distributor.distributeCopies('greetings');
      expect(second).to.deep.equal(['Hi']);

      const third = distributor.distributeCopies('greetings');
      expect(third).to.deep.equal(['Hey']);
    });

    it('wraps around after exhausting content', () => {
      const copies = [makeSampleCopy('greetings', 'round_robin', ['Hello', 'Hi'], 1)];
      const distributor = new SampleCopyDistributor(copies);

      distributor.distributeCopies('greetings'); // Hello
      distributor.distributeCopies('greetings'); // Hi
      const third = distributor.distributeCopies('greetings'); // wraps to Hello
      expect(third).to.deep.equal(['Hello']);
    });

    it('returns multiple copies per call when amount > 1', () => {
      const copies = [makeSampleCopy('greetings', 'round_robin', ['A', 'B', 'C', 'D'], 2)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('greetings');
      expect(result).to.have.length(2);
      expect(result).to.deep.equal(['A', 'B']);
    });

    it('wraps correctly with amount > content length', () => {
      const copies = [makeSampleCopy('greetings', 'round_robin', ['A', 'B'], 4)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('greetings');
      expect(result).to.have.length(4);
      expect(result).to.deep.equal(['A', 'B', 'A', 'B']);
    });

    it('handles empty content array with amount 0', () => {
      const copies = [makeSampleCopy('empty', 'round_robin', [], 0)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('empty');
      expect(result).to.deep.equal([]);
    });

    it('handles single content item with amount > 1', () => {
      const copies = [makeSampleCopy('single', 'round_robin', ['Only'], 3)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('single');
      expect(result).to.deep.equal(['Only', 'Only', 'Only']);
    });
  });

  describe('distributeCopies with random', () => {
    it('returns the requested number of copies', () => {
      const copies = [makeSampleCopy('random', 'random', ['A', 'B', 'C', 'D', 'E'], 3)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('random');
      expect(result).to.have.length(3);
      // All items should be from the original content
      for (const item of result) {
        expect(['A', 'B', 'C', 'D', 'E']).to.include(item);
      }
    });

    it('returns unique items (no duplicates in single call)', () => {
      const copies = [makeSampleCopy('random', 'random', ['A', 'B', 'C', 'D', 'E'], 3)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('random');
      const unique = new Set(result);
      expect(unique.size).to.equal(result.length);
    });

    it('handles amount >= content length', () => {
      const copies = [makeSampleCopy('random', 'random', ['A', 'B'], 5)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('random');
      expect(result).to.have.length(2); // limited by content length
    });

    it('handles amount = 0', () => {
      const copies = [makeSampleCopy('random', 'random', ['A', 'B', 'C'], 0)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('random');
      expect(result).to.deep.equal([]);
    });

    it('handles single content item', () => {
      const copies = [makeSampleCopy('random', 'random', ['Only'], 1)];
      const distributor = new SampleCopyDistributor(copies);

      const result = distributor.distributeCopies('random');
      expect(result).to.deep.equal(['Only']);
    });
  });

  describe('distributeCopies errors', () => {
    it('throws for unknown sample copy ID', () => {
      const distributor = new SampleCopyDistributor([makeSampleCopy('a', 'round_robin', ['Hello'])]);
      expect(() => distributor.distributeCopies('unknown')).to.throw('Sample copy with ID unknown not found in distributor');
    });

    it('throws for unsupported sampling method', () => {
      const copy = makeSampleCopy('bad', 'forced' as any, ['Hello']);
      const distributor = new SampleCopyDistributor([copy]);
      expect(() => distributor.distributeCopies('bad')).to.throw('Unsupported sampling method: forced');
    });
  });

  describe('forced mode', () => {
    it('forced sampling method throws in distributeCopies', () => {
      // forced mode is handled by ConversationRunner, not by distributeCopies
      const copy = makeSampleCopy('forced', 'forced', ['Hello']);
      const distributor = new SampleCopyDistributor([copy]);
      expect(() => distributor.distributeCopies('forced')).to.throw('Unsupported sampling method: forced');
    });
  });
});
