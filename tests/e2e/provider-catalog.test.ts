import { describe, it } from 'mocha';
import { expect } from 'chai';
import { authed } from '../utils';

describe('Provider Catalog API', () => {
  describe('catalog', () => {
    it('returns full catalog', async () => {
      const res = await authed().get('/api/provider-catalog');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('asr');
      expect(res.body).to.have.property('tts');
      expect(res.body).to.have.property('llm');
      expect(res.body).to.have.property('storage');
      expect(res.body).to.have.property('moderation');
    });
  });

  describe('type-specific endpoints', () => {
    it('returns ASR providers', async () => {
      const res = await authed().get('/api/provider-catalog/asr');
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array');
    });

    it('returns TTS providers', async () => {
      const res = await authed().get('/api/provider-catalog/tts');
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array');
    });

    it('returns LLM providers', async () => {
      const res = await authed().get('/api/provider-catalog/llm');
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array');
    });

    it('returns storage providers', async () => {
      const res = await authed().get('/api/provider-catalog/storage');
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array');
    });

    it('returns moderation providers', async () => {
      const res = await authed().get('/api/provider-catalog/moderation');
      expect(res.status).to.equal(200);
      expect(res.body.providers).to.be.an('array');
    });
  });

  describe('specific provider', () => {
    it('returns specific LLM provider', async () => {
      const res = await authed().get('/api/provider-catalog/llm/openai');
      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('apiType');
    });

    it('returns specific TTS provider', async () => {
      const res = await authed().get('/api/provider-catalog/tts/elevenlabs');
      expect(res.status).to.equal(200);
    });

    it('returns specific ASR provider', async () => {
      const res = await authed().get('/api/provider-catalog/asr/deepgram');
      expect(res.status).to.equal(200);
    });

    it('returns 404 for unknown provider type', async () => {
      const res = await authed().get('/api/provider-catalog/llm/nonexistent');
      expect(res.status).to.equal(404);
    });
  });
});
