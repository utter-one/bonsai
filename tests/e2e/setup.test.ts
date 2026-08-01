import { describe, it } from 'mocha';
import { expect } from 'chai';
import { unauthed } from '../utils';

describe('Setup API', () => {
  describe('GET /api/setup/status', () => {
    it('should return isSetup: true after initial operator exists', async () => {
      const res = await unauthed().get('/api/setup/status');
      expect(res.status).to.equal(200);
      expect(res.body.isSetup).to.equal(true);
      expect(res.body.message).to.be.a('string');
    });
  });

  describe('POST /api/setup/initial-operator', () => {
    it('should reject with 400 when system is already set up', async () => {
      const res = await unauthed()
        .post('/api/setup/initial-operator')
        .send({
          id: 'another@example.com',
          name: 'Another Admin',
          password: 'testpassword123',
        });
      expect(res.status).to.equal(400);
    });

    it('should reject with 400 when body is invalid (missing name)', async () => {
      const res = await unauthed()
        .post('/api/setup/initial-operator')
        .send({
          id: 'another@example.com',
          password: 'testpassword123',
        });
      expect(res.status).to.equal(400);
    });

    it('should reject with 400 when password is too short', async () => {
      const res = await unauthed()
        .post('/api/setup/initial-operator')
        .send({
          id: 'another@example.com',
          name: 'Another Admin',
          password: 'short',
        });
      expect(res.status).to.equal(400);
    });
  });
});
