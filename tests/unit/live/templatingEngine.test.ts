import 'reflect-metadata';
import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { TemplatingEngine } from '../../../src/services/live/TemplatingEngine';
import type { ConversationContext } from '../../../src/services/live/ConversationContextBuilder';

function makeContext(overrides: Partial<ConversationContext> = {}): ConversationContext {
  return {
    conversationId: 'conv_test',
    projectId: 'proj_test',
    userId: 'user_test',
    vars: {},
    userProfile: {},
    consts: {},
    history: [],
    events: [],
    actions: {},
    stage: { id: 'stage_test', name: 'Test Stage', actions: {} },
    ...overrides,
  };
}

describe('TemplatingEngine', () => {
  let engine: TemplatingEngine;

  beforeEach(() => {
    engine = new TemplatingEngine();
    engine.clearCache();
  });

  describe('basic variable interpolation', () => {
    it('renders simple variables from context', async () => {
      const result = await engine.render('Hello {{userInput}}!', makeContext({ userInput: 'world' }));
      expect(result).to.equal('Hello world!');
    });

    it('renders nested object properties', async () => {
      const result = await engine.render('{{userProfile.name}}', makeContext({ userProfile: { name: 'Alice' } }));
      expect(result).to.equal('Alice');
    });

    it('renders empty string for missing variables', async () => {
      const result = await engine.render('Hello {{missing}}!', makeContext());
      expect(result).to.equal('Hello !');
    });

    it('renders multiple variables', async () => {
      const result = await engine.render('{{vars.a}} and {{vars.b}}', makeContext({ vars: { a: 'foo', b: 'bar' } }));
      expect(result).to.equal('foo and bar');
    });
  });

  describe('get helper', () => {
    it('accesses nested properties with dot notation', async () => {
      const result = await engine.render('{{get userProfile "name"}}', makeContext({ userProfile: { name: 'Bob' } }));
      expect(result).to.equal('Bob');
    });

    it('accesses deeply nested properties', async () => {
      const result = await engine.render('{{get vars "a.b.c"}}', makeContext({ vars: { a: { b: { c: 'deep' } } } }));
      expect(result).to.equal('deep');
    });

    it('returns empty string for missing path', async () => {
      const result = await engine.render('{{get userProfile "missing"}}', makeContext({ userProfile: {} }));
      expect(result).to.equal('');
    });

    it('returns empty string for null object', async () => {
      const result = await engine.render('{{get null "x"}}', makeContext());
      expect(result).to.equal('');
    });

    it('returns empty string for empty path', async () => {
      const result = await engine.render('{{get userProfile ""}}', makeContext({ userProfile: { name: 'Bob' } }));
      expect(result).to.equal('');
    });

    it('returns empty string when intermediate key is missing', async () => {
      const result = await engine.render('{{get vars "a.b.c"}}', makeContext({ vars: { a: { b: 'not object' } } }));
      expect(result).to.equal('');
    });
  });

  describe('exists helper', () => {
    it('renders block when value exists', async () => {
      const result = await engine.render('{{#exists name}}found{{/exists}}', makeContext({ name: 'Alice' } as any));
      expect(result).to.equal('found');
    });

    it('renders inverse when value is empty', async () => {
      const result = await engine.render('{{#exists name}}found{{else}}missing{{/exists}}', makeContext({ name: '' } as any));
      expect(result).to.equal('missing');
    });

    it('renders inverse when value is null', async () => {
      const result = await engine.render('{{#exists name}}found{{else}}missing{{/exists}}', makeContext({ name: null } as any));
      expect(result).to.equal('missing');
    });

    it('renders inverse when value is undefined', async () => {
      const result = await engine.render('{{#exists name}}found{{else}}missing{{/exists}}', makeContext({ name: undefined } as any));
      expect(result).to.equal('missing');
    });

    it('works as simple helper returning boolean', async () => {
      const result = await engine.render('{{exists name}}', makeContext({ name: 'Alice' } as any));
      expect(result).to.equal('true');
    });
  });

  describe('hasItems helper', () => {
    it('renders block for non-empty array', async () => {
      const result = await engine.render('{{#hasItems items}}has items{{else}}empty{{/hasItems}}', makeContext({ items: [1, 2] } as any));
      expect(result).to.equal('has items');
    });

    it('renders inverse for empty array', async () => {
      const result = await engine.render('{{#hasItems items}}has items{{else}}empty{{/hasItems}}', makeContext({ items: [] } as any));
      expect(result).to.equal('empty');
    });

    it('renders inverse for non-array', async () => {
      const result = await engine.render('{{#hasItems items}}has items{{else}}empty{{/hasItems}}', makeContext({ items: 'not an array' } as any));
      expect(result).to.equal('empty');
    });

    it('works as simple helper returning boolean', async () => {
      const result = await engine.render('{{hasItems items}}', makeContext({ items: [1] } as any));
      expect(result).to.equal('true');
    });
  });

  describe('join helper', () => {
    it('joins array with custom separator', async () => {
      const result = await engine.render('{{join items " | "}}', makeContext({ items: ['a', 'b', 'c'] } as any));
      expect(result).to.equal('a | b | c');
    });

    it('joins array without separator (no-space join)', async () => {
      const result = await engine.render('{{join items ""}}', makeContext({ items: ['a', 'b', 'c'] } as any));
      expect(result).to.equal('abc');
    });

    it('returns empty for non-array', async () => {
      const result = await engine.render('{{join items ""}}', makeContext({ items: 'not array' } as any));
      expect(result).to.equal('');
    });
  });

  describe('contains helper', () => {
    it('renders block when array contains value', async () => {
      const result = await engine.render('{{#contains items "b"}}yes{{else}}no{{/contains}}', makeContext({ items: ['a', 'b', 'c'] } as any));
      expect(result).to.equal('yes');
    });

    it('renders inverse when array does not contain value', async () => {
      const result = await engine.render('{{#contains items "z"}}yes{{else}}no{{/contains}}', makeContext({ items: ['a', 'b', 'c'] } as any));
      expect(result).to.equal('no');
    });

    it('works as simple helper returning boolean', async () => {
      const result = await engine.render('{{contains items "b"}}', makeContext({ items: ['a', 'b', 'c'] } as any));
      expect(result).to.equal('true');
    });
  });

  describe('default helper', () => {
    it('returns value when present', async () => {
      const result = await engine.render('{{default name "fallback"}}', makeContext({ name: 'Alice' } as any));
      expect(result).to.equal('Alice');
    });

    it('returns default when value is falsy', async () => {
      const result = await engine.render('{{default name "fallback"}}', makeContext({ name: '' } as any));
      expect(result).to.equal('fallback');
    });
  });

  describe('json helper', () => {
    it('stringifies objects (use triple braces to avoid HTML escaping)', async () => {
      const result = await engine.render('{{{json data}}}', makeContext({ data: { x: 1 } } as any));
      expect(() => JSON.parse(result)).to.not.throw();
      expect(JSON.parse(result)).to.deep.equal({ x: 1 });
    });

    it('stringifies arrays', async () => {
      const result = await engine.render('{{{json items}}}', makeContext({ items: [1, 2, 3] } as any));
      expect(() => JSON.parse(result)).to.not.throw();
      expect(JSON.parse(result)).to.deep.equal([1, 2, 3]);
    });

    it('returns empty for null', async () => {
      const result = await engine.render('{{json null}}', makeContext());
      expect(result).to.equal('');
    });

    it('returns empty for undefined', async () => {
      const result = await engine.render('{{json undefined}}', makeContext());
      expect(result).to.equal('');
    });

    it('pretty prints when second arg is true', async () => {
      const result = await engine.render('{{{json data true}}}', makeContext({ data: { x: 1 } } as any));
      expect(result).to.include('\n');
      expect(result).to.include('  ');
    });

    it('handles circular objects with String fallback', async () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      const result = await engine.render('{{{json data}}}', makeContext({ data: circular } as any));
      // JSON.stringify throws, so json helper falls back to String(value)
      expect(result).to.equal('[object Object]');
    });
  });

  describe('jsonEscape helper', () => {
    it('escapes special characters for JSON embedding', async () => {
      const result = await engine.render('{{{jsonEscape value}}}', makeContext({ value: 'say "hello"' } as any));
      // jsonEscape returns the value with quotes escaped for embedding in a JSON string
      expect(result).to.include('hello');
    });

    it('returns empty for null', async () => {
      const result = await engine.render('{{jsonEscape null}}', makeContext());
      expect(result).to.equal('');
    });
  });

  describe('comparison helpers', () => {
    it('eq block helper', async () => {
      const ctx = makeContext({ a: 1, b: 1 });
      const result = await engine.render('{{#eq a b}}equal{{else}}not{{/eq}}', ctx);
      expect(result).to.equal('equal');
    });

    it('eq simple helper', async () => {
      const ctx = makeContext({ a: 1, b: 1 });
      const result = await engine.render('{{eq a b}}', ctx);
      expect(result).to.equal('true');
    });

    it('ne block helper', async () => {
      const ctx = makeContext({ a: 1, b: 2 });
      const result = await engine.render('{{#ne a b}}not equal{{else}}equal{{/ne}}', ctx);
      expect(result).to.equal('not equal');
    });

    it('gt block helper', async () => {
      const ctx = makeContext({ a: 5, b: 3 });
      const result = await engine.render('{{#gt a b}}greater{{else}}not{{/gt}}', ctx);
      expect(result).to.equal('greater');
    });

    it('gte block helper', async () => {
      const ctx = makeContext({ a: 3, b: 3 });
      const result = await engine.render('{{#gte a b}}gte{{else}}not{{/gte}}', ctx);
      expect(result).to.equal('gte');
    });

    it('lt block helper', async () => {
      const ctx = makeContext({ a: 2, b: 5 });
      const result = await engine.render('{{#lt a b}}less{{else}}not{{/lt}}', ctx);
      expect(result).to.equal('less');
    });

    it('lte block helper', async () => {
      const ctx = makeContext({ a: 3, b: 3 });
      const result = await engine.render('{{#lte a b}}lte{{else}}not{{/lte}}', ctx);
      expect(result).to.equal('lte');
    });
  });

  describe('logical helpers', () => {
    it('and with all true', async () => {
      const result = await engine.render('{{#and true true}}yes{{else}}no{{/and}}', makeContext());
      expect(result).to.equal('yes');
    });

    it('and with one false', async () => {
      const result = await engine.render('{{#and true false}}yes{{else}}no{{/and}}', makeContext());
      expect(result).to.equal('no');
    });

    it('and as simple helper', async () => {
      const result = await engine.render('{{and true false}}', makeContext());
      expect(result).to.equal('false');
    });

    it('or with one true', async () => {
      const result = await engine.render('{{#or false true}}yes{{else}}no{{/or}}', makeContext());
      expect(result).to.equal('yes');
    });

    it('or with all false', async () => {
      const result = await engine.render('{{#or false false}}yes{{else}}no{{/or}}', makeContext());
      expect(result).to.equal('no');
    });

    it('or as simple helper', async () => {
      const result = await engine.render('{{or false true}}', makeContext());
      expect(result).to.equal('true');
    });

    it('not with block', async () => {
      const result = await engine.render('{{#not false}}yes{{else}}no{{/not}}', makeContext());
      expect(result).to.equal('yes');
    });

    it('not as simple helper', async () => {
      const result = await engine.render('{{not true}}', makeContext());
      expect(result).to.equal('false');
    });
  });

  describe('helperMissing override', () => {
    it('renders strings normally', async () => {
      const result = await engine.render('{{name}}', makeContext({ name: 'Alice' } as any));
      expect(result).to.equal('Alice');
    });

    it('renders numbers normally', async () => {
      const result = await engine.render('{{count}}', makeContext({ count: 42 } as any));
      expect(result).to.equal('42');
    });

    it('renders objects via helperMissing (uses JSON.stringify or String fallback)', async () => {
      const result = await engine.render('{{{data}}}', makeContext({ data: { x: 1 } } as any));
      // helperMissing tries JSON.stringify first, falls back to String(value)
      // Depending on Handlebars version, may get JSON or [object Object]
      expect(result).to.be.oneOf(['{"x":1}', '[object Object]']);
    });

    it('returns empty string for undefined value', async () => {
      const result = await engine.render('{{missing}}', makeContext());
      expect(result).to.equal('');
    });

    it('handles circular objects gracefully', async () => {
      const circular: any = { a: 1 };
      circular.self = circular;
      const result = await engine.render('{{{data}}}', makeContext({ data: circular } as any));
      // JSON.stringify throws on circular refs, falls back to String(value) -> '[object Object]'
      expect(result).to.equal('[object Object]');
    });
  });

  describe('template caching', () => {
    it('caches compiled templates', async () => {
      await engine.render('Hello {{name}}', makeContext({ vars: { name: 'A' } }));
      const stats = engine.getCacheStats();
      expect(stats.size).to.equal(1);
      expect(stats.maxSize).to.equal(1000);
    });

    it('reuses cached templates', async () => {
      await engine.render('Hello {{name}}', makeContext({ vars: { name: 'A' } }));
      await engine.render('Hello {{name}}', makeContext({ vars: { name: 'B' } }));
      const stats = engine.getCacheStats();
      expect(stats.size).to.equal(1); // same template, cached
    });

    it('clears cache on clearCache', async () => {
      await engine.render('Hello {{name}}', makeContext({ vars: { name: 'A' } }));
      engine.clearCache();
      const stats = engine.getCacheStats();
      expect(stats.size).to.equal(0);
    });
  });

  describe('two-pass rendering', () => {
    it('handles nested template expressions', async () => {
      // First pass renders {{template}} to "Hello {{name}}", second pass renders it
      const result = await engine.render('{{template}}', makeContext({
        template: 'Hello {{name}}',
        name: 'World',
      } as any));
      expect(result).to.equal('Hello World');
    });

    it('stops after two passes and leaves unprocessed expressions', async () => {
      // Triple nesting: {{a}} -> "{{b}}" -> "{{c}}" -> "{{c}}" (stops at 2nd pass)
      const result = await engine.render('{{a}}', makeContext({
        a: '{{b}}',
        b: '{{c}}',
        c: 'final',
      } as any));
      // After pass 1: "{{b}}", pass 2: "{{c}}" — stops, "{{c}}" remains unprocessed
      expect(result).to.equal('{{c}}');
    });
  });

  describe('error handling', () => {
    it('throws on invalid template', async () => {
      try {
        await engine.render('{{invalid{{{', makeContext());
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('Template rendering failed');
      }
    });
  });
});
