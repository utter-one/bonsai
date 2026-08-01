import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

describe('Operator API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('create', () => {
    it('creates an operator with minimal fields', async () => {
      const res = await authed().post('/api/operators').send({
        id: 'test-op-1@example.com',
        name: 'Test Operator',
        roles: ['viewer'],
        password: 'password123',
      });
      expect(res.status).to.equal(201);
      expect(res.body.id).to.equal('test-op-1@example.com');
      expect(res.body.version).to.equal(1);
      expect(res.body.roles).to.deep.equal(['viewer']);
    });

    it('creates with metadata', async () => {
      const res = await authed().post('/api/operators').send({
        id: 'test-op-2@example.com',
        name: 'Meta Operator',
        roles: ['developer'],
        password: 'password123',
        metadata: { department: 'engineering' },
      });
      expect(res.status).to.equal(201);
      expect(res.body.metadata.department).to.equal('engineering');
    });

    it('rejects missing id (400)', async () => {
      const res = await authed().post('/api/operators').send({
        name: 'No ID',
        roles: ['viewer'],
        password: 'password123',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing name (400)', async () => {
      const res = await authed().post('/api/operators').send({
        id: 'no-name@example.com',
        roles: ['viewer'],
        password: 'password123',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing roles (400)', async () => {
      const res = await authed().post('/api/operators').send({
        id: 'no-roles@example.com',
        name: 'No Roles',
        password: 'password123',
      });
      expect(res.status).to.equal(400);
    });

    it('rejects missing password (400)', async () => {
      const res = await authed().post('/api/operators').send({
        id: 'no-pass@example.com',
        name: 'No Pass',
        roles: ['viewer'],
      });
      expect(res.status).to.equal(400);
    });

    it('rejects empty roles (400)', async () => {
      const res = await authed().post('/api/operators').send({
        id: 'empty-roles@example.com',
        name: 'Empty Roles',
        roles: [],
        password: 'password123',
      });
      expect(res.status).to.equal(400);
    });
  });

  describe('list', () => {
    it('returns operators including the creator', async () => {
      const res = await authed().get('/api/operators');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
      expect(res.body.items.length).to.be.greaterThanOrEqual(1);
    });

    it('respects offset/limit', async () => {
      for (let i = 0; i < 2; i++) {
        await authed().post('/api/operators').send({
          id: `op-${i}@example.com`,
          name: `Op ${i}`,
          roles: ['viewer'],
          password: 'password123',
        });
      }
      const res = await authed().get('/api/operators?offset=0&limit=1');
      expect(res.body.items).to.have.length(1);
    });
  });

  describe('get by id', () => {
    it('returns operator by ID', async () => {
      const cr = await authed().post('/api/operators').send({
        id: 'get-me@example.com',
        name: 'Get Me',
        roles: ['viewer'],
        password: 'password123',
      });
      const res = await authed().get(`/api/operators/${cr.body.id}`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(cr.body.id);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().get('/api/operators/nonexistent');
      expect(res.status).to.equal(404);
    });
  });

  describe('update', () => {
    it('updates name', async () => {
      const cr = await authed().post('/api/operators').send({
        id: 'update-me@example.com',
        name: 'Original',
        roles: ['viewer'],
        password: 'password123',
      });
      const res = await authed().put(`/api/operators/${cr.body.id}`).send({
        name: 'Updated',
        version: cr.body.version,
      });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('Updated');
      expect(res.body.version).to.equal(cr.body.version + 1);
    });

    it('rejects stale version (409)', async () => {
      const cr = await authed().post('/api/operators').send({
        id: 'stale@example.com',
        name: 'Original',
        roles: ['viewer'],
        password: 'password123',
      });
      await authed().put(`/api/operators/${cr.body.id}`).send({ name: 'First', version: cr.body.version });
      const res = await authed().put(`/api/operators/${cr.body.id}`).send({ name: 'Second', version: cr.body.version });
      expect(res.status).to.be.oneOf([400, 409]);
    });

    it('rejects missing version (400)', async () => {
      const cr = await authed().post('/api/operators').send({
        id: 'no-ver@example.com',
        name: 'Original',
        roles: ['viewer'],
        password: 'password123',
      });
      const res = await authed().put(`/api/operators/${cr.body.id}`).send({ name: 'Updated' });
      expect(res.status).to.equal(400);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().put('/api/operators/nonexistent').send({ name: 'X', version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes an operator', async () => {
      const cr = await authed().post('/api/operators').send({
        id: 'delete-me@example.com',
        name: 'Delete Me',
        roles: ['viewer'],
        password: 'password123',
      });
      const res = await authed().delete(`/api/operators/${cr.body.id}`).send({ version: cr.body.version });
      expect(res.status).to.be.oneOf([200, 204]);
      const getRes = await authed().get(`/api/operators/${cr.body.id}`);
      expect(getRes.status).to.equal(404);
    });

    it('returns 404 for non-existent', async () => {
      const res = await authed().delete('/api/operators/nonexistent').send({ version: 1 });
      expect(res.status).to.equal(404);
    });
  });

  describe('profile', () => {
    it('returns current operator profile', async () => {
      const res = await authed().get('/api/profile');
      expect(res.status).to.equal(200);
      expect(res.body.id).to.be.a('string');
      expect(res.body.name).to.be.a('string');
      expect(res.body.roles).to.be.an('array');
    });

    it('updates profile name', async () => {
      const res = await authed().post('/api/profile').send({ name: 'New Name' });
      expect(res.status).to.equal(200);
      expect(res.body.name).to.equal('New Name');
    });

    it('rejects password change without oldPassword (400)', async () => {
      const res = await authed().post('/api/profile').send({ newPassword: 'newpass123' });
      expect(res.status).to.equal(400);
    });
  });

  describe('audit logs', () => {
    it('returns audit logs after creation', async () => {
      const cr = await authed().post('/api/operators').send({
        id: 'audit-me@example.com',
        name: 'Audit Me',
        roles: ['viewer'],
        password: 'password123',
      });
      const res = await authed().get(`/api/operators/${cr.body.id}/audit-logs`);
      expect(res.status).to.equal(200);
      expect(res.body).to.be.an('array');
      expect(res.body.length).to.be.greaterThanOrEqual(1);
    });
  });
});
