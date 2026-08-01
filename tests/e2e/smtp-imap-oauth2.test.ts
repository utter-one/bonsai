import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

function minimalSmtpImapProvider() {
  return {
    name: 'Test SMTP/IMAP',
    providerType: 'channel',
    apiType: 'smtp_imap',
    config: {
      fromAddress: 'test@example.com',
      smtp: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        auth: { user: 'test@example.com', pass: 'password123' },
      },
      imap: {
        host: 'imap.example.com',
        port: 993,
        secure: true,
        auth: { user: 'test@example.com', pass: 'password123' },
      },
    },
  };
}

describe('SMTP/IMAP OAuth2 API', () => {
  let providerId: string;

  beforeEach(async () => {
    await resetDatabase();
  });

  describe('authorize', () => {
    it('returns 400 for non-existent provider', async () => {
      const res = await authed().post('/api/email/smtp-imap/oauth2/authorize').send({
        providerId: 'nonexistent',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        scope: 'https://www.googleapis.com/auth/gmail.modify',
        redirectUrl: 'http://localhost:3000/callback',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for non-smtp_imap provider', async () => {
      // Create an LLM provider instead
      const llmProvider = await authed().post('/api/providers').send({
        name: 'Test LLM',
        providerType: 'llm',
        apiType: 'openai',
        config: { apiKey: 'sk-test123' },
      });
      const res = await authed().post('/api/email/smtp-imap/oauth2/authorize').send({
        providerId: llmProvider.body.id,
        tokenUrl: 'https://oauth2.googleapis.com/token',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        scope: 'https://www.googleapis.com/auth/gmail.modify',
        redirectUrl: 'http://localhost:3000/callback',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing required fields', async () => {
      const prov = await authed().post('/api/providers').send(minimalSmtpImapProvider());
      providerId = prov.body.id;
      const res = await authed().post('/api/email/smtp-imap/oauth2/authorize').send({
        providerId,
      });
      expect(res.status).to.equal(400);
    });

    it('returns authorization URL and state for valid request', async () => {
      const prov = await authed().post('/api/providers').send(minimalSmtpImapProvider());
      providerId = prov.body.id;
      const res = await authed().post('/api/email/smtp-imap/oauth2/authorize').send({
        providerId,
        tokenUrl: 'https://oauth2.googleapis.com/token',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'https://www.googleapis.com/auth/gmail.modify',
        redirectUrl: 'http://localhost:3000/api/email/smtp-imap/oauth2/callback',
      });
      expect(res.status).to.equal(200);
      expect(res.body.authorizationUrl).to.be.a('string');
      expect(res.body.authorizationUrl).to.include('accounts.google.com');
      expect(res.body.authorizationUrl).to.include('client_id=test-client-id');
      expect(res.body.state).to.be.a('string');
    });
  });

  describe('callback', () => {
    it('returns 400 for invalid state', async () => {
      const res = await authed().get('/api/email/smtp-imap/oauth2/callback').query({
        code: 'test-code',
        state: 'invalid-state',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing code/state', async () => {
      const res = await authed().get('/api/email/smtp-imap/oauth2/callback').query({});
      expect(res.status).to.equal(400);
    });

    it('returns 400 for error from provider', async () => {
      const res = await authed().get('/api/email/smtp-imap/oauth2/callback').query({
        error: 'access_denied',
        error_description: 'User denied access',
        state: 'some-state',
      });
      expect(res.status).to.equal(400);
      expect(res.body.success).to.equal(false);
    });
  });

  describe('refresh', () => {
    it('returns 400 for non-existent provider', async () => {
      const res = await authed().post('/api/email/smtp-imap/oauth2/refresh').send({
        providerId: 'nonexistent',
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for non-smtp_imap provider', async () => {
      const llmProvider = await authed().post('/api/providers').send({
        name: 'Test LLM',
        providerType: 'llm',
        apiType: 'openai',
        config: { apiKey: 'sk-test123' },
      });
      const res = await authed().post('/api/email/smtp-imap/oauth2/refresh').send({
        providerId: llmProvider.body.id,
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for smtp_imap provider without OAuth2 config', async () => {
      const prov = await authed().post('/api/providers').send(minimalSmtpImapProvider());
      const res = await authed().post('/api/email/smtp-imap/oauth2/refresh').send({
        providerId: prov.body.id,
      });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for missing providerId', async () => {
      const res = await authed().post('/api/email/smtp-imap/oauth2/refresh').send({});
      expect(res.status).to.equal(400);
    });
  });
});
