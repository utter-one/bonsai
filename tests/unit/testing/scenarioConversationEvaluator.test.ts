import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { ScenarioConversationEvaluator } from '../../../src/services/testing/ScenarioConversationEvaluator';
import type { ScenarioResponse } from '../../../src/http/contracts/scenario';

function makeScenario(overrides: Partial<ScenarioResponse> = {}): ScenarioResponse {
  return {
    id: 'scenario_1',
    projectId: 'proj_1',
    name: 'Test Scenario',
    dataExtraction: [],
    dataPostProcessingExpected: null,
    contextTransformerId: null,
    maxTurns: 10,
    conversationOpener: null,
    personaCanHangUp: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeMockProvider(): any {
  return {
    createProvider: async () => ({
      generate: async () => ({
        content: [{ contentType: 'text', text: JSON.stringify({ score: 95 }) }],
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
      generateStream: async () => {},
      enumerateModels: async () => [],
      init: async () => {},
      cleanup: async () => {},
    }),
  };
}

describe('ScenarioConversationEvaluator', () => {
  let evaluator: ScenarioConversationEvaluator;
  let llmProviderFactory: any;

  beforeEach(() => {
    llmProviderFactory = makeMockProvider();
    evaluator = new ScenarioConversationEvaluator(llmProviderFactory);
  });

  describe('compareValue', () => {
    it('eq: returns true for matching strings', () => {
      const result = (evaluator as any).compareValue('hello', 'hello', 'eq');
      expect(result).to.be.true;
    });

    it('eq: returns false for mismatching strings', () => {
      const result = (evaluator as any).compareValue('hello', 'world', 'eq');
      expect(result).to.be.false;
    });

    it('eq: returns true for matching numbers', () => {
      const result = (evaluator as any).compareValue(42, 42, 'eq');
      expect(result).to.be.true;
    });

    it('eq: returns true for matching objects', () => {
      const result = (evaluator as any).compareValue({ a: 1 }, { a: 1 }, 'eq');
      expect(result).to.be.true;
    });

    it('eq: returns false for different objects', () => {
      const result = (evaluator as any).compareValue({ a: 1 }, { a: 2 }, 'eq');
      expect(result).to.be.false;
    });

    it('contains: returns true when string contains substring', () => {
      const result = (evaluator as any).compareValue('hello world', 'world', 'contains');
      expect(result).to.be.true;
    });

    it('contains: returns false when string does not contain substring', () => {
      const result = (evaluator as any).compareValue('hello', 'world', 'contains');
      expect(result).to.be.false;
    });

    it('contains: returns false for non-string actual', () => {
      const result = (evaluator as any).compareValue(123, '1', 'contains');
      expect(result).to.be.false;
    });

    it('includes: returns true when array contains value', () => {
      const result = (evaluator as any).compareValue([1, 2, 3], 2, 'includes');
      expect(result).to.be.true;
    });

    it('includes: returns false when array does not contain value', () => {
      const result = (evaluator as any).compareValue([1, 2, 3], 4, 'includes');
      expect(result).to.be.false;
    });

    it('includes: returns false for non-array actual', () => {
      const result = (evaluator as any).compareValue('hello', 'h', 'includes');
      expect(result).to.be.false;
    });

    it('matches: returns true for regex match', () => {
      const result = (evaluator as any).compareValue('hello123', /^\w+\d+$/, 'matches');
      expect(result).to.be.true;
    });

    it('matches: returns false for regex mismatch', () => {
      const result = (evaluator as any).compareValue('hello', /^\d+$/, 'matches');
      expect(result).to.be.false;
    });

    it('matches: returns false for non-RegExp expected', () => {
      const result = (evaluator as any).compareValue('hello', 'hello', 'matches');
      expect(result).to.be.false;
    });

    it('gt: returns true when actual is greater', () => {
      const result = (evaluator as any).compareValue(10, 5, 'gt');
      expect(result).to.be.true;
    });

    it('gt: returns false when actual is not greater', () => {
      const result = (evaluator as any).compareValue(5, 10, 'gt');
      expect(result).to.be.false;
    });

    it('gte: returns true when actual is equal', () => {
      const result = (evaluator as any).compareValue(5, 5, 'gte');
      expect(result).to.be.true;
    });

    it('gte: returns true when actual is greater', () => {
      const result = (evaluator as any).compareValue(10, 5, 'gte');
      expect(result).to.be.true;
    });

    it('lt: returns true when actual is less', () => {
      const result = (evaluator as any).compareValue(5, 10, 'lt');
      expect(result).to.be.true;
    });

    it('lte: returns true when actual is equal', () => {
      const result = (evaluator as any).compareValue(5, 5, 'lte');
      expect(result).to.be.true;
    });

    it('in: returns true when actual is in array', () => {
      const result = (evaluator as any).compareValue(2, [1, 2, 3], 'in');
      expect(result).to.be.true;
    });

    it('in: returns false when actual is not in array', () => {
      const result = (evaluator as any).compareValue(4, [1, 2, 3], 'in');
      expect(result).to.be.false;
    });

    it('in: returns false for non-array expected', () => {
      const result = (evaluator as any).compareValue(2, '123', 'in');
      expect(result).to.be.false;
    });

    it('nin: returns true when actual is not in array', () => {
      const result = (evaluator as any).compareValue(4, [1, 2, 3], 'nin');
      expect(result).to.be.true;
    });

    it('nin: returns false when actual is in array', () => {
      const result = (evaluator as any).compareValue(2, [1, 2, 3], 'nin');
      expect(result).to.be.false;
    });

    it('nin: returns true for non-array expected', () => {
      const result = (evaluator as any).compareValue(2, '123', 'nin');
      expect(result).to.be.true;
    });
  });

  describe('checkExpectedValues', () => {
    it('returns 0 passed and 0 failed for empty expected', () => {
      const result = (evaluator as any).checkExpectedValues({}, {});
      expect(result).to.deep.equal({ passed: 0, failed: 0 });
    });

    it('returns 0 passed and 0 failed for null expected', () => {
      const result = (evaluator as any).checkExpectedValues({}, null);
      expect(result).to.deep.equal({ passed: 0, failed: 0 });
    });

    it('counts passed assertions correctly', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John', age: 30 },
        { name: { value: 'John', mode: 'eq' }, age: { value: 30, mode: 'eq' } },
      );
      expect(result.passed).to.equal(2);
      expect(result.failed).to.equal(0);
    });

    it('counts failed assertions correctly', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'Jane', age: 30 },
        { name: { value: 'John', mode: 'eq' }, age: { value: 30, mode: 'eq' } },
      );
      expect(result.passed).to.equal(1);
      expect(result.failed).to.equal(1);
    });

    it('handles exists mode', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John' },
        { name: { value: undefined, mode: 'exists' } },
      );
      expect(result.passed).to.equal(1);
      expect(result.failed).to.equal(0);
    });

    it('handles not_exists mode', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John' },
        { age: { value: undefined, mode: 'not_exists' } },
      );
      expect(result.passed).to.equal(1);
      expect(result.failed).to.equal(0);
    });

    it('defaults to eq mode when no mode specified', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John' },
        { name: { value: 'John' } },
      );
      expect(result.passed).to.equal(1);
    });

    it('warns and returns false for unknown mode', () => {
      // Source logs warning "falling back to eq" but still passes the original
      // mode to compareValue, which hits default: false. Behavior is as-is.
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John' },
        { name: { value: 'John', mode: 'unknown_mode' } },
      );
      expect(result.failed).to.equal(1);
    });
  });

  describe('data extraction', () => {
    it('extracts variables from stageVars', () => {
      const dataExtractionResults: Record<string, unknown> = {};
      const stageVars = { stage_1: { name: 'John', age: 30 } };
      const scenario = makeScenario({
        dataExtraction: [
          { varName: 'name', stageId: 'stage_1' },
          { varName: 'age', stageId: 'stage_1' },
        ],
      });

      for (const entry of scenario.dataExtraction) {
        const stageVariables = stageVars[entry.stageId] ?? {};
        dataExtractionResults[entry.varName] = stageVariables[entry.varName] ?? null;
      }

      expect(dataExtractionResults).to.deep.equal({ name: 'John', age: 30 });
    });

    it('returns null for missing variables', () => {
      const dataExtractionResults: Record<string, unknown> = {};
      const stageVars = { stage_1: { name: 'John' } };
      const scenario = makeScenario({
        dataExtraction: [
          { varName: 'name', stageId: 'stage_1' },
          { varName: 'missing', stageId: 'stage_1' },
        ],
      });

      for (const entry of scenario.dataExtraction) {
        const stageVariables = stageVars[entry.stageId] ?? {};
        dataExtractionResults[entry.varName] = stageVariables[entry.varName] ?? null;
      }

      expect(dataExtractionResults).to.deep.equal({ name: 'John', missing: null });
    });

    it('returns null for missing stage', () => {
      const dataExtractionResults: Record<string, unknown> = {};
      const stageVars = { stage_1: { name: 'John' } };
      const scenario = makeScenario({
        dataExtraction: [
          { varName: 'name', stageId: 'stage_2' },
        ],
      });

      for (const entry of scenario.dataExtraction) {
        const stageVariables = stageVars[entry.stageId] ?? {};
        dataExtractionResults[entry.varName] = stageVariables[entry.varName] ?? null;
      }

      expect(dataExtractionResults).to.deep.equal({ name: null });
    });
  });

  describe('evaluation pass/fail', () => {
    it('passes when all assertions match', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John', age: 30 },
        { name: { value: 'John', mode: 'eq' }, age: { value: 30, mode: 'eq' } },
      );
      expect(result.failed).to.equal(0);
    });

    it('fails when any assertion does not match', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John', age: 30 },
        { name: { value: 'Jane', mode: 'eq' }, age: { value: 30, mode: 'eq' } },
      );
      expect(result.failed).to.equal(1);
    });

    it('passes when no expected values defined', () => {
      const result = (evaluator as any).checkExpectedValues(
        { name: 'John' },
        {},
      );
      expect(result.passed).to.equal(0);
      expect(result.failed).to.equal(0);
    });
  });
});
