import { describe, it, beforeEach } from 'mocha';
import { expect } from 'chai';
import { authed, resetDatabase } from '../utils';

function s3Provider(config: { accessKeyId: string; secretAccessKey: string; region: string }) {
  return {
    name: 'Test S3 Provider',
    providerType: 'storage',
    apiType: 's3',
    config,
  };
}

describe('Secret API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe('list', () => {
    it('returns empty list', async () => {
      const res = await authed().get('/api/secrets');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.be.an('array').that.is.empty;
      expect(res.body.orphans).to.be.an('array');
    });

    it('lists secrets after provider creation', async () => {
      await authed().post('/api/providers').send(s3Provider({
        accessKeyId: 'AKIA1',
        secretAccessKey: 'secret-key-1',
        region: 'us-east-1',
      }));
      await authed().post('/api/providers').send(s3Provider({
        accessKeyId: 'AKIA2',
        secretAccessKey: 'secret-key-2',
        region: 'us-east-1',
      }));

      const res = await authed().get('/api/secrets');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(2);
      expect(res.body.orphans).to.have.length(0);

      for (const item of res.body.items) {
        expect(item).to.have.property('id');
        expect(item).to.have.property('ref');
        expect(item.ref).to.match(/^@sec:local:sec_/);
      }
    });

    it('detects orphans after provider deletion', async () => {
      const createRes = await authed().post('/api/providers').send(s3Provider({
        accessKeyId: 'AKIA1',
        secretAccessKey: 'secret-key-1',
        region: 'us-east-1',
      }));
      expect(createRes.status).to.equal(201);
      const secretRef = createRes.body.config.secretAccessKey;

      // Delete the provider (requires version)
      await authed().delete(`/api/providers/${createRes.body.id}`).send({
        version: createRes.body.version,
      });

      const res = await authed().get('/api/secrets');
      expect(res.status).to.equal(200);
      expect(res.body.items).to.have.length(1);
      expect(res.body.orphans).to.have.length(1);
      expect(res.body.orphans[0]).to.equal(secretRef);
    });
  });

  describe('reveal', () => {
    it('reveals plaintext value of a secret', async () => {
      const originalValue = 'my-super-secret-key-123';
      const createRes = await authed().post('/api/providers').send(s3Provider({
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: originalValue,
        region: 'us-east-1',
      }));
      expect(createRes.status).to.equal(201);

      const secretRef = createRes.body.config.secretAccessKey;
      const secretId = secretRef.split(':')[2];

      const res = await authed().get(`/api/secrets/${secretId}/value`);
      expect(res.status).to.equal(200);
      expect(res.body.id).to.equal(secretId);
      expect(res.body.value).to.equal(originalValue);
    });

    it('returns 404 for non-existent secret', async () => {
      const res = await authed().get('/api/secrets/nonexistent/value');
      expect(res.status).to.equal(404);
    });
  });

  describe('delete', () => {
    it('deletes an unreferenced secret', async () => {
      const createRes = await authed().post('/api/providers').send(s3Provider({
        accessKeyId: 'AKIA1',
        secretAccessKey: 'secret-key-1',
        region: 'us-east-1',
      }));
      expect(createRes.status).to.equal(201);
      const secretRef = createRes.body.config.secretAccessKey;
      const secretId = secretRef.split(':')[2];

      // Delete the provider so the secret becomes unreferenced
      await authed().delete(`/api/providers/${createRes.body.id}`).send({
        version: createRes.body.version,
      });

      const res = await authed().delete(`/api/secrets/${secretId}`);
      expect(res.status).to.equal(204);

      // Verify it's gone
      const listRes = await authed().get('/api/secrets');
      expect(listRes.status).to.equal(200);
      expect(listRes.body.items).to.be.an('array').that.is.empty;
    });

    it('returns 409 for a referenced secret', async () => {
      const createRes = await authed().post('/api/providers').send(s3Provider({
        accessKeyId: 'AKIA1',
        secretAccessKey: 'secret-key-1',
        region: 'us-east-1',
      }));
      expect(createRes.status).to.equal(201);

      const secretRef = createRes.body.config.secretAccessKey;
      const secretId = secretRef.split(':')[2];

      const res = await authed().delete(`/api/secrets/${secretId}`);
      expect(res.status).to.equal(409);
    });

    it('returns 404 for non-existent secret', async () => {
      const res = await authed().delete('/api/secrets/nonexistent');
      expect(res.status).to.equal(404);
    });
  });
});
