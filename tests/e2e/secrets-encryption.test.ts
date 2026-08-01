import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

const TEST_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY!;

function s3Provider() {
  return {
    name: 'Test S3 Provider',
    providerType: 'storage',
    apiType: 's3',
    config: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
    },
  };
}

function localProvider() {
  return {
    name: 'Test Local Provider',
    providerType: 'storage',
    apiType: 'local',
    config: { basePath: '/tmp/test-storage' },
  };
}

describe('Secrets Encryption', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('provider config sensitive fields', () => {
    it('encrypts secretAccessKey on S3 provider creation', async () => {
      const secretKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const res = await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: secretKey,
          region: 'us-east-1',
        },
      });
      expect(res.status).to.equal(201);
      // Config should contain a secret reference, not the plaintext
      expect(res.body.config.secretAccessKey).to.match(/^@sec:local:sec_/);
      expect(res.body.config.secretAccessKey).to.not.equal(secretKey);
      // Non-sensitive fields remain plaintext
      expect(res.body.config.accessKeyId).to.equal('AKIAIOSFODNN7EXAMPLE');
      expect(res.body.config.region).to.equal('us-east-1');
    });

    it('encrypts multiple sensitive fields in S3 config', async () => {
      const secretKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const res = await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: secretKey,
          region: 'us-east-1',
        },
      });
      expect(res.status).to.equal(201);
      expect(res.body.config.secretAccessKey).to.match(/^@sec:local:sec_/);
      // Non-sensitive fields remain plaintext
      expect(res.body.config.accessKeyId).to.equal('AKIAIOSFODNN7EXAMPLE');
      expect(res.body.config.region).to.equal('us-east-1');
    });

    it('does not double-encrypt on re-save', async () => {
      // Create provider with sensitive field
      const createRes = await authed().post('/api/providers').send(s3Provider());
      expect(createRes.status).to.equal(201);
      const originalRef = createRes.body.config.secretAccessKey;
      expect(originalRef).to.match(/^@sec:local:sec_/);

      // Verify only one secret was created
      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.have.length(1);
      expect(listRes.body.items[0].ref).to.equal(originalRef);

      // Verify the secret can be revealed
      const secretId = originalRef.split(':')[2];
      const revealRes = await authed().get(`/api/secrets/${secretId}/value`);
      expect(revealRes.status).to.equal(200);
      expect(revealRes.body.value).to.equal('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
    });

    it('stores encrypted secrets in the secrets table', async () => {
      const createRes = await authed().post('/api/providers').send(s3Provider());
      expect(createRes.status).to.equal(201);
      const secretRef = createRes.body.config.secretAccessKey;

      // Verify the secret appears in the secrets list
      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.have.length(1);
      expect(listRes.body.items[0].ref).to.equal(secretRef);
    });

    it('secret reveal returns plaintext value', async () => {
      const secretKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      const createRes = await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: secretKey,
          region: 'us-east-1',
        },
      });
      expect(createRes.status).to.equal(201);

      // Extract secret ID from reference
      const secretRef = createRes.body.config.secretAccessKey;
      const secretId = secretRef.split(':')[2];

      // Reveal the secret
      const revealRes = await authed().get(`/api/secrets/${secretId}/value`);
      expect(revealRes.status).to.equal(200);
      expect(revealRes.body.value).to.equal(secretKey);
      expect(revealRes.body.id).to.equal(secretId);
    });

    it('cannot delete a referenced secret (409)', async () => {
      const createRes = await authed().post('/api/providers').send(s3Provider());
      expect(createRes.status).to.equal(201);

      const secretRef = createRes.body.config.secretAccessKey;
      const secretId = secretRef.split(':')[2];

      // Try to delete the referenced secret
      const deleteRes = await authed().delete(`/api/secrets/${secretId}`);
      expect(deleteRes.status).to.equal(409);
    });

    it('can delete an unreferenced secret', async () => {
      // Create two S3 providers with different keys
      const createRes1 = await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIA1',
          secretAccessKey: 'secret-key-1',
          region: 'us-east-1',
        },
      });
      const createRes2 = await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIA2',
          secretAccessKey: 'secret-key-2',
          region: 'us-east-1',
        },
      });
      expect(createRes1.status).to.equal(201);
      expect(createRes2.status).to.equal(201);

      // Delete the first provider (requires version for optimistic locking)
      const deleteProviderRes = await authed().delete(`/api/providers/${createRes1.body.id}`).send({
        version: createRes1.body.version,
      });
      expect(deleteProviderRes.status).to.be.oneOf([200, 204]);

      // Now the first secret should be deletable (unreferenced)
      const secretId1 = createRes1.body.config.secretAccessKey.split(':')[2];
      const deleteRes = await authed().delete(`/api/secrets/${secretId1}`);
      expect(deleteRes.status).to.equal(204);
    });

    it('nested sensitive fields are encrypted (smtp.auth.pass)', async () => {
      const config = {
        fromAddress: 'sender@example.com',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          auth: {
            user: 'user@example.com',
            pass: 'smtp-secret-password',
          },
        },
        imap: {
          host: 'imap.example.com',
          port: 993,
          auth: {
            user: 'user@example.com',
            pass: 'imap-secret-password',
          },
        },
      };
      const res = await authed().post('/api/providers').send({
        name: 'Test SMTP Provider',
        providerType: 'channel',
        apiType: 'smtp_imap',
        config,
      });
      expect(res.status).to.equal(201);
      expect(res.body.config.smtp.auth.pass).to.match(/^@sec:local:sec_/);
      expect(res.body.config.imap.auth.pass).to.match(/^@sec:local:sec_/);
      // Non-sensitive nested fields remain plaintext
      expect(res.body.config.smtp.auth.user).to.equal('user@example.com');
      expect(res.body.config.fromAddress).to.equal('sender@example.com');
    });

    it('oauth2 sensitive fields are encrypted', async () => {
      const config = {
        fromAddress: 'sender@example.com',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          auth: {
            user: 'user@example.com',
            pass: 'smtp-password',
          },
        },
        imap: {
          host: 'imap.example.com',
          port: 993,
          auth: {
            user: 'user@example.com',
            pass: 'imap-password',
          },
        },
        oauth2: {
          tokenUrl: 'https://oauth2.googleapis.com/token',
          clientId: 'my-client-id',
          clientSecret: 'oauth-secret-123',
          accessToken: 'oauth-access-456',
          refreshToken: 'oauth-refresh-789',
          scope: 'https://www.googleapis.com/auth/gmail.modify',
        },
      };
      const res = await authed().post('/api/providers').send({
        name: 'Test SMTP+OAuth2 Provider',
        providerType: 'channel',
        apiType: 'smtp_imap',
        config,
      });
      expect(res.status).to.equal(201);
      expect(res.body.config.oauth2.clientSecret).to.match(/^@sec:local:sec_/);
      expect(res.body.config.oauth2.accessToken).to.match(/^@sec:local:sec_/);
      expect(res.body.config.oauth2.refreshToken).to.match(/^@sec:local:sec_/);
      // Non-sensitive fields remain plaintext
      expect(res.body.config.fromAddress).to.equal('sender@example.com');
      expect(res.body.config.oauth2.clientId).to.equal('my-client-id');
    });
  });

  describe('environment password encryption', () => {
    it('encrypts password on environment creation', async () => {
      const password = 'env-secret-password';
      const res = await authed().post('/api/environments').send({
        description: 'Test Environment',
        url: 'https://test.example.com',
        login: 'admin',
        password,
      });
      expect(res.status).to.equal(201);
      // Response excludes password field (security)
      expect(res.body).to.not.have.property('password');

      // Verify a secret was created in the secrets table
      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.have.length(1);
      expect(listRes.body.items[0].ref).to.match(/^@sec:local:sec_/);
    });

    it('environment password reveal returns plaintext', async () => {
      const password = 'env-secret-reveal';
      const createRes = await authed().post('/api/environments').send({
        description: 'Test Environment',
        url: 'https://test.example.com',
        login: 'admin',
        password,
      });
      expect(createRes.status).to.equal(201);

      // Get the secret from the secrets list
      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      const secretRef = listRes.body.items[0].ref;
      const secretId = secretRef.split(':')[2];

      const revealRes = await authed().get(`/api/secrets/${secretId}/value`);
      expect(revealRes.status).to.equal(200);
      expect(revealRes.body.value).to.equal(password);
    });

    it('environment password is not deletable while environment exists (409)', async () => {
      const createRes = await authed().post('/api/environments').send({
        description: 'Test Environment',
        url: 'https://test.example.com',
        login: 'admin',
        password: 'env-secret-password',
      });
      expect(createRes.status).to.equal(201);

      const listRes = await authed().get('/api/secrets');
      const secretId = listRes.body.items[0].ref.split(':')[2];
      const deleteRes = await authed().delete(`/api/secrets/${secretId}`);
      expect(deleteRes.status).to.equal(409);
    });

    it('environment password secret is deletable after environment deletion', async () => {
      const createRes = await authed().post('/api/environments').send({
        description: 'Test Environment',
        url: 'https://test.example.com',
        login: 'admin',
        password: 'env-secret-password',
      });
      expect(createRes.status).to.equal(201);

      const listRes = await authed().get('/api/secrets');
      const secretId = listRes.body.items[0].ref.split(':')[2];
      const envId = createRes.body.id;

      // Delete the environment (requires version for optimistic locking)
      const deleteEnvRes = await authed().delete(`/api/environments/${envId}`).send({
        version: createRes.body.version,
      });
      expect(deleteEnvRes.status).to.be.oneOf([200, 204]);

      // Now the secret should be deletable
      const deleteRes = await authed().delete(`/api/secrets/${secretId}`);
      expect(deleteRes.status).to.equal(204);
    });
  });

  describe('secrets list and orphan detection', () => {
    it('lists all secrets with references', async () => {
      await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIA1',
          secretAccessKey: 'secret-key-1',
          region: 'us-east-1',
        },
      });
      await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIA2',
          secretAccessKey: 'secret-key-2',
          region: 'us-east-1',
        },
      });

      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.have.length(2);
      // Both secrets are referenced (not orphans)
      expect(listRes.body.orphans).to.have.length(0);
    });

    it('detects orphans after provider deletion', async () => {
      const createRes = await authed().post('/api/providers').send({
        ...s3Provider(),
        config: {
          accessKeyId: 'AKIA1',
          secretAccessKey: 'secret-key-1',
          region: 'us-east-1',
        },
      });
      const providerId = createRes.body.id;
      const secretRef = createRes.body.config.secretAccessKey;

      // Delete the provider (requires version)
      await authed().delete(`/api/providers/${providerId}`).send({
        version: createRes.body.version,
      });

      // The secret should now be an orphan
      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.have.length(1);
      expect(listRes.body.orphans).to.have.length(1);
      expect(listRes.body.orphans[0]).to.equal(secretRef);
    });
  });

  describe('encryption round-trip integrity', () => {
    it('decrypts to exact original value for various inputs', async () => {
      const testValues = [
        'simple-key',
        'key-with-special-chars!@#$%^&*()',
        'key-with-unicode-🔑',
        'very-long-key-that-goes-on-and-on-and-on-and-on-and-on-and-on-and-on-and-on',
        'key:with:colons',
        'key/with/slashes',
      ];

      for (const value of testValues) {
        const createRes = await authed().post('/api/providers').send({
          ...s3Provider(),
          config: {
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: value,
            region: 'us-east-1',
          },
        });
        expect(createRes.status).to.equal(201), `Failed to create provider with value: ${value}`;

        const secretId = createRes.body.config.secretAccessKey.split(':')[2];
        const revealRes = await authed().get(`/api/secrets/${secretId}/value`);
        expect(revealRes.status).to.equal(200);
        expect(revealRes.body.value).to.equal(value), `Round-trip failed for: ${value}`;
      }
    });
  });
});
