import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalSmartFunctionTool() {
  return {
    type: 'smart_function' as const,
    name: 'Test Tool',
    prompt: 'Process the input: {{input}}',
    llmProviderId: 'openai',
    llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
    inputType: 'text' as const,
    outputType: 'text' as const,
  };
}

function minimalWebhookTool() {
  return {
    type: 'webhook' as const,
    name: 'Test Webhook',
    url: 'https://api.example.com/webhook',
  };
}

function minimalScriptTool() {
  return {
    type: 'script' as const,
    name: 'Test Script',
    code: 'return { result: "ok" };',
  };
}

describe('Tool API', () => {
  let fix: Fixture;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/tools`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns tools after creation', async () => {
      await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalWebhookTool());
      const res = await authed().get(`/api/projects/${fix.projectId}/tools`);
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create smart_function', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      expect(res.status).to.equal(201);
      expect(res.body.type).to.equal('smart_function');
      expect(res.body.version).to.equal(1);
    });

    it('creates with parameters', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send({
        ...minimalSmartFunctionTool(),
        parameters: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'limit', type: 'number', description: 'Max results', required: false },
        ],
      });
      expect(res.status).to.equal(201);
      expect(res.body.parameters).to.have.length(2);
    });

    it('rejects missing prompt (400)', async () => {
      const p = minimalSmartFunctionTool();
      delete p.prompt;
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('create webhook', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalWebhookTool());
      expect(res.status).to.equal(201);
      expect(res.body.type).to.equal('webhook');
      expect(res.body.url).to.equal('https://api.example.com/webhook');
    });

    it('creates with POST method and body', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send({
        ...minimalWebhookTool(),
        webhookMethod: 'POST',
        webhookHeaders: { 'Content-Type': 'application/json' },
        webhookBody: '{"query": "{{vars.query}}"}',
      });
      expect(res.status).to.equal(201);
      expect(res.body.webhookMethod).to.equal('POST');
      expect(res.body.webhookBody).to.equal('{"query": "{{vars.query}}"}');
    });

    it('rejects invalid URL (400)', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send({
        ...minimalWebhookTool(),
        url: 'not-a-url',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('create script', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalScriptTool());
      expect(res.status).to.equal(201);
      expect(res.body.type).to.equal('script');
      expect(res.body.code).to.equal('return { result: "ok" };');
    });

    it('rejects missing code (400)', async () => {
      const p = minimalScriptTool();
      delete p.code;
      const res = await authed().post(`/api/projects/${fix.projectId}/tools`).send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns tool by ID', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      const res = await authed().get(`/api/projects/${fix.projectId}/tools/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get(`/api/projects/${fix.projectId}/tools/nonexistent`);
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates smart_function name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      const res = await authed().put(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({
        type: 'smart_function',
        name: 'Updated',
        llmProviderId: 'openai',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
        inputType: 'text',
        outputType: 'text',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('updates webhook URL', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalWebhookTool());
      const res = await authed().put(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({
        type: 'webhook',
        name: 'Updated',
        url: 'https://api.example.com/new-url',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.url).to.equal('https://api.example.com/new-url');
    });

    it('updates script code', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalScriptTool());
      const res = await authed().put(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({
        type: 'script',
        name: 'Updated',
        code: 'return { result: "updated" };',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.code).to.equal('return { result: "updated" };');
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      await authed().put(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({
        type: 'smart_function', name: 'First', llmProviderId: 'openai',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
        inputType: 'text', outputType: 'text', version: cr.body.version,
      });
      const res = await authed().put(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({
        type: 'smart_function', name: 'Second', llmProviderId: 'openai',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
        inputType: 'text', outputType: 'text', version: cr.body.version,
      });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      const res = await authed().put(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({ type: 'smart_function', name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put(`/api/projects/${fix.projectId}/tools/nonexistent`).send({
        type: 'smart_function', name: 'X', llmProviderId: 'openai',
        llmSettings: { provider: 'openai', model: 'gpt-4', temperature: 0.5 },
        inputType: 'text', outputType: 'text', version: 1,
      });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a tool', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      const res = await authed().delete(`/api/projects/${fix.projectId}/tools/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/projects/${fix.projectId}/tools/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete(`/api/projects/${fix.projectId}/tools/nonexistent`).send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('clone', () => {
    it('clones smart_function with auto-generated name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalSmartFunctionTool(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/tools/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.id).to.not.equal(cr.body.id);
      expect(res.body.name).to.equal('Original (Clone)');
      expect(res.body.type).to.equal('smart_function');
    });

    it('clones webhook with custom name', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalWebhookTool(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/tools/${cr.body.id}/clone`).send({ name: 'Custom' });
      expect(res.status).to.equal(201);
      expect(res.body.name).to.equal('Custom');
      expect(res.body.url).to.equal('https://api.example.com/webhook');
    });

    it('clones script tool', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalScriptTool(), name: 'Original' });
      const res = await authed().post(`/api/projects/${fix.projectId}/tools/${cr.body.id}/clone`).send({});
      expect(res.status).to.equal(201);
      expect(res.body.type).to.equal('script');
      expect(res.body.code).to.equal('return { result: "ok" };');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().post(`/api/projects/${fix.projectId}/tools/nonexistent/clone`).send({});
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post(`/api/projects/${fix.projectId}/tools`).send(minimalSmartFunctionTool());
      const res = await authed().get(`/api/projects/${fix.projectId}/tools/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination and filtering', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalSmartFunctionTool(), name: `T${i}` });
      }
      const res = await authed().get(`/api/projects/${fix.projectId}/tools?offset=1&limit=1`);
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });

    it('filters by tags', async () => {
      await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalSmartFunctionTool(), name: 'Tagged', tags: ['ml'] });
      await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalSmartFunctionTool(), name: 'Untagged' });
      const res = await authed().get(`/api/projects/${fix.projectId}/tools?filters[tags]=ml`);
      expect(res.body.items).to.have.length(1);
    });

    it('searches by name', async () => {
      await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalSmartFunctionTool(), name: 'Alpha' });
      await authed().post(`/api/projects/${fix.projectId}/tools`).send({ ...minimalSmartFunctionTool(), name: 'Beta' });
      const res = await authed().get(`/api/projects/${fix.projectId}/tools?textSearch=alpha`);
      expect(res.body.items).to.have.length(1);
    });
  });
});
