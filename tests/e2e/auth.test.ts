import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import jwt from 'jsonwebtoken';
import { unauthed, authed, getAccessToken, getRefreshToken, resetDatabase } from '../utils';

describe('Auth API', () => {
  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const res = await unauthed()
        .post('/api/auth/login')
        .send({
          id: 'test@example.com',
          password: 'testpassword123',
        });
      expect(res.status).to.equal(200);
      expect(res.body.accessToken).to.be.a('string');
      expect(res.body.refreshToken).to.be.a('string');
      expect(res.body.expiresIn).to.be.a('number');
      expect(res.body.operatorId).to.equal('test@example.com');
      expect(res.body.displayName).to.equal('Test Admin');
      expect(res.body.roles).to.be.an('array');
      expect(res.body.permissions).to.be.an('array');
    });

    it('should reject with 401 for wrong password', async () => {
      const res = await unauthed()
        .post('/api/auth/login')
        .send({
          id: 'test@example.com',
          password: 'wrong-password',
        });
      expect(res.status).to.equal(401);
    });

    it('should reject with 401 for non-existent user', async () => {
      const res = await unauthed()
        .post('/api/auth/login')
        .send({
          id: 'nobody@example.com',
          password: 'does-not-matter',
        });
      expect(res.status).to.equal(401);
    });

    it('should reject with 400 for missing fields', async () => {
      const res = await unauthed()
        .post('/api/auth/login')
        .send({ id: 'test@example.com' });
      expect(res.status).to.equal(400);
    });

    it('should reject with 400 for missing password', async () => {
      const res = await unauthed()
        .post('/api/auth/login')
        .send({ password: 'testpassword123' });
      expect(res.status).to.equal(400);
    });

    it('should reject with 400 for empty body', async () => {
      const res = await unauthed()
        .post('/api/auth/login')
        .send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const res = await unauthed()
        .post('/api/auth/refresh')
        .send({ refreshToken: getRefreshToken() });
      expect(res.status).to.equal(200);
      expect(res.body.accessToken).to.be.a('string');
      expect(res.body.expiresIn).to.be.a('number');
      expect(res.body.roles).to.be.an('array');
      expect(res.body.permissions).to.be.an('array');
    });

    it('should reject with 401 for invalid refresh token', async () => {
      const res = await unauthed()
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token-string' });
      expect(res.status).to.equal(401);
    });

    it('should reject with 401 for access token used as refresh token', async () => {
      const res = await unauthed()
        .post('/api/auth/refresh')
        .send({ refreshToken: getAccessToken() });
      expect(res.status).to.equal(401);
    });

    it('should reject with 401 for tampered token', async () => {
      // Tamper with the token by changing a character
      const tampered = getRefreshToken().slice(0, -1) + 'x';
      const res = await unauthed()
        .post('/api/auth/refresh')
        .send({ refreshToken: tampered });
      expect(res.status).to.equal(401);
    });

    it('should reject with 400 for missing refresh token', async () => {
      const res = await unauthed()
        .post('/api/auth/refresh')
        .send({});
      expect(res.status).to.equal(400);
    });
  });

  describe('JWT token validation on protected endpoints', () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it('should reject expired access token', async () => {
      const expiredToken = jwt.sign(
        { operatorId: 'test@example.com', roles: ['super_admin'], type: 'access' },
        process.env.JWT_SECRET!,
        { expiresIn: '1s' }
      );
      await new Promise(resolve => setTimeout(resolve, 1500));

      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).to.equal(401);
    });

    it('should reject malformed token', async () => {
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', 'Bearer not-a-valid-jwt-token');
      expect(res.status).to.equal(401);
    });

    it('should reject token with wrong type (refresh used as access)', async () => {
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', `Bearer ${getRefreshToken()}`);
      expect(res.status).to.equal(401);
    });

    it('should reject token signed with wrong secret', async () => {
      const fakeToken = jwt.sign(
        { operatorId: 'test@example.com', roles: ['super_admin'], type: 'access' },
        'wrong-secret-key-that-is-at-least-32-chars-long',
        { expiresIn: '18h' }
      );
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', `Bearer ${fakeToken}`);
      expect(res.status).to.equal(401);
    });

    it('should reject tampered token', async () => {
      const tampered = getAccessToken().slice(0, -1) + 'x';
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).to.equal(401);
    });

    it('should reject missing Authorization header', async () => {
      const res = await unauthed().get('/api/operators');
      expect(res.status).to.equal(401);
    });

    it('should reject empty Authorization header', async () => {
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', '');
      expect(res.status).to.equal(401);
    });

    it('should reject Authorization header without Bearer prefix', async () => {
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', getAccessToken());
      expect(res.status).to.equal(401);
    });

    it('should accept valid access token', async () => {
      const res = await unauthed()
        .get('/api/operators')
        .set('Authorization', `Bearer ${getAccessToken()}`);
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array');
    });
  });

  describe('authenticated request flow', () => {
    beforeEach(async () => {
      await resetDatabase();
    });

    it('should access a protected endpoint using the authed agent', async () => {
      const res = await authed().get('/api/profile');
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal('test@example.com');
      expect(res.body.name).to.equal('Test Admin');
    });

    it('should access multiple endpoints with the same token', async () => {
      const profileRes = await authed().get('/api/profile');
      expect(profileRes.status).to.equal(200);

      const projectsRes = await authed().get('/api/projects');
      expect(projectsRes.status).to.equal(200);
    });
  });
});
