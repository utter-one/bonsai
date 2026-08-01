import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

describe('Benchmark Suite API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/benchmarks/suites');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.total).to.equal(0);
    });

    it('returns suites after creation', async () => {
      await authed().post('/api/benchmarks/suites').send({ name: 'Suite A' });
      await authed().post('/api/benchmarks/suites').send({ name: 'Suite B' });
      const res = await authed().get('/api/benchmarks/suites');
      expect(res.body.items).to.have.length(2);
      expect(res.body.total).to.equal(2);
    });

    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post('/api/benchmarks/suites').send({ name: `Suite ${i}` });
      }
      const res = await authed().get('/api/benchmarks/suites?offset=1&limit=1');
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post('/api/benchmarks/suites').send({ name: 'Test Suite' });
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.name).to.equal('Test Suite');
      expect(res.body.version).to.equal(1);
      expect(res.body.isActive).to.equal(true);
      expect(res.body.tags).to.deep.equal([]);
    });

    it('creates with full config', async () => {
      const res = await authed().post('/api/benchmarks/suites').send({
        name: 'Full Suite',
        description: 'A full test suite',
        cronExpression: '0 * * * *',
        isActive: false,
        tags: ['nightly', 'regression'],
      });
      expect(res.status).to.equal(201);
      expect(res.body.description).to.equal('A full test suite');
      expect(res.body.cronExpression).to.equal('0 * * * *');
      expect(res.body.isActive).to.equal(false);
      expect(res.body.tags).to.deep.equal(['nightly', 'regression']);
    });

    it('rejects missing name (400)', async () => {
      const res = await authed().post('/api/benchmarks/suites').send({});
      expect(res.status).to.equal(400);
    });

    it('rejects empty name (400)', async () => {
      const res = await authed().post('/api/benchmarks/suites').send({ name: '' });
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns suite by ID', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Get Me' });
      const res = await authed().get(`/api/benchmarks/suites/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
      expect(res.body.name).to.equal('Get Me');
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/benchmarks/suites/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Original' });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({
        name: 'Updated',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('updates description to null', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Test', description: 'Initial' });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({
        description: null,
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.description).to.be.null;
    });

    it('updates cronExpression to null', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Test', cronExpression: '0 * * * *' });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({
        cronExpression: null,
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.cronExpression).to.be.null;
    });

    it('updates tags', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Test', tags: ['a'] });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({
        tags: ['b', 'c'],
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.tags).to.deep.equal(['b', 'c']);
    });

    it('updates isActive', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Test', isActive: true });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({
        isActive: false,
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.isActive).to.equal(false);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Original' });
      await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Test' });
      const res = await authed().put(`/api/benchmarks/suites/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/benchmarks/suites/nonexistent').send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes a suite', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Delete Me' });
      const res = await authed().delete(`/api/benchmarks/suites/${cr.body.id}`);
      expect(res.status).to.equal(204);
      const getRes = await authed().get(`/api/benchmarks/suites/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/benchmarks/suites/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('suite configs listing', () => {
    it('returns empty configs for suite', async () => {
      const cr = await authed().post('/api/benchmarks/suites').send({ name: 'Config Suite' });
      const res = await authed().get(`/api/benchmarks/suites/${cr.body.id}/configs`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns empty configs for non-existent suite', async () => {
      const res = await authed().get('/api/benchmarks/suites/nonexistent/configs');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
    });
  });
});
