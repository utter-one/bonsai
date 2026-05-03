import { describe, it, expect } from 'vitest';
import { generateId, ID_PREFIXES } from '../../src/utils/idGenerator';

describe('idGenerator', () => {
  describe('ID_PREFIXES', () => {
    it('defines all expected entity prefixes', () => {
      expect(ID_PREFIXES.OPERATOR).toBe('oper');
      expect(ID_PREFIXES.USER).toBe('user');
      expect(ID_PREFIXES.PROJECT).toBe('proj');
      expect(ID_PREFIXES.AGENT).toBe('agnt');
      expect(ID_PREFIXES.CLASSIFIER).toBe('clas');
      expect(ID_PREFIXES.CONTEXT_TRANSFORMER).toBe('tran');
      expect(ID_PREFIXES.TOOL).toBe('tool');
      expect(ID_PREFIXES.STAGE).toBe('stag');
      expect(ID_PREFIXES.KNOWLEDGE_SECTION).toBe('ksec');
      expect(ID_PREFIXES.KNOWLEDGE_CATEGORY).toBe('kcat');
      expect(ID_PREFIXES.KNOWLEDGE_ITEM).toBe('kitm');
      expect(ID_PREFIXES.GLOBAL_ACTION).toBe('gact');
      expect(ID_PREFIXES.GUARDRAIL).toBe('gurl');
      expect(ID_PREFIXES.PROVIDER).toBe('prov');
      expect(ID_PREFIXES.ENVIRONMENT).toBe('env');
      expect(ID_PREFIXES.API_KEY).toBe('akey');
      expect(ID_PREFIXES.CONVERSATION).toBe('conv');
      expect(ID_PREFIXES.AUDIT).toBe('audt');
      expect(ID_PREFIXES.EVENT).toBe('evnt');
      expect(ID_PREFIXES.REQUEST).toBe('req');
      expect(ID_PREFIXES.INPUT).toBe('tinp');
      expect(ID_PREFIXES.OUTPUT).toBe('tout');
      expect(ID_PREFIXES.CHUNK).toBe('chnk');
      expect(ID_PREFIXES.ARTIFACT).toBe('artf');
      expect(ID_PREFIXES.SAMPLE_COPY).toBe('scpy');
      expect(ID_PREFIXES.COPY_DECORATOR).toBe('cdec');
      expect(ID_PREFIXES.SAVED_SLICE_QUERY).toBe('ssq');
      expect(ID_PREFIXES.SAVED_FUNNEL_QUERY).toBe('sfq');
      expect(ID_PREFIXES.TESTER).toBe('tstr');
      expect(ID_PREFIXES.SCENARIO).toBe('scen');
      expect(ID_PREFIXES.SCENARIO_RUN).toBe('srun');
      expect(ID_PREFIXES.SCENARIO_CONVERSATION).toBe('scnv');
    });

    it('all prefixes are non-empty strings', () => {
      for (const [, prefix] of Object.entries(ID_PREFIXES)) {
        expect(typeof prefix).toBe('string');
        expect(prefix.length).toBeGreaterThan(0);
      }
    });

    it('all prefixes are unique', () => {
      const values = Object.values(ID_PREFIXES);
      expect(new Set(values).size).toBe(values.length);
    });
  });

  describe('generateId', () => {
    it('generates ID with correct prefix format', () => {
      const id = generateId(ID_PREFIXES.PROJECT);
      expect(id).toMatch(/^proj_/);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId(ID_PREFIXES.USER));
      }
      expect(ids.size).toBe(100);
    });

    it('generates time-sortable IDs (UUIDv7 property)', () => {
      const ids: string[] = [];
      for (let i = 0; i < 10; i++) {
        ids.push(generateId(ID_PREFIXES.AGENT));
      }
      ids.sort();
      expect(ids[0] <= ids[ids.length - 1]).toBe(true);
    });

    it('accepts arbitrary string prefix', () => {
      const id = generateId('custom');
      expect(id).toMatch(/^custom_/);
    });

    it('ID format is prefix_uuidv7 (underscore separator)', () => {
      const id = generateId(ID_PREFIXES.TOOL);
      const parts = id.split('_');
      expect(parts.length).toBeGreaterThan(1);
      expect(parts[0]).toBe('tool');
      const uuidPart = parts.slice(1).join('_');
      expect(uuidPart).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('IDs from different prefixes are distinguishable', () => {
      const projectId = generateId(ID_PREFIXES.PROJECT);
      const agentId = generateId(ID_PREFIXES.AGENT);
      expect(projectId.startsWith('proj_')).toBe(true);
      expect(agentId.startsWith('agnt_')).toBe(true);
      expect(projectId).not.toEqual(agentId);
    });
  });
});
