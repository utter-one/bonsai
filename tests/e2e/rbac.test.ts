import { describe, it, before, beforeEach } from 'mocha';
import { expect } from 'chai';
import request from 'supertest';
import { authed, unauthed, resetDatabase } from '../utils';

/**
 * Create an operator with the given role(s) and return their JWT access token.
 * Uses the super_admin (test operator) to create the new operator, then logs in as them.
 */
async function createOperatorWithRole(roles: string[]): Promise<string> {
  const operatorId = `rbac-test-${roles.join('+')}@example.com`;
  const createRes = await authed()
    .post('/api/operators')
    .send({
      id: operatorId,
      name: `RBAC Test ${roles.join('+')}`,
      roles,
      password: 'rbacpassword123',
    });
  if (createRes.status !== 201 && createRes.status !== 409) {
    throw new Error(`Failed to create operator: ${createRes.status} ${JSON.stringify(createRes.body)}`);
  }

  const loginRes = await unauthed()
    .post('/api/auth/login')
    .send({
      id: operatorId,
      password: 'rbacpassword123',
    });
  expect(loginRes.status).to.equal(200);
  return loginRes.body.accessToken;
}

function tokenAgent(token: string) {
  const app = (globalThis as any).__TEST_APP__;
  const agent = request.agent(app);
  agent.set('Authorization', `Bearer ${token}`);
  return agent;
}

/** Create a project using super_admin and return its ID. */
async function createProjectAsAdmin(): Promise<string> {
  const res = await authed().post('/api/projects').send({ name: 'RBAC Test Project', acceptVoice: false });
  expect(res.status).to.equal(201);
  return res.body.id;
}

describe('RBAC Enforcement', () => {
  describe('content_manager role', () => {
    let agent: ReturnType<typeof request.agent>;
    let projectId: string;

    before(async () => {
      await resetDatabase();
      agent = tokenAgent(await createOperatorWithRole(['content_manager']));
    });

    beforeEach(async () => {
      await resetDatabase();
      projectId = await createProjectAsAdmin();
    });

    describe('can access (read + write)', () => {
      it('can list projects', async () => {
        expect((await agent.get('/api/projects')).status).to.equal(200);
      });

      it('can create a project', async () => {
        expect((await agent.post('/api/projects').send({ name: 'CM Project', acceptVoice: false })).status).to.equal(201);
      });

      it('can list agents', async () => {
        expect((await agent.get(`/api/projects/${projectId}/agents`)).status).to.equal(200);
      });

      it('can create an agent', async () => {
        expect((await agent.post(`/api/projects/${projectId}/agents`).send({
          name: 'CM Agent',
          prompt: 'Test prompt',
        })).status).to.equal(201);
      });

      it('can list stages', async () => {
        expect((await agent.get(`/api/projects/${projectId}/stages`)).status).to.equal(200);
      });

      it('can list classifiers', async () => {
        expect((await agent.get(`/api/projects/${projectId}/classifiers`)).status).to.equal(200);
      });

      it('can list tools', async () => {
        expect((await agent.get(`/api/projects/${projectId}/tools`)).status).to.equal(200);
      });

      it('can list guardrails', async () => {
        expect((await agent.get(`/api/projects/${projectId}/guardrails`)).status).to.equal(200);
      });

      it('can list knowledge categories', async () => {
        expect((await agent.get(`/api/projects/${projectId}/knowledge/categories`)).status).to.equal(200);
      });

      it('can list users', async () => {
        expect((await agent.get(`/api/projects/${projectId}/users`)).status).to.equal(200);
      });

      it('can create a user', async () => {
        expect((await agent.post(`/api/projects/${projectId}/users`).send({
          profile: { name: 'CM User' },
        })).status).to.equal(201);
      });

      it('can list providers', async () => {
        expect((await agent.get('/api/providers')).status).to.equal(200);
      });

      it('can list API keys', async () => {
        expect((await agent.get('/api/api-keys')).status).to.equal(200);
      });

      it('can list testers', async () => {
        expect((await agent.get(`/api/projects/${projectId}/testers`)).status).to.equal(200);
      });

      it('can list scenarios', async () => {
        expect((await agent.get(`/api/projects/${projectId}/scenarios`)).status).to.equal(200);
      });

      it('can list quick prompts', async () => {
        expect((await agent.get(`/api/projects/${projectId}/quick-prompts`)).status).to.equal(200);
      });

      it('can list audit logs', async () => {
        expect((await agent.get('/api/audit-logs')).status).to.equal(200);
      });

      it('can list secrets', async () => {
        expect((await agent.get('/api/secrets')).status).to.equal(200);
      });
    });

    describe('can delete project-scoped entities', () => {
      it('can delete an agent', async () => {
        const createRes = await agent.post(`/api/projects/${projectId}/agents`).send({
          name: 'CM Agent to Delete',
          prompt: 'Test prompt',
        });
        expect(createRes.status).to.equal(201);
        expect((await agent.delete(`/api/projects/${projectId}/agents/${createRes.body.id}`).send({ version: createRes.body.version })).status).to.equal(204);
      });

      it('can delete a user', async () => {
        const createRes = await agent.post(`/api/projects/${projectId}/users`).send({
          profile: { name: 'CM User to Delete' },
        });
        expect(createRes.status).to.equal(201);
        expect((await agent.delete(`/api/projects/${projectId}/users/${createRes.body.id}`)).status).to.equal(204);
      });

      it('can delete a scenario', async () => {
        const createRes = await agent.post(`/api/projects/${projectId}/scenarios`).send({
          name: 'CM Scenario to Delete',
          language: 'en',
          startingStageId: 'stage_123',
          maxTurns: 10,
        });
        expect(createRes.status).to.equal(201);
        expect((await agent.delete(`/api/projects/${projectId}/scenarios/${createRes.body.id}`).send({ version: createRes.body.version })).status).to.equal(204);
      });

      it('can delete a tester', async () => {
        const createRes = await agent.post(`/api/projects/${projectId}/testers`).send({
          name: 'CM Tester to Delete',
          prompt: 'Test tester prompt',
        });
        expect(createRes.status).to.equal(201);
        expect((await agent.delete(`/api/projects/${projectId}/testers/${createRes.body.id}`).send({ version: createRes.body.version })).status).to.equal(204);
      });

      it('can delete a quick prompt', async () => {
        const createRes = await agent.post(`/api/projects/${projectId}/quick-prompts`).send({
          categoryId: 'agent',
          name: 'CM Quick Prompt to Delete',
          content: 'Test content',
        });
        expect(createRes.status).to.equal(201);
        expect((await agent.delete(`/api/projects/${projectId}/quick-prompts/${createRes.body.id}`).send({ version: createRes.body.version })).status).to.equal(204);
      });
    });

    describe('cannot access (403)', () => {
      it('cannot delete a project', async () => {
        expect((await agent.delete(`/api/projects/${projectId}`)).status).to.equal(403);
      });

      it('cannot list operators', async () => {
        expect((await agent.get('/api/operators')).status).to.equal(403);
      });

      it('cannot create an operator', async () => {
        expect((await agent.post('/api/operators').send({
          id: 'new-op@example.com',
          name: 'New Op',
          roles: ['viewer'],
          password: 'password123',
        })).status).to.equal(403);
      });

      it('cannot export migration', async () => {
        expect((await agent.get('/api/migration/export')).status).to.equal(403);
      });

      it('cannot list environments', async () => {
        expect((await agent.get('/api/environments')).status).to.equal(403);
      });

      it('cannot list benchmark suites', async () => {
        expect((await agent.get('/api/benchmarks/suites')).status).to.equal(403);
      });

      it('cannot list issues', async () => {
        expect((await agent.get('/api/issues')).status).to.equal(403);
      });
    });
  });

  describe('support role', () => {
    let agent: ReturnType<typeof request.agent>;

    before(async () => {
      await resetDatabase();
      agent = tokenAgent(await createOperatorWithRole(['support']));
    });

    beforeEach(async () => {
      await resetDatabase();
    });

    describe('can access (narrow scope)', () => {
      it('can list projects', async () => {
        expect((await agent.get('/api/projects')).status).to.equal(200);
      });

      it('can list conversations', async () => {
        expect((await agent.get('/api/conversations/trigger')).status).to.be.oneOf([200, 404, 405]);
      });

      it('can list issues', async () => {
        expect((await agent.get('/api/issues')).status).to.equal(200);
      });

      it('can list audit logs', async () => {
        expect((await agent.get('/api/audit-logs')).status).to.equal(200);
      });
    });

    describe('cannot access (403)', () => {
      it('cannot list agents', async () => {
        expect((await agent.get('/api/projects/proj_any/agents')).status).to.equal(403);
      });

      it('cannot list stages', async () => {
        expect((await agent.get('/api/projects/proj_any/stages')).status).to.equal(403);
      });

      it('cannot list classifiers', async () => {
        expect((await agent.get('/api/projects/proj_any/classifiers')).status).to.equal(403);
      });

      it('cannot list tools', async () => {
        expect((await agent.get('/api/projects/proj_any/tools')).status).to.equal(403);
      });

      it('cannot list guardrails', async () => {
        expect((await agent.get('/api/projects/proj_any/guardrails')).status).to.equal(403);
      });

      it('cannot list knowledge', async () => {
        expect((await agent.get('/api/projects/proj_any/knowledge/categories')).status).to.equal(403);
      });

      it('cannot list providers', async () => {
        expect((await agent.get('/api/providers')).status).to.equal(403);
      });

      it('cannot list API keys', async () => {
        expect((await agent.get('/api/api-keys')).status).to.equal(403);
      });

      it('cannot list testers', async () => {
        expect((await agent.get('/api/projects/proj_any/testers')).status).to.equal(403);
      });

      it('cannot list scenarios', async () => {
        expect((await agent.get('/api/projects/proj_any/scenarios')).status).to.equal(403);
      });

      it('cannot list quick prompts', async () => {
        expect((await agent.get('/api/quick-prompts')).status).to.equal(403);
      });

      it('cannot list operators', async () => {
        expect((await agent.get('/api/operators')).status).to.equal(403);
      });

      it('cannot access secrets', async () => {
        expect((await agent.get('/api/secrets')).status).to.equal(403);
      });

      it('cannot list environments', async () => {
        expect((await agent.get('/api/environments')).status).to.equal(403);
      });
    });
  });

  describe('developer role', () => {
    let agent: ReturnType<typeof request.agent>;

    before(async () => {
      await resetDatabase();
      agent = tokenAgent(await createOperatorWithRole(['developer']));
    });

    beforeEach(async () => {
      await resetDatabase();
    });

    describe('can access (read-only + system)', () => {
      it('can list projects', async () => {
        expect((await agent.get('/api/projects')).status).to.equal(200);
      });

      it('can list agents', async () => {
        expect((await agent.get('/api/projects/proj_any/agents')).status).to.equal(200);
      });

      it('can list stages', async () => {
        expect((await agent.get('/api/projects/proj_any/stages')).status).to.equal(200);
      });

      it('can list classifiers', async () => {
        expect((await agent.get('/api/projects/proj_any/classifiers')).status).to.equal(200);
      });

      it('can list tools', async () => {
        expect((await agent.get('/api/projects/proj_any/tools')).status).to.equal(200);
      });

      it('can list guardrails', async () => {
        expect((await agent.get('/api/projects/proj_any/guardrails')).status).to.equal(200);
      });

      it('can list knowledge', async () => {
        expect((await agent.get('/api/projects/proj_any/knowledge/categories')).status).to.equal(200);
      });

      it('can list providers', async () => {
        expect((await agent.get('/api/providers')).status).to.equal(200);
      });

      it('can list API keys', async () => {
        expect((await agent.get('/api/api-keys')).status).to.equal(200);
      });

      it('can list testers', async () => {
        expect((await agent.get('/api/projects/proj_any/testers')).status).to.equal(200);
      });

      it('can list scenarios', async () => {
        expect((await agent.get('/api/projects/proj_any/scenarios')).status).to.equal(200);
      });

      it('can list quick prompts', async () => {
        expect((await agent.get('/api/quick-prompts')).status).to.equal(200);
      });

      it('can list issues', async () => {
        expect((await agent.get('/api/issues')).status).to.equal(200);
      });

      it('can list audit logs', async () => {
        expect((await agent.get('/api/audit-logs')).status).to.equal(200);
      });

      it('can access system version', async () => {
        expect((await agent.get('/version')).status).to.equal(200);
      });
    });

    describe('cannot access (403)', () => {
      it('cannot create a project', async () => {
        expect((await agent.post('/api/projects').send({ name: 'Dev Project', acceptVoice: false })).status).to.equal(403);
      });

      it('cannot create an agent', async () => {
        expect((await agent.post('/api/projects/proj_any/agents').send({
          name: 'Dev Agent',
          prompt: 'Test',
        })).status).to.equal(403);
      });

      it('cannot create a stage', async () => {
        expect((await agent.post('/api/projects/proj_any/stages').send({
          name: 'Dev Stage',
          type: 'agent',
          config: { agentId: 'agent_123' },
        })).status).to.equal(403);
      });

      it('cannot list operators', async () => {
        expect((await agent.get('/api/operators')).status).to.equal(403);
      });

      it('cannot list environments', async () => {
        expect((await agent.get('/api/environments')).status).to.equal(403);
      });

      it('cannot list secrets', async () => {
        expect((await agent.get('/api/secrets')).status).to.equal(403);
      });
    });
  });

  describe('viewer role', () => {
    let agent: ReturnType<typeof request.agent>;

    before(async () => {
      await resetDatabase();
      agent = tokenAgent(await createOperatorWithRole(['viewer']));
    });

    beforeEach(async () => {
      await resetDatabase();
    });

    describe('can access (read-only)', () => {
      it('can list projects', async () => {
        expect((await agent.get('/api/projects')).status).to.equal(200);
      });

      it('can list agents', async () => {
        expect((await agent.get('/api/projects/proj_any/agents')).status).to.equal(200);
      });

      it('can list stages', async () => {
        expect((await agent.get('/api/projects/proj_any/stages')).status).to.equal(200);
      });

      it('can list classifiers', async () => {
        expect((await agent.get('/api/projects/proj_any/classifiers')).status).to.equal(200);
      });

      it('can list tools', async () => {
        expect((await agent.get('/api/projects/proj_any/tools')).status).to.equal(200);
      });

      it('can list guardrails', async () => {
        expect((await agent.get('/api/projects/proj_any/guardrails')).status).to.equal(200);
      });

      it('can list knowledge', async () => {
        expect((await agent.get('/api/projects/proj_any/knowledge/categories')).status).to.equal(200);
      });

      it('can list providers', async () => {
        expect((await agent.get('/api/providers')).status).to.equal(200);
      });

      it('can list API keys', async () => {
        expect((await agent.get('/api/api-keys')).status).to.equal(200);
      });

      it('can list testers', async () => {
        expect((await agent.get('/api/projects/proj_any/testers')).status).to.equal(200);
      });

      it('can list scenarios', async () => {
        expect((await agent.get('/api/projects/proj_any/scenarios')).status).to.equal(200);
      });

      it('can list quick prompts', async () => {
        expect((await agent.get('/api/quick-prompts')).status).to.equal(200);
      });

      it('can list issues', async () => {
        expect((await agent.get('/api/issues')).status).to.equal(200);
      });

      it('can list audit logs', async () => {
        expect((await agent.get('/api/audit-logs')).status).to.equal(200);
      });
    });

    describe('cannot access (403)', () => {
      it('cannot create a project', async () => {
        expect((await agent.post('/api/projects').send({ name: 'Viewer Project', acceptVoice: false })).status).to.equal(403);
      });

      it('cannot create an agent', async () => {
        expect((await agent.post('/api/projects/proj_any/agents').send({
          name: 'Viewer Agent',
          prompt: 'Test',
        })).status).to.equal(403);
      });

      it('cannot create a stage', async () => {
        expect((await agent.post('/api/projects/proj_any/stages').send({
          name: 'Viewer Stage',
          type: 'agent',
          config: { agentId: 'agent_123' },
        })).status).to.equal(403);
      });

      it('cannot list operators', async () => {
        expect((await agent.get('/api/operators')).status).to.equal(403);
      });

      it('cannot list environments', async () => {
        expect((await agent.get('/api/environments')).status).to.equal(403);
      });

      it('cannot list secrets', async () => {
        expect((await agent.get('/api/secrets')).status).to.equal(403);
      });

      it('cannot export migration', async () => {
        expect((await agent.get('/api/migration/export')).status).to.equal(403);
      });
    });
  });

  describe('super_admin role (baseline)', () => {
    it('can list operators', async () => {
      expect((await authed().get('/api/operators')).status).to.equal(200);
    });

    it('can create an operator', async () => {
      expect((await authed().post('/api/operators').send({
        id: 'admin-sub-op@example.com',
        name: 'Sub Operator',
        roles: ['viewer'],
        password: 'password123',
      })).status).to.equal(201);
    });

    it('can list environments', async () => {
      expect((await authed().get('/api/environments')).status).to.equal(200);
    });

    it('can list secrets', async () => {
      expect((await authed().get('/api/secrets')).status).to.equal(200);
    });

    it('can export migration', async () => {
      expect((await authed().get('/api/migration/export')).status).to.be.oneOf([200, 400]);
    });
  });
});
