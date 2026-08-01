import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';
import { createProjectWithAgent } from '../fixtures';

interface Fixture { projectId: string; agentId: string; }

function minimalCategory() {
  return {
    name: 'Test Category',
    promptTrigger: 'help with this',
  };
}

function minimalItem(categoryId: string) {
  return {
    categoryId,
    questions: ['What is this?'],
    answer: 'This is a test answer.',
  };
}

describe('Knowledge API', () => {
  let fix: Fixture;
  let categoryId: string;

  beforeEach(async () => {
    await resetDatabase();
    fix = await createProjectWithAgent();
    const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/categories`).send(minimalCategory());
    categoryId = cr.body.id;
  });

  // ── Categories ─────────────────────────────────────────────────────
  describe('categories', () => {
    describe('list', () => {
      it('returns categories after creation', async () => {
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/categories`);
        expect(res.status).to.equal(200);
        expect(res.body.items).to.have.length.greaterThanOrEqual(1);
      });
    });

    describe('create', () => {
      it('creates with minimal fields', async () => {
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/categories`).send({
          ...minimalCategory(),
          name: 'New Category',
        });
        expect(res.status).to.equal(201);
        expect(res.body.id).to.be.a('string');
        expect(res.body.version).to.equal(1);
      });

      it('creates with tags and order', async () => {
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/categories`).send({
          ...minimalCategory(),
          name: 'Ordered',
          tags: ['faq'],
          order: 5,
        });
        expect(res.status).to.equal(201);
        expect(res.body.tags).to.deep.equal(['faq']);
        expect(res.body.order).to.equal(5);
      });

      it('rejects missing name (400)', async () => {
        const p = minimalCategory();
        delete p.name;
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/categories`).send(p);
        expect(res.status).to.equal(400);
      });

      it('rejects missing promptTrigger (400)', async () => {
        const p = minimalCategory();
        delete p.promptTrigger;
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/categories`).send(p);
        expect(res.status).to.equal(400);
      });
    });

    describe('get by id', () => {
      it('returns category by ID', async () => {
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`);
        expect(res.status).to.equal(200);
        expect(res.body.id).to.equal(categoryId);
      });

      it('returns 404 for non-existent', async () => {
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/categories/nonexistent`);
        expect(res.status).to.equal(404);
      });
    });

    describe('update', () => {
      it('updates name', async () => {
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`).send({ name: 'Updated', version: 1 });
        expect(res.status).to.equal(200);
        expect(res.body.name).to.equal('Updated');
        expect(res.body.version).to.equal(2);
      });

      it('rejects stale version (409)', async () => {
        await authed().put(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`).send({ name: 'First', version: 1 });
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`).send({ name: 'Second', version: 1 });
        expect(res.status).to.be.oneOf([400, 409]);
      });

      it('rejects missing version (400)', async () => {
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`).send({ name: 'Updated' });
        expect(res.status).to.equal(400);
      });

      it('returns 404 for non-existent', async () => {
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/categories/nonexistent`).send({ name: 'X', version: 1 });
        expect(res.status).to.equal(404);
      });
    });

    describe('delete', () => {
      it('deletes a category', async () => {
        const res = await authed().delete(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`).send({ version: 1 });
        expect(res.status).to.be.oneOf([200, 204]);
        const getRes = await authed().get(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}`);
        expect(getRes.status).to.equal(404);
      });

      it('returns 404 for non-existent', async () => {
        const res = await authed().delete(`/api/projects/${fix.projectId}/knowledge/categories/nonexistent`).send({ version: 1 });
        expect(res.status).to.equal(404);
      });
    });

    describe('audit logs', () => {
      it('returns audit logs after creation', async () => {
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/categories/${categoryId}/audit-logs`);
        expect(res.status).to.equal(200);
        expect(res.body).to.be.an('array');
        expect(res.body.length).to.be.greaterThanOrEqual(1);
      });
    });
  });

  // ── Items ──────────────────────────────────────────────────────────
  describe('items', () => {
    describe('list', () => {
      it('returns empty list when no items exist', async () => {
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/items`);
        expect(res.status).to.equal(200);
        expect(res.body.items).to.be.an('array').that.is.empty;
      });

      it('returns items after creation', async () => {
        await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/items`);
        expect(res.body.items).to.have.length(1);
      });
    });

    describe('create', () => {
      it('creates with minimal fields', async () => {
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        expect(res.status).to.equal(201);
        expect(res.body.id).to.be.a('string');
        expect(res.body.version).to.equal(1);
      });

      it('creates with multiple questions', async () => {
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send({
          categoryId,
          questions: ['What is this?', 'How does it work?'],
          answer: 'Detailed answer.',
          order: 1,
        });
        expect(res.status).to.equal(201);
        expect(res.body.questions).to.have.length(2);
      });

      it('rejects missing categoryId (400)', async () => {
        const p = minimalItem(categoryId);
        delete p.categoryId;
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(p);
        expect(res.status).to.equal(400);
      });

      it('rejects empty questions (400)', async () => {
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send({
          categoryId,
          questions: [],
          answer: 'test',
        });
        expect(res.status).to.equal(400);
      });

      it('rejects missing answer (400)', async () => {
        const p = minimalItem(categoryId);
        delete p.answer;
        const res = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(p);
        expect(res.status).to.equal(400);
      });
    });

    describe('get by id', () => {
      it('returns item by ID', async () => {
        const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`);
        expect(res.status).to.equal(200);
        expect(res.body.id).to.equal(cr.body.id);
      });

      it('returns 404 for non-existent', async () => {
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/items/nonexistent`);
        expect(res.status).to.equal(404);
      });
    });

    describe('update', () => {
      it('updates answer', async () => {
        const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`).send({ answer: 'New answer', version: 1 });
        expect(res.status).to.equal(200);
        expect(res.body.answer).to.equal('New answer');
        expect(res.body.version).to.equal(2);
      });

      it('rejects stale version (409)', async () => {
        const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        await authed().put(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`).send({ answer: 'First', version: 1 });
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`).send({ answer: 'Second', version: 1 });
        expect(res.status).to.be.oneOf([400, 409]);
      });

      it('rejects missing version (400)', async () => {
        const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`).send({ answer: 'Updated' });
        expect(res.status).to.equal(400);
      });

      it('returns 404 for non-existent', async () => {
        const res = await authed().put(`/api/projects/${fix.projectId}/knowledge/items/nonexistent`).send({ answer: 'X', version: 1 });
        expect(res.status).to.equal(404);
      });
    });

    describe('delete', () => {
      it('deletes an item', async () => {
        const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        const res = await authed().delete(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`).send({ version: 1 });
        expect(res.status).to.be.oneOf([200, 204]);
        const getRes = await authed().get(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}`);
        expect(getRes.status).to.equal(404);
      });

      it('returns 404 for non-existent', async () => {
        const res = await authed().delete(`/api/projects/${fix.projectId}/knowledge/items/nonexistent`).send({ version: 1 });
        expect(res.status).to.equal(404);
      });
    });

    describe('audit logs', () => {
      it('returns audit logs after creation', async () => {
        const cr = await authed().post(`/api/projects/${fix.projectId}/knowledge/items`).send(minimalItem(categoryId));
        const res = await authed().get(`/api/projects/${fix.projectId}/knowledge/items/${cr.body.id}/audit-logs`);
        expect(res.status).to.equal(200);
        expect(res.body).to.be.an('array');
        expect(res.body.length).to.be.greaterThanOrEqual(1);
      });
    });
  });
});
