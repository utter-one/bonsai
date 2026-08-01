import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

function minimalEnvironment() {
  return {
    description: 'Test Environment',
    url: 'https://test.example.com',
    login: 'testuser',
    password: 'testpass123',
  };
}

describe('Environment API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/environments');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
    });

    it('returns environments after creation', async () => {
      await authed().post('/api/environments').send({ ...minimalEnvironment(), description: 'A' });
      await authed().post('/api/environments').send({ ...minimalEnvironment(), description: 'B' });
      const res = await authed().get('/api/environments');
      expect(res.body.items).to.have.length(2);
    });
  });

  describe('create', () => {
    it('creates with minimal fields', async () => {
      const res = await authed().post('/api/environments').send(minimalEnvironment());
      expect(res.status).to.equal(201);
      expect(res.body.id).to.be.a('string');
      expect(res.body.version).to.equal(1);
      // password should not be returned
      expect(res.body.password).to.be.undefined;
    });

    it('rejects missing description (400)', async () => {
      const p = minimalEnvironment();
      delete p.description;
      const res = await authed().post('/api/environments').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing url (400)', async () => {
      const p = minimalEnvironment();
      delete p.url;
      const res = await authed().post('/api/environments').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects invalid url (400)', async () => {
      const res = await authed().post('/api/environments').send({
        ...minimalEnvironment(),
        url: 'not-a-url',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing login (400)', async () => {
      const p = minimalEnvironment();
      delete p.login;
      const res = await authed().post('/api/environments').send(p);
      expect(res.status).to.equal(400);
    });

    it('rejects missing password (400)', async () => {
      const p = minimalEnvironment();
      delete p.password;
      const res = await authed().post('/api/environments').send(p);
      expect(res.status).to.equal(400);
    });
  });

  describe('get by id', () => {
    it('returns environment by ID', async () => {
      const cr = await authed().post('/api/environments').send(minimalEnvironment());
      const res = await authed().get(`/api/environments/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/environments/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates description', async () => {
      const cr = await authed().post('/api/environments').send(minimalEnvironment());
      const res = await authed().put(`/api/environments/${cr.body.id}`).send({
        description: 'Updated Env',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.description).to.equal('Updated Env');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post('/api/environments').send(minimalEnvironment());
      await authed().put(`/api/environments/${cr.body.id}`).send({ description: 'First', version: cr.body.version });
      const res = await authed().put(`/api/environments/${cr.body.id}`).send({ description: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post('/api/environments').send(minimalEnvironment());
      const res = await authed().put(`/api/environments/${cr.body.id}`).send({ description: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/environments/nonexistent').send({ description: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes an environment', async () => {
      const cr = await authed().post('/api/environments').send(minimalEnvironment());
      const res = await authed().delete(`/api/environments/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/environments/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/environments/nonexistent').send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post('/api/environments').send(minimalEnvironment());
      const res = await authed().get(`/api/environments/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });

  describe('pagination', () => {
    it('respects offset/limit', async () => {
      for (let i = 0; i < 3; i++) {
        await authed().post('/api/environments').send({
          ...minimalEnvironment(),
          description: `E${i}`,
          url: `https://e${i}.example.com`,
        });
      }
      const res = await authed().get('/api/environments?offset=1&limit=1');
      expect(res.body.items).to.have.length(1);
      expect(res.body.total).to.equal(3);
    });
  });
});
